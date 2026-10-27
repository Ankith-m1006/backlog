import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type WebSocket from 'ws';
import { BacklogStore, type AnswerInput } from '../store/store.js';

interface AppOptions { store: BacklogStore }

export async function createApp({ store }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(websocket);
  const clients = new Set<WebSocket>();
  const broadcast = (): void => {
    const message = JSON.stringify({ type: 'queue', items: store.getQueue() });
    for (const client of clients) if (client.readyState === 1) client.send(message);
  };
  store.on('queueChanged', broadcast);

  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    socket.send(JSON.stringify({ type: 'queue', items: store.getQueue() }));
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });

  app.get('/api/queue', async () => ({ items: store.getQueue() }));
  app.post<{ Params: { id: string } }>('/api/items/:id/answered', async (request, reply) => {
    if (!store.setAnswered(request.params.id)) return reply.code(404).send({ error: 'Question not found' });
    return { ok: true };
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
  app.post<{ Body: AnswerInput }>('/api/answers', { schema: { body: answerSchema } }, async (request, reply) => reply.code(201).send({ answer: store.createAnswer(request.body) }));
  app.put<{ Params: { id: string }; Body: AnswerInput }>('/api/answers/:id', { schema: { body: answerSchema } }, async (request, reply) => {
    const answer = store.updateAnswer(request.params.id, request.body);
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
  properties: { question: { type: 'string', minLength: 1 }, answer: { type: 'string', minLength: 1 }, topicKey: { type: 'string' }, embedding: { type: 'array', items: { type: 'number' } } },
} as const;
