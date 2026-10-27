import type { ChatMessage } from './types.js';
import { BacklogStore } from '../store/store.js';
import { SavedAnswerQueue } from '../bot/saved-answer-queue.js';

export type ChatCommand = 'q' | 'qclear' | undefined;

export function parseChatCommand(text: string): ChatCommand {
  const command = text.trim().toLowerCase();
  if (command === '!q') return 'q';
  if (command === '!qclear') return 'qclear';
  return undefined;
}

export class ChatCommandHandler {
  constructor(private readonly store: BacklogStore, private readonly botQueue?: SavedAnswerQueue) {}

  handle(message: ChatMessage): boolean {
    const command = parseChatCommand(message.text);
    if (!command) return false;
    if (command === 'qclear') {
      if (message.isMod || message.isBroadcaster) this.store.clearOpenQueue();
      return true;
    }
    const login = message.userLogin.toLowerCase();
    if (!this.botQueue) return true;
    const items = this.store.getQueue();
    const index = items.findIndex((item) => item.askers.some((asker) => asker.toLowerCase() === login));
    if (index < 0) {
      this.botQueue.enqueueTemplate({ type: 'queue-not-found', userLogin: login });
      return true;
    }
    const item = items[index]!;
    const ownQuestions = item.askerCounts[login] ?? 1;
    this.botQueue.enqueueTemplate({ type: 'queue-position', userLogin: login, place: index + 1, others: Math.max(0, item.count - ownQuestions) });
    return true;
  }
}
