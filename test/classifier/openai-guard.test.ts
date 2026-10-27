import { describe, expect, it, vi } from 'vitest';
import { OpenAICallGuard } from '../../src/classifier/openai-guard.js';

describe('OpenAICallGuard', () => {
  it('waits for the sliding one-minute window and logs cumulative token usage', async () => {
    let now = 0;
    const sleep = vi.fn(async (milliseconds: number) => { now += milliseconds; });
    const log = vi.fn();
    const guard = new OpenAICallGuard({ maxCallsPerMinute: 1, now: () => now, sleep, log });
    await guard.run(async () => 'first');
    await guard.run(async () => 'second');
    guard.recordTokens(17);
    expect(sleep).toHaveBeenCalledWith(60_000);
    expect(log).toHaveBeenCalledWith('OpenAI token usage', expect.objectContaining({ tokensTotal: 17, tokensThisResponse: 17 }));
  });
});
