import { describe, expect, it } from 'vitest';
import { parserFor, readDefault } from './analysis-methods.service';

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

// What the effects did before the defaults were typed: parserFor(type)(default),
// the default being the service's text, or absent (a data source's parameters).
describe('readDefault', () => {
  it('reads the text as parserFor does', () => {
    expect(readDefault('bool', 'False')).toBe(false);
    expect(readDefault('int', '7')).toBe(7);
    expect(readDefault('string', 'x')).toBe('x');
  });

  it('leaves an absent default absent, but a number read as parsing read it', () => {
    expect(readDefault('string', undefined)).toBeUndefined();
    expect(readDefault('email', undefined)).toBeUndefined();
    expect(readDefault('int', undefined)).toBeNaN();
    expect(readDefault('float', undefined)).toBeNaN();
  });

  it('reads a value already read as itself', () => {
    expect(readDefault('int', 7)).toBe(7);
    expect(readDefault('bool', true)).toBe(true);
  });
});
