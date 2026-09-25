import { marked } from 'marked';
import { describe, expect, it } from 'vitest';
import { applyRelease, needsRelease } from './release-placeholder';

describe('the {release} placeholder', () => {
  it('is replaced in raw HTML, as the statistics page writes it', () => {
    const html = '<iframe src="https://download.reactome.org/{release}/stats/release_stats.html">';
    expect(needsRelease(html)).toBe(true);
    expect(applyRelease(html, '97')).toContain('download.reactome.org/97/stats/');
  });

  it('is replaced in a markdown image, which marked percent-encodes', async () => {
    // The inferred-events chart is a markdown image, and marked writes its URL
    // out as %7Brelease%7D -- so the page showed a broken image for a release
    // called "{release}" until the encoded spelling was handled too.
    const html = await marked(
      '![chart](https://download.reactome.org/{release}/stats/reaction_release_stats.png)'
    );
    expect(needsRelease(html)).toBe(true);
    expect(applyRelease(html, '97')).toContain(
      'src="https://download.reactome.org/97/stats/reaction_release_stats.png"'
    );
  });

  it('brings a hardcoded bucket release forward', () => {
    expect(applyRelease('https://download.reactome.org/95/stats/x.png', '97')).toBe(
      'https://download.reactome.org/97/stats/x.png'
    );
  });

  it('leaves a page that names no release alone', () => {
    expect(needsRelease('<p>No release here.</p>')).toBe(false);
  });
});
