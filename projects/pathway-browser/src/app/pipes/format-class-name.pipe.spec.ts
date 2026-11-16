import { describe, expect, it } from 'vitest';
import { FormatClassNamePipe } from './format-class-name.pipe';

describe('FormatClassNamePipe', () => {
  it('create an instance', () => {
    const pipe = new FormatClassNamePipe();
    expect(pipe).toBeTruthy();
  });
});
