import type { SavedAnswer } from '../store/store.js';
import { renderBotTemplate, type BotTemplate } from './messages.js';

interface HelixSenderOptions {
  clientId: string;
  accessToken: string;
  getAccessToken?: () => Promise<string>;
  broadcasterId: string;
  botUserId: string;
  fetchImpl?: typeof fetch;
}

export interface OutgoingChatSender {
  sendSavedAnswer(answer: SavedAnswer): Promise<void>;
  sendTemplate(template: BotTemplate): Promise<void>;
}

export class HelixChatSender implements OutgoingChatSender {
  constructor(private readonly options: HelixSenderOptions) {}

  async sendSavedAnswer(answer: SavedAnswer): Promise<void> {
    await this.post(answer.answer);
  }

  async sendTemplate(template: BotTemplate): Promise<void> {
    await this.post(renderBotTemplate(template));
  }

  private async post(message: string): Promise<void> {
    const accessToken = this.options.getAccessToken ? await this.options.getAccessToken() : this.options.accessToken;
    const response = await (this.options.fetchImpl ?? fetch)('https://api.twitch.tv/helix/chat/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': this.options.clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ broadcaster_id: this.options.broadcasterId, sender_id: this.options.botUserId, message }),
    });
    if (!response.ok) throw new Error(`Twitch chat send failed (${response.status})`);
  }
}
