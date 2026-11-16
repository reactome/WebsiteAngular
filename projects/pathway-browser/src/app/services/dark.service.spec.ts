import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { DarkService } from './dark.service';

// The theme is kept in local storage as JSON; it is read back as a boolean,
// and only `true` turns dark mode on.
describe('DarkService', () => {
  afterEach(() => {
    localStorage.removeItem('is-dark');
    TestBed.resetTestingModule();
  });

  const startWith = (stored: string): boolean => {
    localStorage.setItem('is-dark', stored);
    return TestBed.inject(DarkService).isDark();
  };

  it('reads a stored true as dark', () => {
    expect(startWith('true')).toBe(true);
  });

  it('reads a stored false as light', () => {
    expect(startWith('false')).toBe(false);
  });

  it('reads anything else stored as light', () => {
    expect(startWith('1')).toBe(false);
  });
});
