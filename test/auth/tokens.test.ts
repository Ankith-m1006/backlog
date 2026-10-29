import { describe, expect, it, vi } from 'vitest';
import { authorizeDevice, getStoredAccessToken, type StoredToken } from '../../src/auth/tokens.js';
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status });

describe('Twitch Device Code authentication', () => {
  it('requests bot scopes, polls pending approval, validates identity, and stores the token pair', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let stored: StoredToken | undefined;
    let clock = 1_800_000_000_000;
    let pollCount = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/device')) return json({ device_code: 'device-secret', user_code: 'ABCD-1234', verification_uri: 'https://www.twitch.tv/activate', expires_in: 300, interval: 5 });
      if (url.endsWith('/token')) {
        pollCount += 1;
        if (pollCount === 1) return json({ message: 'authorization_pending' }, 400);
        return json({ access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 14_400 });
      }
      return json({ client_id: 'client', login: 'chatbot', user_id: 'bot-42', scopes: ['user:read:chat', 'user:write:chat'], expires_in: 14_400 });
    };
    const onDeviceCode = vi.fn();
    const token = await authorizeDevice('bot', {
      clientId: 'client', fetchImpl,
      sleep: async (milliseconds) => { clock += milliseconds; }, now: () => clock, onDeviceCode,
      saveToken: async (_role, token) => { stored = token; },
    });
    expect(onDeviceCode).toHaveBeenCalledWith({ userCode: 'ABCD-1234', verificationUri: 'https://www.twitch.tv/activate' });
    expect(token.login).toBe('chatbot');
    expect(token.userId).toBe('bot-42');
    expect(token.scopes).toEqual(['user:read:chat', 'user:write:chat']);
    expect(pollCount).toBe(2);
    const deviceForm = calls[0]!.init?.body as URLSearchParams;
    expect(deviceForm.get('scopes')).toBe('user:read:chat user:write:chat');
    expect(stored?.refreshToken).toBe('refresh-secret');
    expect(stored?.login).toBe('chatbot');
  });

  it('refreshes expiring tokens and persists the rotated refresh token', async () => {
    const old: StoredToken = {
      accessToken: 'old-access', refreshToken: 'old-refresh/+==', clientId: 'client', login: 'streamer', userId: 'streamer-1',
      scopes: ['user:read:chat'], expiresAt: new Date(1_800_000_000_000).toISOString(),
    };
    let requestBody: URLSearchParams | undefined;
    let stored = old;
    const accessToken = await getStoredAccessToken('streamer', {
      clientId: 'client', clientSecret: 'client-secret', now: () => 1_800_000_000_000,
      loadToken: async () => stored,
      saveToken: async (_role, token) => { stored = token; },
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe('https://id.twitch.tv/oauth2/token');
        requestBody = init?.body as URLSearchParams;
        return json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 14_400, scope: ['user:read:chat'] });
      },
    });
    expect(accessToken).toBe('new-access');
    expect(requestBody?.get('grant_type')).toBe('refresh_token');
    expect(requestBody?.get('refresh_token')).toBe('old-refresh/+==');
    expect(requestBody?.get('client_secret')).toBe('client-secret');
    expect(stored.refreshToken).toBe('new-refresh');
  });
});
