import { describe, expect, it, vi } from 'vitest';
import { QuestionPipeline } from '../../src/classifier/pipeline.js';
import type { ChatMessage } from '../../src/chat/types.js';

const msg: ChatMessage = { id: 'm1', channel: 'streamer', userId: 'u1', userLogin: 'alice', displayName: 'Alice', text: 'How do I join?', isMod: false, isBroadcaster: false, isBot: false, sentAt: '2026-01-01T00:00:00Z' };
describe('QuestionPipeline', () => {
  it('batches eligible messages after the configured interval and merges results', async () => {
    vi.useFakeTimers();
    const classifyBatch = vi.fn().mockResolvedValue([
      { id: 'm1', isQuestion: true, normalized: 'How to join', topicKey: 'joining' },
      { id: 'm2', isQuestion: true, normalized: 'How to join', topicKey: 'joining' },
    ]);
    const pipeline = new QuestionPipeline({ apiKey: 'unused', intervalMs: 2000, classifyBatch });
    expect(pipeline.add(msg)).toBe(true); expect(pipeline.add({ ...msg, id: 'm2' })).toBe(true);
    await vi.advanceTimersByTimeAsync(1999); expect(classifyBatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(classifyBatch).toHaveBeenCalledOnce());
    expect(classifyBatch.mock.calls[0]?.[0]).toHaveLength(2);
    expect(pipeline.list()[0]).toMatchObject({ count: 2, askers: ['alice'] });
    pipeline.stop(); vi.useRealTimers();
  });
});
