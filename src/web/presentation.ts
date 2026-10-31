export function tallyMarks(count: number): string {
  const safeCount = Math.max(0, Math.floor(count));
  return Array.from({ length: Math.floor(safeCount / 5) }, () => '||||/').join(' ') + (safeCount % 5 ? `${safeCount >= 5 ? ' ' : ''}${'|'.repeat(safeCount % 5)}` : '');
}

export function asksLabel(count: number): string {
  return `${count} ${count === 1 ? 'ask' : 'asks'}`;
}
