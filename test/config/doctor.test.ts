import { describe, expect, it, vi } from 'vitest';
import type { StoredToken } from '../../src/auth/tokens.js';
import { formatDoctorReport, inspectTokenHealth, nodeIsSupported } from '../../src/config/doctor.js';

describe('pnpm doctor checks', () => {
  it('accepts Node 22+ only', () => {
    expect(nodeIsSupported('v22.0.0')).toBe(true);
    expect(nodeIsSupported('v24.13.0')).toBe(true);
    expect(nodeIsSupported('v20.19.0')).toBe(false);
  });

  it('checks token expiry locally and validates with Twitch when reachable', async () => {
    const now = Date.now();
    const common = { accessToken: 'secret-access', refreshToken: 'secret-refresh', clientId: 'client-id', login: 'private-login', userId: 'user-id', scopes: ['user:read:chat'] };
    const stored: Record<string, StoredToken> = {
      streamer: { ...common, expiresAt: new Date(now + 3_600_000).toISOString() },
      bot: { ...common, expiresAt: new Date(now - 1000).toISOString() },
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ client_id: 'client-id' }), { status: 200 }));
    const loadToken = async (role: 'streamer' | 'bot'): Promise<StoredToken | undefined> => stored[role];
    await expect(inspectTokenHealth('streamer', { now, fetchImpl, loadToken })).resolves.toBe('valid');
    await expect(inspectTokenHealth('bot', { now, fetchImpl, loadToken })).resolves.toBe('expired');
    expect(fetchImpl).toHaveBeenCalledOnce();
    await expect(inspectTokenHealth('streamer', { now, loadToken, fetchImpl: async () => { throw new Error('offline'); } })).resolves.toBe('offline');
  });

  it('reports only set/missing for secrets and gives next steps', () => {
    const report = formatDoctorReport({
      nodeVersion: 'v24.0.0', envFileExists: true,
      env: { TWITCH_CLIENT_ID: 'do-not-print-client', CHANNEL: '', OPENAI_API_KEY: 'do-not-print-openai' },
      streamerToken: 'missing', botToken: 'offline',
    });
    const output = report.lines.join('\n');
    expect(report.ready).toBe(false);
    expect(output).toContain('TWITCH_CLIENT_ID: set');
    expect(output).toContain('CHANNEL: missing');
    expect(output).toContain('Streamer token: missing');
    expect(output).toContain('Bot token: present and unexpired; Twitch validation unavailable (offline)');
    expect(output).toContain('pnpm auth');
    expect(output).not.toContain('do-not-print');
  });
});
