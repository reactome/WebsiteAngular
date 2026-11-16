import { describe, expect, it } from 'vitest';
import { decodedToken } from './analysis.service';

// The same result's token reaches the page encoded from the service and
// decoded from an address; compared, they have to agree.
describe('decodedToken', () => {
  it('reads an encoded and a decoded token as the same', () => {
    expect(decodedToken('MjAyNjA5MjUxNDM3NThfMTM%3D')).toBe(
      decodedToken('MjAyNjA5MjUxNDM3NThfMTM=')
    );
  });

  it('reads a token without its padding as the same', () => {
    expect(decodedToken('MjAyNjA5MjUxNDM3NThfMTM')).toBe(
      decodedToken('MjAyNjA5MjUxNDM3NThfMTM%3D')
    );
  });

  it('is null for no token', () => {
    expect(decodedToken(undefined)).toBeNull();
    expect(decodedToken(null)).toBeNull();
    expect(decodedToken('')).toBeNull();
  });

  it('keeps a token that is not percent-encoded', () => {
    expect(decodedToken('abc%')).toBe('abc%');
  });
});
