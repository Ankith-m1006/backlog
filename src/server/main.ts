import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { EventSubChatSource } from '../chat/eventsub.js';
import { ReplayChatSource } from '../chat/replay.js';
import type { ChatSource } from '../chat/types.js';
import { QuestionPipeline } from '../classifier/pipeline.js';
import type { Classification } from '../classifier/openai.js';
import type { ChatMessage } from '../chat/types.js';
import { BacklogStore } from '../store/store.js';
import { SavedAnswerService } from '../answers/service.js';
import { HelixChatSender } from '../bot/helix.js';
import { SavedAnswerQueue } from '../bot/saved-answer-queue.js';
import { createApp } from './app.js';

const dbPath = resolve(process.env.BACKLOG_DB_PATH ?? 'data/backlog.sqlite');
await mkdir(dirname(dbPath), { recursive: true });
const store = new BacklogStore(dbPath);
const demoMode = process.env.BACKLOG_DEMO_MODE === '1';
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
const answerQueue = process.env.TWITCH_ACCESS_TOKEN && process.env.TWITCH_CLIENT_ID && process.env.TWITCH_BROADCASTER_USER_ID && process.env.BOT_USER_ID
  ? new SavedAnswerQueue(store, new HelixChatSender({
    accessToken: process.env.TWITCH_ACCESS_TOKEN, clientId: process.env.TWITCH_CLIENT_ID,
    broadcasterId: process.env.TWITCH_BROADCASTER_USER_ID, botUserId: process.env.BOT_USER_ID,
  }), { onError: (error) => console.error('[Backlog] saved answer send failed', error.message) })
  : undefined;
const app = await createApp({ store, webRoot: resolve('dist/web'), answerService, answerQueue });
const port = Number(process.env.PORT ?? 3001);
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port });
console.info(`[Backlog] server listening on ${port}`);

let chatSource: ChatSource | undefined;
if (process.env.BACKLOG_REPLAY_FILE) {
  chatSource = new ReplayChatSource(process.env.BACKLOG_REPLAY_FILE, process.env.CHANNEL ?? 'streamer', Number(process.env.REPLAY_SPEED ?? 1));
} else if (process.env.TWITCH_ACCESS_TOKEN && process.env.TWITCH_BROADCASTER_USER_ID && process.env.BOT_USER_ID && process.env.TWITCH_CLIENT_ID && process.env.CHANNEL && process.env.BOT_USERNAME) {
  chatSource = new EventSubChatSource({
    clientId: process.env.TWITCH_CLIENT_ID, accessToken: process.env.TWITCH_ACCESS_TOKEN,
    broadcasterUserId: process.env.TWITCH_BROADCASTER_USER_ID, botUserId: process.env.BOT_USER_ID,
    channel: process.env.CHANNEL, botUsername: process.env.BOT_USERNAME,
  });
}
if (chatSource) {
  void chatSource.start((message) => { pipeline.add(message); }).then(() => {
    console.info(`[Backlog] chat source finished${process.env.BACKLOG_REPLAY_FILE ? ' replay' : ''}`);
  }).catch((error: unknown) => {
    console.error('[Backlog] chat source failed', error instanceof Error ? error.message : error);
  });
  console.info(`[Backlog] chat source started${process.env.BACKLOG_REPLAY_FILE ? ' in replay mode' : ''}`);
}

const shutdown = async (): Promise<void> => {
  pipeline.stop();
  await chatSource?.stop();
  await app.close();
  store.close();
};
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
