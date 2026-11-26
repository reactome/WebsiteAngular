import { describe, expect, it } from 'vitest';
import truncateHtml from './truncateHtml';

describe('truncateHtml', () => {
  it('closes the HTML tags it cut through', () => {
    expect(truncateHtml('<p>one <em>two three</em> four</p>', 2)).toBe(
      '<p>one <em>two ...</em></p>'
    );
  });

  it('takes a markdown link written in angle brackets for a link, not for a tag to close', () => {
    // As the V98 announcement opens: its figure's address in angle brackets.
    const body =
      '![A figure](<https://download.reactome.org/98/ehld/R-HSA-9820460.svg>)\n\n' +
      '[A pathway](</PathwayBrowser/#9820460>) and several more words after it';
    const excerpt = truncateHtml(body, 6);
    expect(excerpt).not.toContain('</https');
    expect(excerpt.endsWith('...')).toBe(true);
  });
});
