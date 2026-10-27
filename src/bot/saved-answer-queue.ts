import { BacklogStore } from '../store/store.js';
import type { OutgoingChatSender } from './helix.js';
import type { BotTemplate } from './messages.js';

interface QueueOptions {
  intervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  onError?: (error: Error) => void;
}

export class SavedAnswerQueue {
  private readonly jobs: Array<{ type: 'saved'; answerId: string; afterSuccess?: BotTemplate } | { type: 'template'; template: BotTemplate }> = [];
  private sending = false;
  private lastAttempt = Number.NEGATIVE_INFINITY;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly store: BacklogStore, private readonly sender: OutgoingChatSender, private readonly options: QueueOptions = {}) {
    this.intervalMs = options.intervalMs ?? 10_000;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  enqueueSavedAnswer(answerId: string, afterSuccess?: BotTemplate): boolean {
    if (!this.store.getAnswer(answerId)) return false;
    this.jobs.push({ type: 'saved', answerId, ...(afterSuccess ? { afterSuccess } : {}) });
    void this.pump();
    return true;
  }

  enqueueTemplate(template: BotTemplate): void {
    this.jobs.push({ type: 'template', template });
    void this.pump();
  }

  get pending(): number { return this.jobs.length; }

  private async pump(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.jobs.length > 0) {
        const delay = Math.max(0, this.lastAttempt + this.intervalMs - this.now());
        if (delay > 0) await this.sleep(delay);
        const job = this.jobs.shift()!;
        const savedAnswer = job.type === 'saved' ? this.store.getAnswer(job.answerId) : undefined;
        if (job.type === 'saved' && !savedAnswer) continue;
        this.lastAttempt = this.now();
        try {
          if (savedAnswer) {
            await this.sender.sendSavedAnswer(savedAnswer);
            if (job.type === 'saved' && job.afterSuccess) this.jobs.push({ type: 'template', template: job.afterSuccess });
          } else if (job.type === 'template') await this.sender.sendTemplate(job.template);
        }
        catch (cause) { this.options.onError?.(cause instanceof Error ? cause : new Error(String(cause))); }
      }
    } finally {
      this.sending = false;
      if (this.jobs.length > 0) void this.pump();
    }
  }
}
