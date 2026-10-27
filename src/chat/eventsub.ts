import type { ChatMessage, ChatSource } from './types.js';

interface EventSubOptions {
  clientId: string;
  accessToken: string;
  getAccessToken?: () => Promise<string>;
  broadcasterUserId: string;
  channel: string;
  botUsername: string;
  botUserId: string;
  chatReaderUserId?: string;
}

type SocketLike = WebSocket;
type EventHandler = (event: { data?: unknown }) => void;
interface ChatEvent {
  message_id?: string;
  chatter_user_id?: string;
  chatter_user_login?: string;
  chatter_user_name?: string;
  message?: { text?: string };
  badges?: Array<{ set_id?: string }>;
}

function listen(socket: SocketLike, type: string, handler: EventHandler): void {
  socket.addEventListener(type, handler as EventListener);
}

export class EventSubChatSource implements ChatSource {
  private socket: SocketLike | undefined;
  private onMessage: ((message: ChatMessage) => void) | undefined;
  private keepaliveTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;

  constructor(private readonly options: EventSubOptions) {}

  async start(onMessage: (message: ChatMessage) => void): Promise<void> {
    if (this.socket) return;
    this.onMessage = onMessage;
    this.stopped = false;
    await this.connect('wss://eventsub.wss.twitch.tv/ws');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearKeepalive();
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Backlog stopped');
  }

  private connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      listen(socket, 'open', () => resolve());
      listen(socket, 'error', () => reject(new Error('EventSub WebSocket connection failed')));
      listen(socket, 'message', (event) => { void this.handleFrame(socket, event.data); });
      listen(socket, 'close', () => {
        if (this.socket === socket) { this.socket = undefined; this.clearKeepalive(); }
      });
      this.socket = socket;
    });
  }

  private async handleFrame(socket: SocketLike, data: unknown): Promise<void> {
    if (this.stopped) return;
    let frame: { metadata?: { message_type?: string; message_timestamp?: string }; payload?: { session?: { id?: string; keepalive_timeout_seconds?: number; reconnect_url?: string }; subscription?: { type?: string }; event?: ChatEvent } };
    try { frame = JSON.parse(String(data)) as typeof frame; } catch { return; }
    this.clearKeepalive();
    const type = frame.metadata?.message_type;
    const payload = frame.payload ?? {};
    if (type === 'session_welcome') {
      const session = payload.session;
      if (!session?.id) return;
      this.armKeepalive((session.keepalive_timeout_seconds ?? 10) + 5);
      await this.createSubscription(session.id);
      return;
    }
    if (type === 'session_keepalive') {
      this.armKeepalive((payload.session?.keepalive_timeout_seconds ?? 10) + 5);
      return;
    }
    if (type === 'session_reconnect') {
      const reconnectUrl = payload.session?.reconnect_url;
      if (reconnectUrl) void this.switchSocket(socket, reconnectUrl);
      return;
    }
    if (type === 'revocation') { await this.stop(); return; }
    if (type !== 'notification' || payload.subscription?.type !== 'channel.chat.message') return;

    const event = payload.event;
    if (!event) return;
    const badges = Array.isArray(event.badges) ? event.badges as Array<{ set_id?: string }> : [];
    const userLogin = String(event.chatter_user_login ?? '');
    if (userLogin.toLowerCase() === this.options.botUsername.toLowerCase()) return;
    const isBroadcaster = event.chatter_user_id === this.options.broadcasterUserId || badges.some((badge) => badge.set_id === 'broadcaster');
    this.onMessage?.({
      id: String(event.message_id ?? ''), channel: this.options.channel,
      userId: String(event.chatter_user_id ?? ''), userLogin,
      displayName: String(event.chatter_user_name ?? userLogin), text: String(event.message?.text ?? ''),
      isMod: badges.some((badge) => badge.set_id === 'moderator'), isBroadcaster, isBot: false,
      sentAt: String(frame.metadata?.message_timestamp ?? new Date().toISOString()),
    });
  }

  private async createSubscription(sessionId: string): Promise<void> {
    const accessToken = this.options.getAccessToken ? await this.options.getAccessToken() : this.options.accessToken;
    const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': this.options.clientId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: this.options.broadcasterUserId, user_id: this.options.chatReaderUserId ?? this.options.botUserId }, transport: { method: 'websocket', session_id: sessionId } }),
    });
    if (!response.ok) throw new Error(`EventSub subscription failed (${response.status})`);
  }

  private armKeepalive(seconds: number): void {
    this.clearKeepalive();
    this.keepaliveTimer = setTimeout(() => { if (!this.stopped) void this.reconnect(); }, seconds * 1000);
  }

  private clearKeepalive(): void {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = undefined;
  }

  private async reconnect(): Promise<void> {
    await this.stop(); this.stopped = false;
    try { await this.connect('wss://eventsub.wss.twitch.tv/ws'); }
    catch { if (!this.stopped) setTimeout(() => void this.reconnect(), 1000); }
  }

  private async switchSocket(oldSocket: SocketLike, reconnectUrl: string): Promise<void> {
    try {
      await this.connect(reconnectUrl);
      if (oldSocket.readyState < WebSocket.CLOSING) oldSocket.close(1000, 'Session transferred');
    } catch { if (!this.stopped) void this.reconnect(); }
  }
}
