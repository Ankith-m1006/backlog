import { afterEach, describe, expect, it } from 'vitest';
import { BacklogStore, type StoredQuestion } from '../../src/store/store.js';
import { SavedAnswerService } from '../../src/answers/service.js';

let store: BacklogStore;
afterEach(() => store?.close());
const question: StoredQuestion = {
  id: 'q1', channel: 'streamer', topicKey: 'join', normalized: 'How can I join the lobby?', text: 'How do I join?',
  count: 1, askers: ['alice'], askerCounts: { alice: 1 }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  status: 'open', pinned: false, rankScore: 1,
};

describe('SavedAnswerService', () => {
  it('stores a reference-question embedding and suggests the saved answer with its score', async () => {
    store = new BacklogStore();
    const service = new SavedAnswerService(store, { apiKey: 'unused', embed: async () => [1, 0] });
    const saved = await service.create({ question: 'How can I join the lobby?', answer: 'Type !join.' });
    store.upsertQuestion(question);
    expect(saved.embedding).toEqual([1, 0]);
    expect(await service.suggest(question)).toEqual({ id: saved.id, question: saved.question, answer: 'Type !join.', score: 1 });
  });

  it('returns no suggestion below the configured cosine threshold', async () => {
    store = new BacklogStore();
    store.createAnswer({ question: 'How do I join?', answer: 'Use !join.', embedding: [1, 0] });
    const service = new SavedAnswerService(store, { apiKey: 'unused', threshold: 0.82, embed: async () => [0.8, 0.6] });
    expect(await service.suggest(question)).toBeNull();
  });

  it('accepts a cosine score exactly on the threshold boundary', async () => {
    store = new BacklogStore();
    store.createAnswer({ question: 'How do I join?', answer: 'Use !join.', embedding: [1, 0] });
    const service = new SavedAnswerService(store, { apiKey: 'unused', threshold: 0.82, embed: async () => [0.82, Math.sqrt(1 - 0.82 ** 2)] });
    expect((await service.suggest(question))?.score).toBeCloseTo(0.82, 12);
  });
});
