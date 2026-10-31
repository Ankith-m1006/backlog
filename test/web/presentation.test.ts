import { describe, expect, it } from 'vitest';
import { asksLabel, tallyMarks } from '../../src/web/presentation.js';

describe('queue ticket presentation', () => {
  it('uses singular copy for one ask and never prefixes the count with plus', () => {
    expect(asksLabel(1)).toBe('1 ask');
    expect(asksLabel(14)).toBe('14 asks');
  });

  it('renders tally groups with a strike for each five', () => {
    expect(tallyMarks(0)).toBe('');
    expect(tallyMarks(3)).toBe('|||');
    expect(tallyMarks(5)).toBe('||||/');
    expect(tallyMarks(7)).toBe('||||/ ||');
    expect(tallyMarks(12)).toBe('||||/ ||||/ ||');
  });
});
