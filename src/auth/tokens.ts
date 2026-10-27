import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';

export type AuthRole = 'streamer' | 'bot';
export const AUTH_SCOPES: Record<AuthRole, string[]> = {
  streamer: ['user:read:chat'],
  bot: ['user:read:chat', 'user:write:chat'],
};
const DEVICE_ENDPOINT = 'https://id.twitch.tv/oauth2/device';
const TOKEN_ENDPOINT = 'https://id.twitch.tv/oauth2/token';
const VALIDATE_ENDPOINT = 'https://id.twitch.tv/oauth2/validate';

export interface StoredToken {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  login: string;
  userId: string;
  scopes: string[];
  expiresAt: string;
}
interface DeviceResponse { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }
interface TokenResponse { access_token: string; refresh_token?: string; expires_in: number; scope?: string[]; message?: string; error?: string }
interface ValidationResponse { client_id: string; login: string; user_id: string; scopes: string[]; expires_in: number }
export interface AuthOptions {
  clientId: string;
  clientSecret?: string;
  tokenDir?: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  onDeviceCode?: (details: { userCode: string; verificationUri: string }) => void;
}

function tokenPath(role: AuthRole, tokenDir = '.tokens'): string { return join(tokenDir, `${role}.json`); }
async function responseJson<T>(response: Response): Promise<T> { return await response.json() as T; }

export async function saveStoredToken(role: AuthRole, token: StoredToken, tokenDir = '.tokens'): Promise<void> {
  await mkdir(tokenDir, { recursive: true });
  const file = tokenPath(role, tokenDir);
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(token, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, file);
  await chmod(file, 0o600).catch(() => undefined);
}

export async function readStoredToken(role: AuthRole, tokenDir = '.tokens'): Promise<StoredToken | undefined> {
  try {
    const parsed = JSON.parse(await readFile(tokenPath(role, tokenDir), 'utf8')) as Partial<StoredToken>;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.clientId || !parsed.login || !parsed.userId || !Array.isArray(parsed.scopes) || !parsed.expiresAt) throw new Error(`Stored ${role} token file is incomplete`);
    return parsed as StoredToken;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function validateToken(accessToken: string, expectedClientId: string, fetchImpl: typeof fetch): Promise<ValidationResponse> {
  const response = await fetchImpl(VALIDATE_ENDPOINT, { headers: { Authorization: `OAuth ${accessToken}` } });
  if (!response.ok) throw new Error(`Twitch token validation failed (${response.status})`);
  const identity = await responseJson<ValidationResponse>(response);
  if (identity.client_id !== expectedClientId || !identity.login || !identity.user_id) throw new Error('Twitch returned an unexpected token identity');
  return identity;
}

export async function authorizeDevice(role: AuthRole, options: AuthOptions): Promise<StoredToken> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  const scopes = AUTH_SCOPES[role];
  const deviceResponse = await fetchImpl(DEVICE_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: options.clientId, scopes: scopes.join(' ') }),
  });
  if (!deviceResponse.ok) throw new Error(`Twitch device authorization failed (${deviceResponse.status})`);
  const device = await responseJson<DeviceResponse>(deviceResponse);
  options.onDeviceCode?.({ userCode: device.user_code, verificationUri: device.verification_uri });
  const expiresAt = now() + device.expires_in * 1000;
  let interval = Math.max(1, device.interval) * 1000;
  let token: TokenResponse | undefined;
  while (now() < expiresAt) {
    await sleep(interval);
    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: options.clientId, scopes: scopes.join(' '), device_code: device.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    const body = await responseJson<TokenResponse>(response);
    if (response.ok) { token = body; break; }
    const error = body.message ?? body.error;
    if (error === 'authorization_pending') continue;
    if (error === 'slow_down') { interval += 5000; continue; }
    if (error === 'access_denied') throw new Error('Twitch authorization was denied');
    if (error === 'expired_token' || error === 'invalid device code') throw new Error('Twitch device code expired; start `pnpm auth` again');
    throw new Error(`Twitch device token request failed: ${error ?? response.status}`);
  }
  if (!token?.access_token || !token.refresh_token) throw new Error('Twitch device code expired before authorization completed');
  const identity = await validateToken(token.access_token, options.clientId, fetchImpl);
  const missing = scopes.filter((scope) => !identity.scopes.includes(scope));
  if (missing.length) throw new Error(`Twitch account ${identity.login} did not grant required scopes: ${missing.join(', ')}`);
  const stored: StoredToken = {
    accessToken: token.access_token, refreshToken: token.refresh_token, clientId: options.clientId,
    login: identity.login, userId: identity.user_id, scopes: identity.scopes,
    expiresAt: new Date(now() + token.expires_in * 1000).toISOString(),
  };
  await saveStoredToken(role, stored, options.tokenDir);
  return stored;
}

async function refreshToken(role: AuthRole, stored: StoredToken, options: AuthOptions): Promise<StoredToken> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const fields: Record<string, string> = { client_id: stored.clientId, grant_type: 'refresh_token', refresh_token: stored.refreshToken };
  if (options.clientSecret) fields.client_secret = options.clientSecret;
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields),
  });
  const body = await responseJson<TokenResponse>(response);
  if (!response.ok || !body.access_token) throw new Error(`Could not refresh the ${role} Twitch token; run \`pnpm auth ${role}\` again`);
  const updated: StoredToken = {
    ...stored, accessToken: body.access_token, refreshToken: body.refresh_token ?? stored.refreshToken,
    scopes: body.scope ?? stored.scopes, expiresAt: new Date((options.now ?? Date.now)() + body.expires_in * 1000).toISOString(),
  };
  await saveStoredToken(role, updated, options.tokenDir);
  return updated;
}

export async function getStoredAccessToken(role: AuthRole, options: AuthOptions): Promise<string | undefined> {
  const stored = await readStoredToken(role, options.tokenDir);
  if (!stored) return undefined;
  if (Date.parse(stored.expiresAt) > (options.now ?? Date.now)() + 5 * 60_000) return stored.accessToken;
  return (await refreshToken(role, stored, options)).accessToken;
}

export function startTokenRefresh(role: AuthRole, options: AuthOptions, onError: (error: Error) => void = console.error): () => void {
  let refreshing = false;
  const timer = setInterval(() => {
    if (refreshing) return;
    refreshing = true;
    void getStoredAccessToken(role, options).catch((cause: unknown) => onError(cause instanceof Error ? cause : new Error(String(cause)))).finally(() => { refreshing = false; });
  }, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
