import type { ChatMessage } from '../chat/types.js';
import { isCandidate } from './prefilter.js';
import { classify, type Classification } from './openai.js';
import { QuestionMerger, type QueueQuestion } from './merge.js';
import { cosineSimilarity, embedText } from './embedding.js';
import type { OpenQuestionContext } from './openai.js';

interface PipelineOptions {
  apiKey: string;
  model?: string;
  intervalMs?: number;
  classifyBatch?: (messages: ChatMessage[], openItems: OpenQuestionContext[]) => Promise<Classification[]>;
  embedNormalized?: (text: string) => Promise<number[]>;
  onSemanticMerge?: (score: number, fromId: string, intoId: string) => void;
  onQuestion?: (question: QueueQuestion, message: ChatMessage) => void;
  onStats?: (stats: ChatStats) => void;
  onError?: (error: Error) => void;
}

/** Live filter totals since start: every chat message seen, kept as a question, or ignored. */
export interface ChatStats { chat: number; questions: number; ignored: number }

export class QuestionPipeline {
  private readonly counts: ChatStats = { chat: 0, questions: 0, ignored: 0 };
  private batch: ChatMessage[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly merger = new QuestionMerger();
  private readonly batchClassifier: (messages: ChatMessage[], openItems: OpenQuestionContext[]) => Promise<Classification[]>;
  private readonly embedNormalized: (text: string) => Promise<number[]>;
  private readonly embeddings = new Map<string, number[]>();
  private readonly intervalMs: number;

  constructor(private readonly options: PipelineOptions) {
    this.intervalMs = options.intervalMs ?? 2000;
    this.batchClassifier = options.classifyBatch ?? ((messages, openItems) => classify(messages, { apiKey: options.apiKey, model: options.model }, openItems));
    this.embedNormalized = options.embedNormalized ?? ((text) => embedText(text, { apiKey: options.apiKey }));
  }

  stats(): ChatStats { return { ...this.counts }; }

  private count(key: keyof ChatStats): void {
    this.counts[key] += 1;
    this.options.onStats?.(this.stats());
  }

  add(message: ChatMessage): boolean {
    if (message.isBot) return false;
    this.counts.chat += 1;
    if (!isCandidate(message)) { this.count('ignored'); return false; }
    this.options.onStats?.(this.stats());
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
      const openItems = this.merger.recent(30);
      const results = await this.batchClassifier(messages, openItems.map(({ topicKey, normalized }) => ({ topicKey, normalized })));
      const questions: QueueQuestion[] = [];
      for (const [index, result] of results.entries()) {
        const message = messages[index]!;
        let question: QueueQuestion | undefined;
        if (result.isQuestion && result.topicKey) {
          const keyedMatch = openItems.find((item) => item.channel.toLowerCase() === message.channel.toLowerCase() && item.topicKey === result.topicKey);
          if (keyedMatch) {
            question = this.merger.add(message, result);
          } else {
            const normalized = result.normalized.trim() || message.text.trim();
            const newEmbedding = await this.embedNormalized(normalized);
            let best: { item: QueueQuestion; score: number } | undefined;
            for (const item of this.merger.recent(30).filter((candidate) => candidate.channel.toLowerCase() === message.channel.toLowerCase())) {
              const existingEmbedding = this.embeddings.get(item.id) ?? await this.embedNormalized(item.normalized || item.text);
              this.embeddings.set(item.id, existingEmbedding);
              const score = cosineSimilarity(newEmbedding, existingEmbedding);
              if (!best || score > best.score) best = { item, score };
            }
            if (best && best.score >= 0.88) {
              question = this.merger.mergeInto(best.item.id, message);
              if (question) {
                this.options.onSemanticMerge?.(best.score, message.id, question.id);
                console.info('[Backlog] semantic merge', { score: best.score, fromId: message.id, intoId: question.id });
              }
            } else {
              question = this.merger.add(message, result);
              if (question) this.embeddings.set(question.id, newEmbedding);
            }
          }
        }
        if (question) { questions.push(question); this.options.onQuestion?.(question, message); }
        this.count(question ? 'questions' : 'ignored');
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
