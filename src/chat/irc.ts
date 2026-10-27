export interface IrcChatLine { user: string; text: string; sentAt: string }

export function parseIrcLine(line: string): IrcChatLine | undefined {
  if (!line.includes(' PRIVMSG ')) return undefined;
  const match = /^(?:@([^ ]+) )?:([^! ]+)!([^ ]+) PRIVMSG #[^ ]+ :(.*)$/u.exec(line);
  if (!match) return undefined;
  const text = match[4] ?? '';
  if (!text.trim() || text.startsWith('!')) return undefined;
  return { user: (match[2] ?? '').toLowerCase(), text, sentAt: new Date().toISOString() };
}

export function pseudonymize(lines: IrcChatLine[]): Array<{ offsetMs: number; user: string; text: string }> {
  const users = new Map<string, string>();
  const pseudonym = (name: string): string => {
    const key = name.toLowerCase();
    let value = users.get(key);
    if (!value) { value = `user_${users.size + 1}`; users.set(key, value); }
    return value;
  };
  const started = lines.length ? Date.parse(lines[0]!.sentAt) : 0;
  return lines.map((line) => ({
    offsetMs: Math.max(0, Date.parse(line.sentAt) - started),
    user: pseudonym(line.user),
    text: line.text.replace(/@([a-z0-9_]+)/giu, (_match, login: string) => `@${pseudonym(login)}`),
  }));
}

