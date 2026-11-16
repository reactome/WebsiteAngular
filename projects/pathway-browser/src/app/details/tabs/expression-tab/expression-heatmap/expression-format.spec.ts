import { describe, expect, it } from 'vitest';
import { formatTpm } from './expression-format';

describe('formatTpm', () => {
  it('reads values that round to 10 as whole numbers, not "1"', () => {
    expect(formatTpm(9.96)).toBe('10');
    expect(formatTpm(9.95)).toBe('10');
  });

  it('keeps two figures below, trimming only zeros after a point', () => {
    expect(formatTpm(9.94)).toBe('9.9');
    expect(formatTpm(2)).toBe('2');
    expect(formatTpm(0.3)).toBe('0.3');
    expect(formatTpm(0.0004)).toBe('0.0004');
    expect(formatTpm(0)).toBe('0');
  });

  it('groups thousands', () => {
    expect(formatTpm(5184)).toBe('5,184');
  });
});
