import { cosineSimilarity, embedText } from '../classifier/embedding.js';
import type { StoredQuestion } from '../store/store.js';
import { BacklogStore, type AnswerInput, type SavedAnswer } from '../store/store.js';

export interface AnswerSuggestion extends Pick<SavedAnswer, 'id' | 'question' | 'answer'> { score: number }
interface AnswerServiceOptions {
  apiKey: string;
  threshold?: number;
  embed?: (text: string) => Promise<number[]>;
  onError?: (error: Error) => void;
}

export class SavedAnswerService {
  private readonly cache = new Map<string, { text: string; vector: number[] }>();
  private readonly threshold: number;
  private readonly embed: (text: string) => Promise<number[]>;

  constructor(private readonly store: BacklogStore, private readonly options: AnswerServiceOptions) {
    this.threshold = options.threshold ?? 0.82;
    if (this.threshold < 0 || this.threshold > 1) throw new Error('Answer match threshold must be between 0 and 1');
    this.embed = options.embed ?? ((text) => embedText(text, { apiKey: options.apiKey }));
  }

  async create(input: Omit<AnswerInput, 'embedding'>): Promise<SavedAnswer> {
    const vector = await this.tryEmbed(input.question);
    return this.store.createAnswer({ ...input, ...(vector ? { embedding: vector } : {}) });
  }

  async update(id: string, input: Omit<AnswerInput, 'embedding'>): Promise<SavedAnswer | undefined> {
    const vector = await this.tryEmbed(input.question);
    return this.store.updateAnswer(id, { ...input, ...(vector ? { embedding: vector } : {}) });
  }

  async suggest(item: StoredQuestion): Promise<AnswerSuggestion | null> {
    const candidates = this.store.listAnswers().filter((answer) => answer.embedding?.length);
    if (candidates.length === 0) return null;
    let questionVector: number[];
    try {
      const cached = this.cache.get(item.id);
      if (cached?.text === item.normalized) questionVector = cached.vector;
      else {
        questionVector = await this.embed(item.normalized || item.text);
        this.cache.set(item.id, { text: item.normalized, vector: questionVector });
      }
    } catch (cause) {
      this.options.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
      return null;
    }
    let best: { answer: SavedAnswer; score: number } | undefined;
    for (const answer of candidates) {
      const score = cosineSimilarity(questionVector, answer.embedding!);
      if (!best || score > best.score) best = { answer, score };
    }
    if (!best || best.score < this.threshold) return null;
    return { id: best.answer.id, question: best.answer.question, answer: best.answer.answer, score: best.score };
  }

  async suggestMany(items: StoredQuestion[]): Promise<Array<StoredQuestion & { suggestedAnswer: AnswerSuggestion | null }>> {
    return Promise.all(items.map(async (item) => ({ ...item, suggestedAnswer: await this.suggest(item) })));
  }

  private async tryEmbed(text: string): Promise<number[] | undefined> {
    try { return await this.embed(text); }
    catch (cause) {
      this.options.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
      return undefined;
    }
  }
}
