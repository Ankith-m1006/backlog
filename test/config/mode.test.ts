import { describe, expect, it } from 'vitest';
import { getBacklogMode, requireLiveMode } from '../../src/config/mode.js';

describe('Backlog mode', () => {
  it('defaults to demo and accepts only explicit demo/live values', () => {
    expect(getBacklogMode(undefined)).toBe('demo');
    expect(getBacklogMode('live')).toBe('live');
    expect(() => getBacklogMode('preview')).toThrow('BACKLOG_MODE');
  });
  it('refuses evaluation outside live mode', () => {
    expect(() => requireLiveMode('demo')).toThrow('Demo-mode results are not evaluation data');
    expect(() => requireLiveMode('live')).not.toThrow();
  });
});
