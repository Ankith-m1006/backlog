import { env } from '../config/env.js';

interface GuardOptions {
  maxCallsPerMinute?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  log?: (event: string, details: Record<string, number>) => void;
}

export class OpenAICallGuard {
  private readonly calls: number[] = [];
  private gate: Promise<void> = Promise.resolve();
  private totalTokens = 0;
  private readonly maxCalls: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly log: (event: string, details: Record<string, number>) => void;

  constructor(options: GuardOptions = {}) {
    this.maxCalls = options.maxCallsPerMinute ?? Number(env('OPENAI_MAX_CALLS_PER_MINUTE') ?? 30);
    if (!Number.isInteger(this.maxCalls) || this.maxCalls < 1) throw new Error('OPENAI_MAX_CALLS_PER_MINUTE must be a positive integer');
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.log = options.log ?? ((event, details) => console.info(`[Backlog] ${event}`, details));
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    const result = await operation();
    this.log('OpenAI call', { callsLastMinute: this.calls.length, maxCallsPerMinute: this.maxCalls, tokensTotal: this.totalTokens });
    return result;
  }

  recordTokens(tokens: number): void {
    this.totalTokens += Math.max(0, Math.floor(tokens));
    this.log('OpenAI token usage', { tokensThisResponse: Math.max(0, Math.floor(tokens)), tokensTotal: this.totalTokens, callsLastMinute: this.calls.length });
  }

  private acquire(): Promise<void> {
    const turn = this.gate.then(async () => {
      let now = this.now();
      this.prune(now);
      if (this.calls.length >= this.maxCalls) {
        const waitMs = Math.max(1, this.calls[0]! + 60_000 - now);
        await this.sleep(waitMs);
        now = this.now();
        this.prune(now);
      }
      this.calls.push(now);
    });
    this.gate = turn.catch(() => undefined);
    return turn;
  }

  private prune(now: number): void {
    while (this.calls.length > 0 && this.calls[0]! <= now - 60_000) this.calls.shift();
  }
}

let sharedGuard: OpenAICallGuard | undefined;
export function getOpenAICallGuard(): OpenAICallGuard {
  sharedGuard ??= new OpenAICallGuard();
  return sharedGuard;
}
