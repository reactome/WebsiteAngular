import { describe, expect, it } from 'vitest';
import { parserFor } from './analysis-methods.service';

// A method's parameters come from the GSA service, typed by name. A type this
// form does not know -- one added since -- is read as text rather than taking
// the form down.
describe('parserFor', () => {
  it('reads each known type', () => {
    expect(parserFor('bool')('True')).toBe(true);
    expect(parserFor('float')('0.05')).toBe(0.05);
    expect(parserFor('int')('7')).toBe(7);
    expect(parserFor('string')('x')).toBe('x');
  });

  it('reads a type it does not know as text', () => {
    expect(parserFor('ratio')('1:2')).toBe('1:2');
  });
});
