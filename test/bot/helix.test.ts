import { describe, expect, it, vi } from 'vitest';
import { HelixChatSender } from '../../src/bot/helix.js';
import type { SavedAnswer } from '../../src/store/store.js';

const savedAnswer: SavedAnswer = { id: 'a1', question: 'Where is the key?', answer: 'In the tower.', topicKey: 'key-location', embedding: [1, 0], createdAt: '', updatedAt: '' };

describe('HelixChatSender', () => {
  it('posts only the saved answer text as the configured bot', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const sender = new HelixChatSender({ clientId: 'client', accessToken: 'bot-token', broadcasterId: 'streamer-id', botUserId: 'bot-id', fetchImpl: fetchImpl as unknown as typeof fetch });
    await sender.sendSavedAnswer(savedAnswer);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.twitch.tv/helix/chat/messages', expect.objectContaining({ method: 'POST' }));
    const request = fetchImpl.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({ broadcaster_id: 'streamer-id', sender_id: 'bot-id', message: 'In the tower.' });
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer bot-token', 'Client-Id': 'client' });
  });
});
