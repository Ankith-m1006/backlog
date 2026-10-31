export function tallyMarks(count: number): string {
  const safeCount = Math.min(10, Math.max(0, Math.floor(count)));
  return Array.from({ length: Math.floor(safeCount / 5) }, () => '||||/').join(' ') + (safeCount % 5 ? `${safeCount >= 5 ? ' ' : ''}${'|'.repeat(safeCount % 5)}` : '');
}

export function askerLine(askers: string[], limit = 4): string {
  const shown = askers.slice(0, limit).map((name) => `@${name}`).join(' · ');
  return askers.length > limit ? `${shown} +${askers.length - limit} more` : shown;
}

export function asksLabel(count: number): string {
  return `${count} ${count === 1 ? 'ask' : 'asks'}`;
}
