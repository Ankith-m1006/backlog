import { afterEach, describe, expect, it } from 'vitest';
import { BacklogStore, rankScore } from '../../src/store/store.js';
import type { QueueQuestion } from '../../src/classifier/merge.js';

let store: BacklogStore;
afterEach(() => store?.close());
const item = (id: string, count: number, updatedAt: string, askerCounts: Record<string, number> = { alice: count }): QueueQuestion => ({
  id, channel: 'streamer', topicKey: id, normalized: id, text: `${id}?`, count,
  askers: Object.keys(askerCounts), askerCounts, createdAt: updatedAt, updatedAt,
});

describe('BacklogStore', () => {
  it('ranks with a five-minute half-life and always places pinned items first', () => {
    const now = Date.parse('2026-01-01T00:10:00.000Z');
    expect(rankScore(8, new Date(now - 5 * 60_000).toISOString(), now)).toBeCloseTo(4);
    store = new BacklogStore();
    store.upsertQuestion(item('old', 10, new Date(now - 10 * 60_000).toISOString()));
    store.upsertQuestion(item('fresh', 4, new Date(now).toISOString()));
    store.upsertQuestion(item('pinned', 1, new Date(now - 60 * 60_000).toISOString()));
    store.togglePin('pinned');
    expect(store.getQueue(now).map((question) => question.id)).toEqual(['pinned', 'fresh', 'old']);
  });

  it('keeps the distinct original wordings merged into an item, newest first', () => {
    store = new BacklogStore();
    const at = (minute: number): string => `2026-01-01T00:0${minute}:00Z`;
    store.upsertQuestion(item('kb', 1, at(1)), { userLogin: 'alice', text: 'what keyboard do you use?', sentAt: at(1) });
    store.upsertQuestion(item('kb', 2, at(2)), { userLogin: 'bob', text: 'which keyboard is that bro', sentAt: at(2) });
    store.upsertQuestion(item('kb', 3, at(3)), { userLogin: 'cara', text: 'What keyboard do you use?', sentAt: at(3) });
    for (const [index, text] of ['k1?', 'k2?', 'k3?', 'k4?'].entries()) {
      store.upsertQuestion(item('kb', 4 + index, at(4)), { userLogin: `v${index}`, text, sentAt: at(4) });
    }
    const queued = store.getQueue()[0]!;
    expect(queued.wordingCount).toBe(6);
    expect(queued.wordings.map((wording) => wording.text)).toEqual(['k4?', 'k3?', 'k2?', 'k1?', 'What keyboard do you use?']);
    expect(queued.wordings[4]).toMatchObject({ userLogin: 'cara', sentAt: at(3) });
  });

  it('persists questions, asker counts, saved answers, and lifecycle events', () => {
    store = new BacklogStore();
    store.upsertQuestion(item('q1', 3, '2026-01-01T00:00:00Z', { alice: 2, bob: 1 }));
    expect(store.getQueue()[0]).toMatchObject({ count: 3, askers: ['alice', 'bob'], askerCounts: { alice: 2, bob: 1 } });
    expect(store.setAnswered('q1')).toBe(true);
    expect(store.getQueue()).toHaveLength(0);
    const answer = store.createAnswer({ question: 'Where is the key?', answer: 'In the northern tower.', embedding: [0.1, 0.2] });
    expect(store.listAnswers()).toContainEqual(expect.objectContaining({ id: answer.id, embedding: [0.1, 0.2] }));
    expect(store.getEvents().map((event) => event.eventType)).toContain('question.answered');
  });

  it('hides dismissed items and preserves state while counts are refreshed', () => {
    store = new BacklogStore();
    store.upsertQuestion(item('q1', 1, '2026-01-01T00:00:00Z'));
    expect(store.dismiss('q1')).toBe(true);
    store.upsertQuestion(item('q1', 2, '2026-01-01T00:00:01Z', { alice: 2 }));
    expect(store.getQueue()).toHaveLength(0);
  });
});
