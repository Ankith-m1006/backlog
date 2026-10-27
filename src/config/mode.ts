export type BacklogMode = 'demo' | 'live';

export function getBacklogMode(value = process.env.BACKLOG_MODE): BacklogMode {
  const mode = value ?? 'demo';
  if (mode === 'demo' || mode === 'live') return mode;
  throw new Error('BACKLOG_MODE must be either demo or live');
}

export function requireLiveMode(value = process.env.BACKLOG_MODE): void {
  if (getBacklogMode(value) !== 'live') throw new Error('This command requires BACKLOG_MODE=live. Demo-mode results are not evaluation data.');
}
