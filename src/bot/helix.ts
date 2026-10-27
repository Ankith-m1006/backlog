import type { SavedAnswer } from '../store/store.js';

interface HelixSenderOptions {
  clientId: string;
  accessToken: string;
  broadcasterId: string;
  botUserId: string;
  fetchImpl?: typeof fetch;
}

export interface SavedAnswerSender { send(answer: SavedAnswer): Promise<void> }

export class HelixChatSender implements SavedAnswerSender {
  constructor(private readonly options: HelixSenderOptions) {}

  async send(answer: SavedAnswer): Promise<void> {
    const response = await (this.options.fetchImpl ?? fetch)('https://api.twitch.tv/helix/chat/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.accessToken}`,
        'Client-Id': this.options.clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ broadcaster_id: this.options.broadcasterId, sender_id: this.options.botUserId, message: answer.answer }),
    });
    if (!response.ok) throw new Error(`Twitch chat send failed (${response.status})`);
  }
}
