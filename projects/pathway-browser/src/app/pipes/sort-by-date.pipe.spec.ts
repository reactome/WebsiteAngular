import { describe, expect, it } from 'vitest';
import { SortByDatePipe } from './sort-by-date.pipe';

describe('SortByDatePipe', () => {
  it('create an instance', () => {
    const pipe = new SortByDatePipe();
    expect(pipe).toBeTruthy();
  });
});
