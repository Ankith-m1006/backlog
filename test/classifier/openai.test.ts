import { describe, expect, it, vi } from 'vitest';
import { classify } from '../../src/classifier/openai.js';
import type { ChatMessage } from '../../src/chat/types.js';

const messages: ChatMessage[] = [
  { id: 'm1', channel: 'streamer', userId: 'u1', userLogin: 'viewer1', displayName: 'Viewer 1', text: 'How do I get the blue key?', isMod: false, isBroadcaster: false, isBot: false, sentAt: '2026-01-01T00:00:00Z' },
];
const mockResponse = (results: unknown[]) => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ results }) } }] }) });

describe('classify', () => {
  it('sends a strict schema request and returns normalized classifications', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse([{ id: 'm1', isQuestion: true, normalized: 'How to find the blue key', topicKey: 'blue key location' }]));
    const result = await classify(messages, { apiKey: 'test-key', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual([{ id: 'm1', isQuestion: true, normalized: 'How to find the blue key', topicKey: 'blue key location' }]);
    const request = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(request.model).toBe('gpt-6-luna');
    expect(request).not.toHaveProperty('temperature');
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('includes up to 30 open queue items as context for topic-key reuse', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse([{ id: 'm1', isQuestion: true, normalized: 'blue key location', topicKey: 'blue-key' }]));
    const openItems = Array.from({ length: 31 }, (_, index) => ({ topicKey: `topic-${index}`, normalized: `question ${index}` }));
    await classify(messages, { apiKey: 'test-key', fetchImpl: fetchImpl as unknown as typeof fetch }, openItems);
    const request = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    const promptData = JSON.parse(request.messages[1].content);
    expect(promptData.openItems).toHaveLength(30);
    expect(request.messages[0].content).toContain('reuse that item');
  });

  it('clears normalized fields for non-questions', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse([{ id: 'm1', isQuestion: false, normalized: 'ignored', topicKey: 'ignored' }]));
    expect(await classify(messages, { apiKey: 'test', fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual([{ id: 'm1', isQuestion: false, normalized: '', topicKey: '' }]);
  });

  it('rejects malformed classifier output instead of guessing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse([]));
    await expect(classify(messages, { apiKey: 'test', fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow('wrong number');
  });

  it('includes OpenAI error detail without exposing the API key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => '{"error":{"message":"unsupported model parameter"}}' });
    await expect(classify(messages, { apiKey: 'secret-key', fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow('unsupported model parameter');
  });
});
