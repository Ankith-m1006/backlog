import { describe, expect, it, vi } from 'vitest';
import { QuestionPipeline } from '../../src/classifier/pipeline.js';
import type { ChatMessage } from '../../src/chat/types.js';
import { cosineSimilarity } from '../../src/classifier/embedding.js';
import type { OpenQuestionContext } from '../../src/classifier/openai.js';

const msg: ChatMessage = { id: 'm1', channel: 'streamer', userId: 'u1', userLogin: 'alice', displayName: 'Alice', text: 'How do I join?', isMod: false, isBroadcaster: false, isBot: false, sentAt: '2026-01-01T00:00:00Z' };
describe('QuestionPipeline', () => {
  it('batches eligible messages after the configured interval and merges results', async () => {
    vi.useFakeTimers();
    const classifyBatch = vi.fn().mockResolvedValue([
      { id: 'm1', isQuestion: true, normalized: 'How to join', topicKey: 'joining' },
      { id: 'm2', isQuestion: true, normalized: 'How to join', topicKey: 'joining' },
    ]);
    const pipeline = new QuestionPipeline({ apiKey: 'unused', intervalMs: 2000, classifyBatch, embedNormalized: async () => [1, 0] });
    expect(pipeline.add(msg)).toBe(true); expect(pipeline.add({ ...msg, id: 'm2' })).toBe(true);
    await vi.advanceTimersByTimeAsync(1999); expect(classifyBatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(classifyBatch).toHaveBeenCalledOnce());
    expect(classifyBatch.mock.calls[0]?.[0]).toHaveLength(2);
    expect(pipeline.list()[0]).toMatchObject({ count: 2, askers: ['alice'] });
    pipeline.stop(); vi.useRealTimers();
  });

  it('merges semantically duplicate questions across batches and sends recent queue context', async () => {
    const classifyBatch = vi.fn(async (batch: ChatMessage[], context: OpenQuestionContext[]) => {
      expect(context).toBeDefined();
      return batch.map((item) => ({
        id: item.id, isQuestion: true,
        normalized: item.id === 'm1' ? 'where to find the blue key' : 'location of blue key',
        topicKey: item.id === 'm1' ? 'blue-key-location' : 'find-blue-key',
      }));
    });
    const pipeline = new QuestionPipeline({ apiKey: 'unused', classifyBatch, embedNormalized: async () => [1, 0] });
    pipeline.add(msg); await pipeline.flush();
    pipeline.add({ ...msg, id: 'm2', userLogin: 'bob', text: 'Where is the blue key hiding?' }); await pipeline.flush();
    expect(pipeline.list()).toMatchObject([{ count: 2, askers: ['alice', 'bob'], topicKey: 'blue-key-location' }]);
    expect(classifyBatch.mock.calls[1]?.[1]).toEqual([{ topicKey: 'blue-key-location', normalized: 'where to find the blue key' }]);
    pipeline.stop();
  });

  it('keeps unrelated questions in separate queue items', async () => {
    const classifyBatch = vi.fn(async (batch: ChatMessage[]) => batch.map((item) => ({ id: item.id, isQuestion: true, normalized: item.text, topicKey: item.id })));
    const embedNormalized = async (text: string) => text.includes('sensitivity') ? [0, 1] : [1, 0];
    const pipeline = new QuestionPipeline({ apiKey: 'unused', classifyBatch, embedNormalized });
    pipeline.add(msg); await pipeline.flush();
    pipeline.add({ ...msg, id: 'm2', userLogin: 'bob', text: 'What sensitivity should I use?' }); await pipeline.flush();
    expect(pipeline.list()).toHaveLength(2); expect(pipeline.list().map((item) => item.count)).toEqual([1, 1]);
    pipeline.stop();
  });

  it('merges at cosine 0.88 and keeps a score just below the boundary separate', async () => {
    const boundary = Math.sqrt(1 - 0.88 ** 2);
    expect(cosineSimilarity([1, 0], [0.88, boundary])).toBeCloseTo(0.88, 12);
    const classifyBatch = vi.fn(async (batch: ChatMessage[]) => batch.map((item) => ({ id: item.id, isQuestion: true, normalized: item.text, topicKey: item.id })));
    let vector = [1, 0];
    const pipeline = new QuestionPipeline({ apiKey: 'unused', classifyBatch, embedNormalized: async () => vector });
    pipeline.add(msg); await pipeline.flush();
    vector = [0.88, boundary];
    pipeline.add({ ...msg, id: 'm2', userLogin: 'bob' }); await pipeline.flush();
    expect(pipeline.list()).toHaveLength(1); expect(pipeline.list()[0]?.count).toBe(2);
    vector = [0.879, Math.sqrt(1 - 0.879 ** 2)];
    pipeline.add({ ...msg, id: 'm3', userLogin: 'carol' }); await pipeline.flush();
    expect(pipeline.list()).toHaveLength(2);
    pipeline.stop();
  });
});
