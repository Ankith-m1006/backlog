import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { EventSubChatSource } from '../chat/eventsub.js';
import { ReplayChatSource } from '../chat/replay.js';
import type { ChatSource } from '../chat/types.js';
import { QuestionPipeline } from '../classifier/pipeline.js';
import type { Classification } from '../classifier/openai.js';
import type { ChatMessage } from '../chat/types.js';
import { ChatCommandHandler } from '../chat/commands.js';
import { BacklogStore } from '../store/store.js';
import { SavedAnswerService } from '../answers/service.js';
import { HelixChatSender } from '../bot/helix.js';
import { SavedAnswerQueue } from '../bot/saved-answer-queue.js';
import { getBacklogMode } from '../config/mode.js';
import { createApp } from './app.js';
import { loadEnvFile } from '../config/env.js';
import { getStoredAccessToken, readStoredToken, startTokenRefresh, type AuthOptions } from '../auth/tokens.js';

await loadEnvFile();

const authOptions: AuthOptions = {
  clientId: process.env.TWITCH_CLIENT_ID ?? '',
  ...(process.env.TWITCH_CLIENT_SECRET ? { clientSecret: process.env.TWITCH_CLIENT_SECRET } : {}),
};
const storedTokens = authOptions.clientId ? await Promise.all([
  getStoredAccessToken('streamer', authOptions), getStoredAccessToken('bot', authOptions),
]) : [undefined, undefined];
const botIdentity = authOptions.clientId ? await readStoredToken('bot') : undefined;
const streamerIdentity = authOptions.clientId ? await readStoredToken('streamer') : undefined;
if (streamerIdentity && process.env.TWITCH_BROADCASTER_USER_ID && streamerIdentity.userId !== process.env.TWITCH_BROADCASTER_USER_ID) {
  throw new Error(`Streamer token belongs to ${streamerIdentity.login} (${streamerIdentity.userId}), not TWITCH_BROADCASTER_USER_ID`);
}
const streamerToken = storedTokens[0] ?? process.env.TWITCH_ACCESS_TOKEN;
const botToken = storedTokens[1] ?? process.env.TWITCH_ACCESS_TOKEN;
const broadcasterUserId = process.env.TWITCH_BROADCASTER_USER_ID ?? streamerIdentity?.userId ?? '';
const tokenRefreshStops = authOptions.clientId ? [
  startTokenRefresh('streamer', authOptions, (error) => console.error('[Backlog] streamer token refresh failed', error.message)),
  startTokenRefresh('bot', authOptions, (error) => console.error('[Backlog] bot token refresh failed', error.message)),
] : [];
const botUserId = botIdentity?.userId ?? process.env.BOT_USER_ID ?? '';
const botUsername = botIdentity?.login ?? process.env.BOT_USERNAME ?? '';

const dbPath = resolve(process.env.BACKLOG_DB_PATH ?? 'data/backlog.sqlite');
await mkdir(dirname(dbPath), { recursive: true });
const store = new BacklogStore(dbPath);
const mode = getBacklogMode();
const demoMode = mode === 'demo';
if (!demoMode && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required when BACKLOG_MODE=live');
const classifyForDemo = async (messages: ChatMessage[]): Promise<Classification[]> => messages.map((message) => {
  const lower = message.text.toLowerCase();
  const topicKey = /join|party|lobby/u.test(lower) ? 'joining-the-lobby'
    : /blue key|key/u.test(lower) ? 'blue-key-location'
      : /sens/u.test(lower) ? 'game-sensitivity' : lower.replace(/[^a-z0-9 ]/gu, '').trim().split(/\s+/u).slice(0, 5).join('-');
  const normalized = topicKey === 'joining-the-lobby' ? 'How can I join the lobby?'
    : topicKey === 'blue-key-location' ? 'Where is the blue key?'
      : topicKey === 'game-sensitivity' ? 'What sensitivity do you use?'
        : message.text.trim();
  return { id: message.id, isQuestion: true, normalized, topicKey };
});
const demoEmbed = async (text: string): Promise<number[]> => {
  const vector = Array.from({ length: 16 }, () => 0);
  for (const word of text.toLowerCase().split(/\W+/u).filter(Boolean)) {
    let hash = 2166136261;
    for (const character of word) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    vector[(hash >>> 0) % vector.length]! += 1;
  }
  return vector;
};
const pipeline = new QuestionPipeline({
  apiKey: process.env.OPENAI_API_KEY ?? '',
  ...(demoMode ? { classifyBatch: classifyForDemo, embedNormalized: demoEmbed } : {}),
  onQuestion: (question) => store.upsertQuestion(question),
  onError: (error) => console.error('[Backlog] classification failed', error.message),
});
const answerService = new SavedAnswerService(store, {
  apiKey: process.env.OPENAI_API_KEY ?? '',
  threshold: Number(process.env.ANSWER_MATCH_THRESHOLD ?? 0.82),
  ...(demoMode ? { embed: demoEmbed } : {}),
  onError: (error) => console.error('[Backlog] answer matching unavailable', error.message),
});
const answerQueue = botToken && process.env.TWITCH_CLIENT_ID && broadcasterUserId && botUserId
  ? new SavedAnswerQueue(store, new HelixChatSender({
    accessToken: botToken, getAccessToken: async () => await getStoredAccessToken('bot', authOptions) ?? process.env.TWITCH_ACCESS_TOKEN ?? botToken,
    clientId: process.env.TWITCH_CLIENT_ID,
    broadcasterId: broadcasterUserId, botUserId,
  }), { onError: (error) => console.error('[Backlog] saved answer send failed', error.message) })
  : undefined;
const app = await createApp({ store, webRoot: resolve('dist/web'), answerService, answerQueue, mode });
const commandHandler = new ChatCommandHandler(store, answerQueue);
const port = Number(process.env.PORT ?? 3001);
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port });
console.info(`[Backlog] server listening on ${port}`);

let chatSource: ChatSource | undefined;
if (process.env.BACKLOG_REPLAY_FILE) {
  chatSource = new ReplayChatSource(process.env.BACKLOG_REPLAY_FILE, process.env.CHANNEL ?? 'streamer', Number(process.env.REPLAY_SPEED ?? 1));
} else if (streamerToken && broadcasterUserId && botUserId && process.env.TWITCH_CLIENT_ID && process.env.CHANNEL && botUsername) {
  chatSource = new EventSubChatSource({
    clientId: process.env.TWITCH_CLIENT_ID, accessToken: streamerToken,
    getAccessToken: async () => await getStoredAccessToken('streamer', authOptions) ?? process.env.TWITCH_ACCESS_TOKEN ?? streamerToken,
    broadcasterUserId, botUserId,
    chatReaderUserId: streamerIdentity?.userId ?? broadcasterUserId,
    channel: process.env.CHANNEL, botUsername,
  });
}
if (chatSource) {
  void chatSource.start((message) => { if (!commandHandler.handle(message)) pipeline.add(message); }).then(() => {
    console.info(`[Backlog] chat source finished${process.env.BACKLOG_REPLAY_FILE ? ' replay' : ''}`);
  }).catch((error: unknown) => {
    console.error('[Backlog] chat source failed', error instanceof Error ? error.message : error);
  });
  console.info(`[Backlog] chat source started${process.env.BACKLOG_REPLAY_FILE ? ' in replay mode' : ''}`);
}

const shutdown = async (): Promise<void> => {
  tokenRefreshStops.forEach((stop) => stop());
  pipeline.stop();
  await chatSource?.stop();
  await app.close();
  store.close();
};
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
