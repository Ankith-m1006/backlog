import type { ChatMessage } from '../chat/types.js';
import { isCandidate } from './prefilter.js';
import { classify, type Classification } from './openai.js';
import { QuestionMerger, type QueueQuestion } from './merge.js';

interface PipelineOptions {
  apiKey: string;
  model?: string;
  intervalMs?: number;
  classifyBatch?: (messages: ChatMessage[]) => Promise<Classification[]>;
  onQuestion?: (question: QueueQuestion) => void;
  onError?: (error: Error) => void;
}

export class QuestionPipeline {
  private batch: ChatMessage[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly merger = new QuestionMerger();
  private readonly classifyBatch: (messages: ChatMessage[]) => Promise<Classification[]>;
  private readonly intervalMs: number;

  constructor(private readonly options: PipelineOptions) {
    this.intervalMs = options.intervalMs ?? 2000;
    this.classifyBatch = options.classifyBatch ?? ((messages) => classify(messages, { apiKey: options.apiKey, model: options.model }));
  }

  add(message: ChatMessage): boolean {
    if (!isCandidate(message) || message.isBot) return false;
    this.batch.push(message);
    if (!this.timer) this.timer = setTimeout(() => { void this.flush().catch(() => undefined); }, this.intervalMs);
    return true;
  }

  async flush(): Promise<QueueQuestion[]> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const messages = this.batch.splice(0);
    if (messages.length === 0) return [];
    try {
      const results = await this.classifyBatch(messages);
      const questions: QueueQuestion[] = [];
      for (const [index, result] of results.entries()) {
        const question = this.merger.add(messages[index]!, result);
        if (question) { questions.push(question); this.options.onQuestion?.(question); }
      }
      return questions;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.options.onError?.(error);
      throw error;
    } finally {
      if (this.batch.length > 0 && !this.timer) this.timer = setTimeout(() => { void this.flush().catch(() => undefined); }, this.intervalMs);
    }
  }

  list(): QueueQuestion[] { return this.merger.list(); }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.batch = [];
  }
}
