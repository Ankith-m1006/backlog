import { readFile } from 'node:fs/promises';
import type { ChatMessage, ChatSource } from './types.js';

export interface ReplayLine { offsetMs: number; user: string; text: string; badges?: string[] }

export class ReplayChatSource implements ChatSource {
  private stopped = true;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly filePath: string, private readonly channel: string, private readonly speed = 1) {
    if (speed <= 0) throw new Error('Replay speed must be greater than zero');
  }

  async start(onMessage: (message: ChatMessage) => void): Promise<void> {
    this.stopped = false;
    const replayStartedAt = Date.now();
    const content = await readFile(this.filePath, 'utf8');
    const lines = content.split(/\r?\n/u).filter((line) => line.trim()).map((line) => JSON.parse(line) as ReplayLine);
    let previousOffset = 0;
    for (const [index, line] of lines.entries()) {
      if (this.stopped) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          if (!this.stopped) onMessage(this.toMessage(line, index, replayStartedAt));
          resolve();
        }, Math.max(0, line.offsetMs - previousOffset) / this.speed);
        this.timers.add(timer);
      });
      previousOffset = line.offsetMs;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private toMessage(line: ReplayLine, index: number, replayStartedAt: number): ChatMessage {
    const login = line.user.toLowerCase().replace(/[^a-z0-9_]/gu, '_');
    const badges = line.badges ?? [];
    return {
      id: `replay-${index + 1}`, channel: this.channel, userId: `replay-user-${login}`,
      userLogin: login, displayName: line.user, text: line.text,
      isMod: badges.includes('moderator'), isBroadcaster: badges.includes('broadcaster'), isBot: false,
      sentAt: new Date(replayStartedAt + line.offsetMs).toISOString(),
    };
  }
}
