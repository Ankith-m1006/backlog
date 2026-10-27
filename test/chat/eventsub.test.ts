import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventSubChatSource } from '../../src/chat/eventsub.js';
import type { ChatMessage } from '../../src/chat/types.js';

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  close = vi.fn(() => { this.readyState = FakeWebSocket.CLOSED; this.dispatchEvent(new Event('close')); });
  constructor(readonly url: string) { super(); FakeWebSocket.instances.push(this); }
  open(): void { this.readyState = FakeWebSocket.OPEN; this.dispatchEvent(new Event('open')); }
  message(payload: unknown): void { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) })); }
}
const options = { clientId: 'client', accessToken: 'token', broadcasterUserId: 'streamer-id', channel: 'streamer', botUsername: 'backlogbot', botUserId: 'bot-id' };
const welcome = { metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'session-1', keepalive_timeout_seconds: 10 } } };
const notification = (event: Record<string, unknown>) => ({ metadata: { message_type: 'notification', message_timestamp: '2026-01-02T03:04:05Z' }, payload: { subscription: { type: 'channel.chat.message' }, event } });

describe('EventSubChatSource', () => {
  beforeEach(() => { vi.stubGlobal('WebSocket', FakeWebSocket); FakeWebSocket.instances = []; vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 202 })); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('maps chat payloads into the shared message type', async () => {
    const source = new EventSubChatSource(options); const received: ChatMessage[] = [];
    const started = source.start((message) => received.push(message)); const socket = FakeWebSocket.instances[0]!; socket.open(); await started;
    socket.message(welcome); await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    socket.message(notification({ message_id: 'm1', chatter_user_id: 'u1', chatter_user_login: 'player', chatter_user_name: 'Player One', message: { text: 'How do I join?' }, badges: [{ set_id: 'moderator' }] }));
    expect(received[0]).toEqual({ id: 'm1', channel: 'streamer', userId: 'u1', userLogin: 'player', displayName: 'Player One', text: 'How do I join?', isMod: true, isBroadcaster: false, isBot: false, sentAt: '2026-01-02T03:04:05Z' });
    await source.stop();
  });
  it('ignores bot messages', async () => {
    const source = new EventSubChatSource(options); const received: unknown[] = [];
    const started = source.start((message) => received.push(message)); const socket = FakeWebSocket.instances[0]!; socket.open(); await started;
    socket.message(notification({ message_id: 'm1', chatter_user_login: 'BacklogBot', message: { text: 'answer' } }));
    expect(received).toHaveLength(0); await source.stop();
  });
  it('reconnects after keepalive timeout plus five seconds', async () => {
    vi.useFakeTimers(); const source = new EventSubChatSource(options);
    const started = source.start(() => {}); const socket = FakeWebSocket.instances[0]!; socket.open(); await started;
    socket.message(welcome); await Promise.resolve(); await vi.advanceTimersByTimeAsync(15_000);
    expect(FakeWebSocket.instances).toHaveLength(2); expect(socket.close).toHaveBeenCalled(); await source.stop();
  });
  it('switches to the reconnect URL before closing the old socket', async () => {
    const source = new EventSubChatSource(options); const started = source.start(() => {}); const oldSocket = FakeWebSocket.instances[0]!; oldSocket.open(); await started;
    oldSocket.message({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://new-session.test/ws' } } });
    const newSocket = FakeWebSocket.instances[1]!; expect(newSocket.url).toBe('wss://new-session.test/ws'); newSocket.open();
    await vi.waitFor(() => expect(oldSocket.close).toHaveBeenCalled()); await source.stop();
  });
});
