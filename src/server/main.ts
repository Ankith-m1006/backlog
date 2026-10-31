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
import { answerMatchThreshold, env, loadEnvFile } from '../config/env.js';
import { getStoredAccessToken, readStoredToken, startTokenRefresh, type AuthOptions } from '../auth/tokens.js';

await loadEnvFile();

const authOptions: AuthOptions = {
  clientId: env('TWITCH_CLIENT_ID') ?? '',
  ...(env('TWITCH_CLIENT_SECRET') ? { clientSecret: env('TWITCH_CLIENT_SECRET') } : {}),
};
const storedTokens = authOptions.clientId ? await Promise.all([
  getStoredAccessToken('streamer', authOptions), getStoredAccessToken('bot', authOptions),
]) : [undefined, undefined];
const botIdentity = authOptions.clientId ? await readStoredToken('bot') : undefined;
const streamerIdentity = authOptions.clientId ? await readStoredToken('streamer') : undefined;
if (streamerIdentity && env('TWITCH_BROADCASTER_USER_ID') && streamerIdentity.userId !== env('TWITCH_BROADCASTER_USER_ID')) {
  throw new Error(`Streamer token belongs to ${streamerIdentity.login} (${streamerIdentity.userId}), not TWITCH_BROADCASTER_USER_ID`);
}
const streamerToken = storedTokens[0] ?? env('TWITCH_ACCESS_TOKEN');
const botToken = storedTokens[1] ?? env('TWITCH_ACCESS_TOKEN');
const broadcasterUserId = env('TWITCH_BROADCASTER_USER_ID') ?? streamerIdentity?.userId ?? '';
const tokenRefreshStops = authOptions.clientId ? [
  startTokenRefresh('streamer', authOptions, (error) => console.error('[Backlog] streamer token refresh failed', error.message)),
  startTokenRefresh('bot', authOptions, (error) => console.error('[Backlog] bot token refresh failed', error.message)),
] : [];
const botUserId = botIdentity?.userId ?? env('BOT_USER_ID') ?? '';
const botUsername = botIdentity?.login ?? env('BOT_USERNAME') ?? '';

const dbPath = resolve(env('BACKLOG_DB_PATH') ?? 'data/backlog.sqlite');
await mkdir(dirname(dbPath), { recursive: true });
const store = new BacklogStore(dbPath);
const mode = getBacklogMode();
const demoMode = mode === 'demo';
if (!demoMode && !env('OPENAI_API_KEY')) throw new Error('OPENAI_API_KEY is required when BACKLOG_MODE=live');
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
  apiKey: env('OPENAI_API_KEY') ?? '',
  ...(demoMode ? { classifyBatch: classifyForDemo, embedNormalized: demoEmbed } : {}),
  onQuestion: (question, message) => store.upsertQuestion(question, { userLogin: message.userLogin, text: message.text, sentAt: message.sentAt }),
  onStats: () => store.emit('statsChanged'),
  onError: (error) => console.error('[Backlog] classification failed', error.message),
});
const answerService = new SavedAnswerService(store, {
  apiKey: env('OPENAI_API_KEY') ?? '',
  threshold: answerMatchThreshold(),
  ...(demoMode ? { embed: demoEmbed } : {}),
  onError: (error) => console.error('[Backlog] answer matching unavailable', error.message),
});
const answerQueue = botToken && env('TWITCH_CLIENT_ID') && broadcasterUserId && botUserId
  ? new SavedAnswerQueue(store, new HelixChatSender({
    accessToken: botToken, getAccessToken: async () => await getStoredAccessToken('bot', authOptions) ?? env('TWITCH_ACCESS_TOKEN') ?? botToken,
    clientId: env('TWITCH_CLIENT_ID')!,
    broadcasterId: broadcasterUserId, botUserId,
  }), { onError: (error) => console.error('[Backlog] saved answer send failed', error.message) })
  : undefined;
const app = await createApp({ store, webRoot: resolve('dist/web'), answerService, answerQueue, mode, stats: () => pipeline.stats() });
const commandHandler = new ChatCommandHandler(store, answerQueue);
const port = Number(env('PORT') ?? 3001);
await app.listen({ host: env('HOST') ?? '127.0.0.1', port });
console.info(`[Backlog] server listening on ${port}`);

let chatSource: ChatSource | undefined;
const replayFile = env('BACKLOG_REPLAY_FILE');
const channel = env('CHANNEL');
const clientId = env('TWITCH_CLIENT_ID');
if (replayFile) {
  chatSource = new ReplayChatSource(replayFile, channel ?? 'streamer', Number(env('REPLAY_SPEED') ?? 1));
} else if (streamerToken && broadcasterUserId && botUserId && clientId && channel && botUsername) {
  chatSource = new EventSubChatSource({
    clientId, accessToken: streamerToken,
    getAccessToken: async () => await getStoredAccessToken('streamer', authOptions) ?? env('TWITCH_ACCESS_TOKEN') ?? streamerToken,
    broadcasterUserId, botUserId,
    chatReaderUserId: streamerIdentity?.userId ?? broadcasterUserId,
    channel, botUsername,
  });
}
if (chatSource) {
  void chatSource.start((message) => { if (!commandHandler.handle(message)) pipeline.add(message); }).catch((error: unknown) => {
    console.error('[Backlog] chat source failed', error instanceof Error ? error.message : error);
  });
  console.info(`[Backlog] chat source started${replayFile ? ' in replay mode' : ''}`);
} else if (!demoMode) {
  const missing = [
    !streamerToken && 'streamer token', !broadcasterUserId && 'TWITCH_BROADCASTER_USER_ID (or streamer token identity)',
    !botUserId && 'BOT_USER_ID (or bot token identity)', !clientId && 'TWITCH_CLIENT_ID', !channel && 'CHANNEL', !botUsername && 'BOT_USERNAME (or bot token identity)',
  ].filter(Boolean);
  console.error(`[Backlog] live mode: chat source not started; missing ${missing.join(', ')}`);
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
