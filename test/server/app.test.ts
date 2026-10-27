import { afterEach, describe, expect, it, vi } from 'vitest';
import { BacklogStore } from '../../src/store/store.js';
import { createApp } from '../../src/server/app.js';
import type { QueueQuestion } from '../../src/classifier/merge.js';
import { resolve } from 'node:path';
import { SavedAnswerQueue } from '../../src/bot/saved-answer-queue.js';
import { SavedAnswerService } from '../../src/answers/service.js';

let store: BacklogStore | undefined;
let app: Awaited<ReturnType<typeof createApp>> | undefined;
afterEach(async () => { await app?.close(); app = undefined; store?.close(); store = undefined; });

const question: QueueQuestion = {
  id: 'q1', channel: 'streamer', topicKey: 'blue-key', normalized: 'blue key location', text: 'Where is the blue key?',
  count: 2, askers: ['alice', 'bob'], askerCounts: { alice: 1, bob: 1 },
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:01Z',
};

describe('Fastify API', () => {
  it('serves the ranked queue and item actions', async () => {
    store = new BacklogStore(); store.upsertQuestion(question); app = await createApp({ store });
    const queue = await app.inject({ method: 'GET', url: '/api/queue' });
    expect(queue.statusCode).toBe(200); expect(queue.json().items[0]).toMatchObject({ id: 'q1', count: 2, askers: ['alice', 'bob'] });
    expect((await app.inject({ method: 'POST', url: '/api/items/q1/pin' })).json()).toEqual({ pinned: true });
    expect((await app.inject({ method: 'POST', url: '/api/items/q1/answered' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/queue' })).json().items).toHaveLength(0);
    expect((await app.inject({ method: 'POST', url: '/api/items/missing/dismiss' })).statusCode).toBe(404);
  });

  it('supports saved answer CRUD with input validation', async () => {
    store = new BacklogStore(); app = await createApp({ store });
    expect((await app.inject({ method: 'POST', url: '/api/answers', payload: { question: '', answer: 'A' } })).statusCode).toBe(400);
    const created = await app.inject({ method: 'POST', url: '/api/answers', payload: { question: 'Where is the key?', answer: 'In the tower.' } });
    expect(created.statusCode).toBe(201);
    const id = created.json().answer.id as string;
    expect((await app.inject({ method: 'GET', url: '/api/answers' })).json().answers).toHaveLength(1);
    expect((await app.inject({ method: 'PUT', url: `/api/answers/${id}`, payload: { question: 'Where?', answer: 'There.' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/answers/${id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/answers' })).json().answers).toHaveLength(0);
  });

  it('queues only an existing saved answer when marking a question answered', async () => {
    store = new BacklogStore(); store.upsertQuestion(question);
    const saved = store.createAnswer({ question: 'Where is the blue key?', answer: 'In the northern tower.' });
    const send = vi.fn().mockResolvedValue(undefined);
    const sendTemplate = vi.fn().mockResolvedValue(undefined);
    const answerQueue = new SavedAnswerQueue(store, { sendSavedAnswer: send, sendTemplate }, { intervalMs: 1 });
    app = await createApp({ store, answerQueue });
    const rejected = await app.inject({ method: 'POST', url: '/api/items/q1/answered', payload: { answer: 'invented text' } });
    expect(rejected.statusCode).toBe(400);
    const accepted = await app.inject({ method: 'POST', url: '/api/items/q1/answered', payload: { answerId: saved.id } });
    expect(accepted.json()).toEqual({ ok: true, queuedForChat: true });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: saved.id, answer: 'In the northern tower.' })));
    await vi.waitFor(() => expect(sendTemplate).toHaveBeenCalledWith({ type: 'answered-askers', userLogins: ['alice', 'bob'] }));
    expect(store.getQueue()).toHaveLength(0);
  });

  it('returns an embedded saved-answer suggestion and score in queue responses', async () => {
    store = new BacklogStore(); store.upsertQuestion(question);
    store.createAnswer({ question: question.normalized, answer: 'Use the lift.', embedding: [1, 0] });
    const answerService = new SavedAnswerService(store, { apiKey: 'unused', embed: async () => [1, 0] });
    app = await createApp({ store, answerService });
    const response = await app.inject({ method: 'GET', url: '/api/queue' });
    expect(response.json().items[0].suggestedAnswer).toMatchObject({ question: question.normalized, answer: 'Use the lift.', score: 1 });
  });

  it('pushes initial and changed queue snapshots over WebSocket', async () => {
    store = new BacklogStore(); app = await createApp({ store });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const socket = new WebSocket(address.replace('http', 'ws') + '/ws');
    await new Promise<void>((resolve, reject) => { socket.addEventListener('open', () => resolve(), { once: true }); socket.addEventListener('error', () => reject(new Error('WebSocket failed')), { once: true }); });
    const receive = (): Promise<{ type: string; items: Array<{ id: string }> }> => new Promise((resolve) => socket.addEventListener('message', (event) => resolve(JSON.parse(String(event.data)) as { type: string; items: Array<{ id: string }> }), { once: true }));
    expect((await receive()).items).toHaveLength(0);
    const changed = receive(); store.upsertQuestion(question);
    expect((await changed).items.map((item) => item.id)).toEqual(['q1']);
    socket.close();
  });

  it('serves the React page at both product routes when a production bundle is configured', async () => {
    store = new BacklogStore();
    app = await createApp({ store, webRoot: resolve('dist/web') });
    const overlay = await app.inject({ method: 'GET', url: '/overlay' });
    const control = await app.inject({ method: 'GET', url: '/control' });
    expect(overlay.statusCode).toBe(200); expect(overlay.body).toContain('/assets/index-');
    expect(control.statusCode).toBe(200); expect(control.body).toBe(overlay.body);
  });
});
