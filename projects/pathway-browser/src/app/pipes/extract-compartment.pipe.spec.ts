import { describe, expect, it } from 'vitest';
import { ExtractCompartmentPipe } from './extract-compartment.pipe';

describe('ExtractCompartmentPipe', () => {
  it('create an instance', () => {
    const pipe = new ExtractCompartmentPipe();
    expect(pipe).toBeTruthy();
  });
});
