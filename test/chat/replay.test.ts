import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReplayChatSource } from '../../src/chat/replay.js';

let directory = '';
afterEach(async () => { vi.useRealTimers(); if (directory) await rm(directory, { recursive: true, force: true }); });
describe('ReplayChatSource', () => {
  it('emits JSONL rows in order at the offset divided by speed', async () => {
    directory = await mkdtemp(join(tmpdir(), 'backlog-replay-')); const path = join(directory, 'chat.jsonl');
    await writeFile(path, '{"offsetMs":0,"user":"First","text":"hello"}\n{"offsetMs":200,"user":"Mod","text":"welcome","badges":["moderator"]}\n{"offsetMs":500,"user":"Last","text":"gg"}\n');
    vi.useFakeTimers(); const received: string[] = []; const source = new ReplayChatSource(path, 'streamer', 2);
    const running = source.start((message) => received.push(message.displayName));
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    await vi.advanceTimersByTimeAsync(1); expect(received).toEqual(['First']);
    await vi.advanceTimersByTimeAsync(100); expect(received).toEqual(['First', 'Mod']);
    await vi.advanceTimersByTimeAsync(150); await running;
    expect(received).toEqual(['First', 'Mod', 'Last']);
  });
});
