import { describe, expect, it } from 'vitest';
import { forTests } from './import-news';

const { toMarkdown, sameWords, decodeCloudflareEmail, resolveCloudflareLinks, resolveJoomlaCloak } =
  forTests;

// The importer's job is to change the markup and nothing else, so these are the
// cases where "nothing else" nearly failed. Every one of them was a real defect
// while importing V96 and V97, and each would have put words on the site that
// nobody wrote.
describe('importing an announcement', () => {
  it('keeps a link target that looks like an HTML tag', () => {
    // `</images/x.png>` is indistinguishable from a closing tag, and the step
    // that strips leftover markup ate every link and image on the page.
    const markdown = toMarkdown(
      '<p><img src="/images/x.png" alt="" /> <a href="/a/b">Label</a></p>'
    );
    expect(markdown).toContain('![](</images/x.png>)');
    expect(markdown).toContain('[Label](</a/b>)');
  });

  it('keeps whitespace that sat inside a link', () => {
    // One announcement links "BlueSky@reactome.org " with the space inside the
    // anchor; trimming the label without putting it back joined the link to the
    // following word.
    const markdown = toMarkdown('<p>on <a href="https://bsky.app/x">BlueSky </a>get updates</p>');
    expect(markdown).toBe('on [BlueSky](<https://bsky.app/x>) get updates');
  });

  it('leaves someone else’s links absolute and makes ours relative', () => {
    const markdown = toMarkdown(
      '<p><a href="https://reactome.org/download-data">ours</a> ' +
        '<a href="https://orcid.org/0000">theirs</a></p>'
    );
    expect(markdown).toContain('[ours](</download-data>)');
    expect(markdown).toContain('[theirs](<https://orcid.org/0000>)');
  });

  it('decodes an address hidden behind a Cloudflare protection link', () => {
    // The address is the fragment; the visible text is a warning sentence that
    // reads as prose if it survives.
    const hidden = decodeCloudflareEmail('650d0009152517000406110a08004b0a17024b');
    const resolved = resolveCloudflareLinks(
      `<p>at <a href="/cdn-cgi/l/email-protection#650d0009152517000406110a08004b0a17024b">` +
        `<span>This email address is being protected from spambots.</span></a>.</p>`
    );
    expect(hidden).toContain('@');
    expect(toMarkdown(resolved)).toBe(`at [${hidden}](<mailto:${hidden}>).`);
  });

  it('decodes an address Joomla rebuilds in script', () => {
    // The fragments are entity-encoded, so they contain semicolons: reading the
    // assignment up to the first one produced a single letter of the address.
    const cloak =
      `<span id="cloakabc123">This email address is being protected from spambots.</span>` +
      `<script type='text/javascript'>` +
      `document.getElementById('cloakabc123').innerHTML = '';` +
      `var addyabc123 = 'h&#101;lp' + '&#64;';` +
      `addyabc123 = addyabc123 + 'r&#101;actom&#101;' + '&#46;' + '&#111;rg';` +
      `var addy_textabc123 = 'h&#101;lp' + '&#64;' + 'r&#101;actom&#101;' + '&#46;' + '&#111;rg';` +
      `</script>`;
    expect(toMarkdown(resolveJoomlaCloak(cloak))).toBe(
      '[help@reactome.org](<mailto:help@reactome.org>)'
    );
  });

  it('reports a difference rather than writing reworded prose', () => {
    const body = '<p>One <a href="/x">two</a> three</p>';
    expect(sameWords(toMarkdown(body), body).equal).toBe(true);
    // A single word out of place is a different announcement.
    expect(sameWords('One two four', body).equal).toBe(false);
  });
});
