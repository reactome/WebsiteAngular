import { describe, expect, it } from 'vitest';
import { pageTitle } from './page-title';

// Every page was titled "Reactome": every tab, bookmark and search result read the same.
describe("a page's title", () => {
  it('names what is on show, most specific first, then the site', () => {
    expect(pageTitle('Apoptosis (R-HSA-109581)')).toBe('Apoptosis (R-HSA-109581) · Reactome');
    expect(pageTitle('TP53', 'Search')).toBe('TP53 · Search · Reactome');
  });

  it('leaves out what is missing or blank, and is the site alone with nothing', () => {
    expect(pageTitle('', 'Search')).toBe('Search · Reactome');
    expect(pageTitle(undefined, null, '  ')).toBe('Reactome');
    expect(pageTitle('  News  ')).toBe('News · Reactome');
  });
});
