import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type WebSocket from 'ws';
import { BacklogStore, type AnswerInput } from '../store/store.js';
import type { SavedAnswerService } from '../answers/service.js';
import type { SavedAnswerQueue } from '../bot/saved-answer-queue.js';

interface AppOptions { store: BacklogStore; webRoot?: string; answerService?: SavedAnswerService; answerQueue?: SavedAnswerQueue }

export async function createApp({ store, webRoot, answerService, answerQueue }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(websocket);
  if (webRoot && existsSync(resolve(webRoot, 'index.html'))) {
    await app.register(fastifyStatic, { root: resolve(webRoot), prefix: '/', wildcard: false });
    for (const path of ['/overlay', '/control']) {
      app.get(path, async (_request, reply) => reply.sendFile('index.html'));
    }
  }
  const clients = new Set<WebSocket>();
  const queueSnapshot = async (): Promise<{ type: string; items: unknown[] }> => ({
    type: 'queue',
    items: answerService ? await answerService.suggestMany(store.getQueue()) : store.getQueue().map((item) => ({ ...item, suggestedAnswer: null })),
  });
  const broadcast = (): void => {
    void queueSnapshot().then((snapshot) => {
      const message = JSON.stringify(snapshot);
      for (const client of clients) if (client.readyState === 1) client.send(message);
    }).catch((error: unknown) => app.log.error(error));
  };
  store.on('queueChanged', broadcast);

  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    void queueSnapshot().then((snapshot) => { if (socket.readyState === 1) socket.send(JSON.stringify(snapshot)); });
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });

  app.get('/api/queue', async () => queueSnapshot());
  app.post<{ Params: { id: string }; Body?: { answerId?: string } }>('/api/items/:id/answered', async (request, reply) => {
    const question = store.getQueue().find((item) => item.id === request.params.id);
    if (!question) return reply.code(404).send({ error: 'Question not found' });
    const body = request.body as unknown;
    if (body !== undefined && (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).some((key) => key !== 'answerId') || ('answerId' in body && (typeof body.answerId !== 'string' || !body.answerId.trim())))) {
      return reply.code(400).send({ error: 'Only a saved answer ID may be sent' });
    }
    const answerId = body && typeof body === 'object' && 'answerId' in body ? String(body.answerId) : undefined;
    if (answerId) {
      if (!store.getAnswer(answerId)) return reply.code(404).send({ error: 'Saved answer not found' });
      if (!answerQueue) return reply.code(503).send({ error: 'Chat sending is not configured' });
      if (!answerQueue.enqueueSavedAnswer(answerId)) return reply.code(404).send({ error: 'Saved answer not found' });
    }
    store.setAnswered(request.params.id, answerId);
    return { ok: true, queuedForChat: Boolean(answerId) };
  });
  app.post<{ Params: { id: string } }>('/api/items/:id/dismiss', async (request, reply) => {
    if (!store.dismiss(request.params.id)) return reply.code(404).send({ error: 'Question not found' });
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/items/:id/pin', async (request, reply) => {
    const pinned = store.togglePin(request.params.id);
    if (pinned === undefined) return reply.code(404).send({ error: 'Question not found' });
    return { pinned };
  });

  app.get('/api/answers', async () => ({ answers: store.listAnswers() }));
  app.post<{ Body: Omit<AnswerInput, 'embedding'> }>('/api/answers', { schema: { body: answerSchema } }, async (request, reply) => {
    const answer = answerService ? await answerService.create(request.body) : store.createAnswer(request.body);
    return reply.code(201).send({ answer });
  });
  app.put<{ Params: { id: string }; Body: Omit<AnswerInput, 'embedding'> }>('/api/answers/:id', { schema: { body: answerSchema } }, async (request, reply) => {
    const answer = answerService ? await answerService.update(request.params.id, request.body) : store.updateAnswer(request.params.id, request.body);
    if (!answer) return reply.code(404).send({ error: 'Answer not found' });
    return { answer };
  });
  app.delete<{ Params: { id: string } }>('/api/answers/:id', async (request, reply) => {
    if (!store.deleteAnswer(request.params.id)) return reply.code(404).send({ error: 'Answer not found' });
    return { ok: true };
  });

  app.addHook('onClose', async () => { store.off('queueChanged', broadcast); clients.clear(); });
  return app;
}

const answerSchema = {
  type: 'object', additionalProperties: false, required: ['question', 'answer'],
  properties: { question: { type: 'string', minLength: 1 }, answer: { type: 'string', minLength: 1 }, topicKey: { type: 'string' } },
} as const;

