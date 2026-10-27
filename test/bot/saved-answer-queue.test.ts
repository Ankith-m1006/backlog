import { afterEach, describe, expect, it, vi } from 'vitest';
import { BacklogStore } from '../../src/store/store.js';
import { SavedAnswerQueue } from '../../src/bot/saved-answer-queue.js';

let store: BacklogStore;
afterEach(() => { vi.useRealTimers(); store?.close(); });

describe('SavedAnswerQueue', () => {
  it('queues saved answer IDs and rate limits sends without dropping later messages', async () => {
    vi.useFakeTimers();
    store = new BacklogStore();
    const first = store.createAnswer({ question: 'Where is the key?', answer: 'At the tower.' });
    const second = store.createAnswer({ question: 'What is the code?', answer: 'The code is 1234.' });
    const send = vi.fn().mockResolvedValue(undefined);
    const queue = new SavedAnswerQueue(store, { send }, { intervalMs: 10_000 });
    expect(queue.enqueueSavedAnswer('not-saved')).toBe(false);
    expect(queue.enqueueSavedAnswer(first.id)).toBe(true);
    await Promise.resolve(); expect(send).toHaveBeenCalledOnce();
    expect(queue.enqueueSavedAnswer(second.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(9_999); expect(send).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([answer]) => answer.answer)).toEqual(['At the tower.', 'The code is 1234.']);
  });

  it('re-reads queued records before sending so deleted answers are skipped', async () => {
    vi.useFakeTimers();
    store = new BacklogStore();
    const first = store.createAnswer({ question: 'Q1?', answer: 'Saved text one.' });
    const second = store.createAnswer({ question: 'Q2?', answer: 'Saved text two.' });
    const send = vi.fn();
    let release: (() => void) | undefined;
    const queue = new SavedAnswerQueue(store, { send: async (answer) => {
      send(answer);
      if (answer.id === first.id) await new Promise<void>((resolve) => { release = resolve; });
    } });
    queue.enqueueSavedAnswer(first.id); await vi.waitFor(() => expect(release).toBeDefined());
    queue.enqueueSavedAnswer(second.id); store.deleteAnswer(second.id); release?.();
    await vi.advanceTimersByTimeAsync(10_000); await vi.waitFor(() => expect(queue.pending).toBe(0));
    expect(send.mock.calls.map(([answer]) => answer.id)).toEqual([first.id]);
  });
});
