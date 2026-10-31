import { readFile } from 'node:fs/promises';

/** Return configured values only; empty and whitespace-only environment values behave as unset. */
export function env(name: string): string | undefined {
  const value = process.env[name];
  return value?.trim() ? value.trim() : undefined;
}

export function answerMatchThreshold(value = env('ANSWER_MATCH_THRESHOLD')): number {
  const parsed = Number(value ?? 0.82);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.82;
}

export async function loadEnvFile(path = '.env'): Promise<void> {
  const content = await readFile(path, 'utf8').catch(() => '');
  for (const rawLine of content.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/iu.exec(line);
    if (!match) continue;
    const key = match[1]!;
    if (env(key) !== undefined) continue;
    let value = match[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/u, '');
    process.env[key] = value;
  }
}
