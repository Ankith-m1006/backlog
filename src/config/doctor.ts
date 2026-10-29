import { readStoredToken, type AuthRole, type StoredToken } from '../auth/tokens.js';

export type TokenHealth = 'missing' | 'expired' | 'unreadable' | 'valid' | 'invalid' | 'offline';
export interface TokenHealthOptions { tokenDir?: string; fetchImpl?: typeof fetch; now?: number; loadToken?: (role: AuthRole, tokenDir?: string) => Promise<StoredToken | undefined> }

export function nodeIsSupported(version: string): boolean {
  const major = Number(/^v?(\d+)/u.exec(version)?.[1]);
  return Number.isFinite(major) && major >= 22;
}

export async function inspectTokenHealth(role: AuthRole, options: TokenHealthOptions = {}): Promise<TokenHealth> {
  let token;
  try { token = await (options.loadToken ?? readStoredToken)(role, options.tokenDir); }
  catch { return 'unreadable'; }
  if (!token) return 'missing';
  const expiresAt = Date.parse(token.expiresAt);
  if (!Number.isFinite(expiresAt)) return 'unreadable';
  if (expiresAt <= (options.now ?? Date.now())) return 'expired';
  try {
    const response = await (options.fetchImpl ?? fetch)('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${token.accessToken}` },
      signal: AbortSignal.timeout(4000),
    });
    if (response.status === 401 || (response.status >= 400 && response.status < 500)) return 'invalid';
    if (!response.ok) return 'offline';
    const identity = await response.json() as { client_id?: string };
    return identity.client_id === token.clientId ? 'valid' : 'invalid';
  } catch { return 'offline'; }
}

export function formatDoctorReport(input: {
  nodeVersion: string;
  envFileExists: boolean;
  env: Record<string, string | undefined>;
  streamerToken: TokenHealth;
  botToken: TokenHealth;
}): { lines: string[]; ready: boolean } {
  const lines: string[] = [];
  const failures: string[] = [];
  const add = (label: string, ok: boolean, detail: string): void => {
    lines.push(`[${ok ? 'ok' : 'missing'}] ${label}: ${detail}`);
    if (!ok) failures.push(label);
  };
  add('Node.js >= 22', nodeIsSupported(input.nodeVersion), nodeIsSupported(input.nodeVersion) ? input.nodeVersion : 'install Node.js 22 or newer');
  add('.env file', input.envFileExists, input.envFileExists ? 'present' : 'copy .env.example to .env');
  for (const name of ['TWITCH_CLIENT_ID', 'CHANNEL', 'OPENAI_API_KEY']) add(name, Boolean(input.env[name]?.trim()), input.env[name]?.trim() ? 'set' : 'missing; set it in .env');
  const tokenDetail = (role: 'streamer' | 'bot', status: TokenHealth): string => {
    if (status === 'valid') return 'present, unexpired, and Twitch-validated';
    if (status === 'offline') return 'present and unexpired; Twitch validation unavailable (offline)';
    if (status === 'expired') return `expired; reauthorize with pnpm auth ${role}`;
    if (status === 'unreadable') return `unreadable; reauthorize with pnpm auth ${role}`;
    if (status === 'invalid') return `Twitch rejected it; reauthorize with pnpm auth ${role}`;
    return `missing; run pnpm auth ${role}`;
  };
  add('Streamer token', input.streamerToken === 'valid' || input.streamerToken === 'offline', tokenDetail('streamer', input.streamerToken));
  add('Bot token', input.botToken === 'valid' || input.botToken === 'offline', tokenDetail('bot', input.botToken));
  if (failures.length) {
    const actions: string[] = [];
    if (failures.includes('.env file')) actions.push('copy .env.example to .env');
    if (failures.some((failure) => ['TWITCH_CLIENT_ID', 'CHANNEL', 'OPENAI_API_KEY'].includes(failure))) actions.push('set the missing values in .env');
    if (input.streamerToken !== 'valid' && input.streamerToken !== 'offline') actions.push('pnpm auth streamer');
    if (input.botToken !== 'valid' && input.botToken !== 'offline') actions.push('pnpm auth bot');
    if (!nodeIsSupported(input.nodeVersion)) actions.push('install Node.js 22 or newer');
    lines.push(`Next: ${actions.join('; ')}; then rerun pnpm doctor.`);
  } else {
    lines.push('Next: set BACKLOG_MODE=live in .env, then run pnpm server.');
  }
  return { lines, ready: failures.length === 0 };
}
