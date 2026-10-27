import { describe, expect, it } from 'vitest';
import { parseIrcLine, pseudonymize } from '../../src/chat/irc.js';

describe('anonymous IRC recording helpers', () => {
  it('parses public chat and ignores commands/non-chat', () => {
    const parsed = parseIrcLine('@badge-info=;badges= :somebody!somebody@somebody.tmi.twitch.tv PRIVMSG #channel :How do I join?');
    expect(parsed?.user).toBe('somebody');
    expect(parsed?.text).toBe('How do I join?');
    expect(parseIrcLine(':somebody!x PRIVMSG #channel :!q')).toBeUndefined();
    expect(parseIrcLine('PING :tmi.twitch.tv')).toBeUndefined();
  });

  it('replaces every sender and explicit mention before serialization', () => {
    const lines = pseudonymize([
      { user: 'Alice', text: 'hey @BOB what loadout?', sentAt: '2026-10-27T00:00:00Z' },
      { user: 'Bob', text: 'nice', sentAt: '2026-10-27T00:00:02Z' },
    ]);
    expect(lines).toEqual([
      { offsetMs: 0, user: 'user_1', text: 'hey @user_2 what loadout?' },
      { offsetMs: 2000, user: 'user_2', text: 'nice' },
    ]);
    expect(JSON.stringify(lines)).not.toContain('Alice');
    expect(JSON.stringify(lines)).not.toContain('Bob');
  });
});
