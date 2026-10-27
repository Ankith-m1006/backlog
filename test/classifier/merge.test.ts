import { describe, expect, it } from 'vitest';
import { QuestionMerger } from '../../src/classifier/merge.js';
import type { ChatMessage } from '../../src/chat/types.js';

const message = (id: string, userLogin: string, sentAt: string): ChatMessage => ({ id, channel: 'streamer', userId: userLogin, userLogin, displayName: userLogin, text: 'Question?', isMod: false, isBroadcaster: false, isBot: false, sentAt });
const classification = (topicKey: string, isQuestion = true) => ({ id: 'unused', isQuestion, normalized: 'question', topicKey });

describe('QuestionMerger', () => {
  it('merges the same topic and accumulates count and unique askers', () => {
    const merger = new QuestionMerger();
    const first = merger.add(message('m1', 'alice', '2026-01-01T00:00:00Z'), { ...classification('blue-key'), id: 'm1' })!;
    const merged = merger.add(message('m2', 'bob', '2026-01-01T00:00:01Z'), { ...classification(' BLUE-KEY '), id: 'm2' })!;
    merger.add(message('m3', 'alice', '2026-01-01T00:00:02Z'), { ...classification('blue-key'), id: 'm3' });
    expect(first).toBe(merged);
    expect(merger.list()).toMatchObject([{ count: 3, askers: ['alice', 'bob'], topicKey: 'blue-key', updatedAt: '2026-01-01T00:00:02Z' }]);
  });

  it('ignores non-questions and keeps channel topics separate', () => {
    const merger = new QuestionMerger();
    expect(merger.add(message('m1', 'alice', '2026-01-01T00:00:00Z'), { ...classification('topic', false), id: 'm1' })).toBeUndefined();
    merger.add(message('m2', 'alice', '2026-01-01T00:00:00Z'), { ...classification('topic'), id: 'm2' });
    merger.add({ ...message('m3', 'bob', '2026-01-01T00:00:01Z'), channel: 'other' }, { ...classification('topic'), id: 'm3' });
    expect(merger.list()).toHaveLength(2);
  });
});
