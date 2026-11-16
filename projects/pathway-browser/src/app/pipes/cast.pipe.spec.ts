import { describe, expect, it } from 'vitest';
import { CastPipe } from './cast.pipe';

describe('CastPipe', () => {
  it('create an instance', () => {
    const pipe = new CastPipe();
    expect(pipe).toBeTruthy();
  });
});
