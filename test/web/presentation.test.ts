import { describe, expect, it } from 'vitest';
import { askerLine, asksLabel, tallyMarks } from '../../src/web/presentation.js';

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
    expect(tallyMarks(9)).toBe('||||/ ||||');
  });

  it('caps tally marks at two groups so large counts stay short', () => {
    expect(tallyMarks(10)).toBe('||||/ ||||/');
    expect(tallyMarks(52)).toBe('||||/ ||||/');
  });

  it('shows at most four askers, then a count of the rest', () => {
    expect(askerLine(['a', 'b'])).toBe('@a · @b');
    expect(askerLine(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('@a · @b · @c · @d +2 more');
  });
});
