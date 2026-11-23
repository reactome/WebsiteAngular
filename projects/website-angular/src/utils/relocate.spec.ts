import { describe, expect, it } from 'vitest';
import { relocate } from './rewriteContentUrls';

// Imported articles link to the old site's addresses; each is written as where
// the page is here, not as an address app.routes.ts redirects (the link check
// refuses content that leans on a redirect).
describe("an old site's address, where its page is now", () => {
  it('moves the addresses app.routes.ts redirects', () => {
    expect(relocate('userguide')).toBe('documentation/userguide');
    expect(relocate('userguide/reactome-fiviz')).toBe('documentation/userguide/reactome-fiviz');
    expect(relocate('dev')).toBe('documentation/dev');
    expect(relocate('dev/graph-database')).toBe('documentation/dev/graph-database');
    expect(relocate('what-is-reactome')).toBe('about/what-is-reactome');
    expect(relocate('beta/PathwayBrowser')).toBe('PathwayBrowser');
    expect(relocate('gsa/home')).toBe('PathwayBrowser?analysisTab=quantitative');
  });

  it('leaves alone what has not moved, and what only begins like a moved one', () => {
    expect(relocate('PathwayBrowser/#R-HSA-109581')).toBe('PathwayBrowser/#R-HSA-109581');
    expect(relocate('developers')).toBe('developers');
    expect(relocate('userguides')).toBe('userguides');
    expect(relocate('documentation/userguide')).toBe('documentation/userguide');
  });
});
