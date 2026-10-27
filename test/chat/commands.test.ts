import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatCommandHandler, parseChatCommand } from '../../src/chat/commands.js';
import { BacklogStore } from '../../src/store/store.js';
import { SavedAnswerQueue } from '../../src/bot/saved-answer-queue.js';
import type { ChatMessage } from '../../src/chat/types.js';

let store: BacklogStore;
afterEach(() => store?.close());
const chat = (text: string, userLogin = 'alice', badges: Partial<Pick<ChatMessage, 'isMod' | 'isBroadcaster'>> = {}): ChatMessage => ({
  id: `${userLogin}-${text}`, channel: 'streamer', userId: userLogin, userLogin, displayName: userLogin,
  text, isMod: badges.isMod ?? false, isBroadcaster: badges.isBroadcaster ?? false, isBot: false, sentAt: '2026-01-01T00:00:00Z',
});

describe('viewer chat commands', () => {
  it('parses only exact supported commands', () => {
    expect(parseChatCommand(' !Q ')).toBe('q');
    expect(parseChatCommand('!qclear')).toBe('qclear');
    expect(parseChatCommand('!qclear please')).toBeUndefined();
    expect(parseChatCommand('!queue')).toBeUndefined();
  });

  it('replies with queue position and other ask count, or the no-question template', async () => {
    store = new BacklogStore();
    store.upsertQuestion({ id: 'q1', channel: 'streamer', topicKey: 'topic', normalized: 'Where is the key?', text: 'Where key?', count: 3, askers: ['alice', 'bob'], askerCounts: { alice: 1, bob: 2 }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    const sendTemplate = vi.fn().mockResolvedValue(undefined);
    const queue = new SavedAnswerQueue(store, { sendSavedAnswer: vi.fn(), sendTemplate }, { intervalMs: 0 });
    const handler = new ChatCommandHandler(store, queue);
    expect(handler.handle(chat('!q'))).toBe(true);
    await vi.waitFor(() => expect(sendTemplate).toHaveBeenCalledWith({ type: 'queue-position', userLogin: 'alice', place: 1, others: 2 }));
    handler.handle(chat('!q', 'carol'));
    await vi.waitFor(() => expect(sendTemplate).toHaveBeenCalledWith({ type: 'queue-not-found', userLogin: 'carol' }));
  });

  it('does not let a normal viewer clear the queue; mods and broadcaster can', () => {
    store = new BacklogStore();
    store.upsertQuestion({ id: 'q1', channel: 'streamer', topicKey: 'topic', normalized: 'question?', text: 'question?', count: 1, askers: ['alice'], askerCounts: { alice: 1 }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    const queue = new SavedAnswerQueue(store, { sendSavedAnswer: vi.fn(), sendTemplate: vi.fn() });
    const handler = new ChatCommandHandler(store, queue);
    handler.handle(chat('!qclear', 'viewer'));
    expect(store.getQueue()).toHaveLength(1);
    handler.handle(chat('!qclear', 'mod', { isMod: true }));
    expect(store.getQueue()).toHaveLength(0);
  });
});
