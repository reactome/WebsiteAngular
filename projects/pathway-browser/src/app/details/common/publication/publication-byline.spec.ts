import { authorNameEntries, composeAuthorByline } from './publication-byline';

describe('authorNameEntries', () => {
  it('lists the entries the curation graph sends', () => {
    expect(authorNameEntries(['Kerr, JF', 'Wyllie, AH', 'Currie, AR'])).toEqual([
      'Kerr, JF',
      'Wyllie, AH',
      'Currie, AR',
    ]);
  });

  it('wraps a single pre-composed string', () => {
    expect(authorNameEntries('Kerr, JF, Wyllie, AH')).toEqual(['Kerr, JF, Wyllie, AH']);
  });

  it('is empty when the attribute is absent, as it is on the public content service', () => {
    expect(authorNameEntries(undefined)).toEqual([]);
  });

  it('drops blank entries', () => {
    expect(authorNameEntries(['', '  ', 'Kerr, JF'])).toEqual(['Kerr, JF']);
    expect(authorNameEntries('   ')).toEqual([]);
  });
});

describe('composeAuthorByline', () => {
  it('composes one byline from the per-author array the curation graph returns', () => {
    // Regression: authorName arrives as string[] here, and calling .trim() on it threw a
    // TypeError that blanked out every reference in the details panel.
    expect(composeAuthorByline(['Kerr, JF', 'Wyllie, AH', 'Currie, AR'])).toBe(
      'Kerr JF, Wyllie AH, Currie AR'
    );
  });

  it('handles a single-author array', () => {
    expect(composeAuthorByline(['Ashkenazi, A'])).toBe('Ashkenazi A');
  });

  it('leaves a name with no comma alone', () => {
    expect(composeAuthorByline(['World Health Organization'])).toBe('World Health Organization');
  });

  it('passes a pre-composed string through untouched, commas and all', () => {
    // Splitting this one on commas would run the names together as "Kerr JF Wyllie AH".
    expect(composeAuthorByline('Kerr, JF, Wyllie, AH')).toBe('Kerr, JF, Wyllie, AH');
  });

  it('trims a pre-composed string', () => {
    expect(composeAuthorByline('  Kerr, JF  ')).toBe('Kerr, JF');
  });

  it('is empty when the attribute is absent or blank', () => {
    expect(composeAuthorByline(undefined)).toBe('');
    expect(composeAuthorByline([])).toBe('');
    expect(composeAuthorByline(['', ' '])).toBe('');
  });
});
