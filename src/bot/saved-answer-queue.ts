import { BacklogStore } from '../store/store.js';
import type { SavedAnswerSender } from './helix.js';

interface QueueOptions {
  intervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  onError?: (error: Error) => void;
}

export class SavedAnswerQueue {
  private readonly answerIds: string[] = [];
  private sending = false;
  private lastAttempt = Number.NEGATIVE_INFINITY;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly store: BacklogStore, private readonly sender: SavedAnswerSender, private readonly options: QueueOptions = {}) {
    this.intervalMs = options.intervalMs ?? 10_000;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  enqueueSavedAnswer(answerId: string): boolean {
    if (!this.store.getAnswer(answerId)) return false;
    this.answerIds.push(answerId);
    void this.pump();
    return true;
  }

  get pending(): number { return this.answerIds.length; }

  private async pump(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.answerIds.length > 0) {
        const delay = Math.max(0, this.lastAttempt + this.intervalMs - this.now());
        if (delay > 0) await this.sleep(delay);
        const answerId = this.answerIds.shift()!;
        const savedAnswer = this.store.getAnswer(answerId);
        if (!savedAnswer) continue;
        this.lastAttempt = this.now();
        try { await this.sender.send(savedAnswer); }
        catch (cause) { this.options.onError?.(cause instanceof Error ? cause : new Error(String(cause))); }
      }
    } finally {
      this.sending = false;
      if (this.answerIds.length > 0) void this.pump();
    }
  }
}
