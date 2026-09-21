/**
 * Every tools page is reachable from the header.
 *
 * There are two independent lists of the same thing: the cards on
 * `content/tools/index.mdx`, which is the page, and `tools.dropdown-links` in
 * nav-options.json, which is the header menu. Nothing connected them, so adding
 * a page and a card left it absent from the header — which is exactly how the
 * MCP page shipped: documented, linked from the tools page, and invisible to
 * anybody navigating from the top of the site.
 *
 * Asserting the relationship rather than either list, so a page added to one
 * and not the other fails here instead of being noticed by a reader who went
 * looking for it and concluded it did not exist.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import navOptions from './nav-options.json';

const CONTENT_DIR = 'projects/website-angular/content/tools';

/** The slugs with a page of their own, which is every .mdx but the index. */
function toolPages(): string[] {
  return readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith('.mdx') && f !== 'index.mdx')
    .map((f) => f.replace(/\.mdx$/, ''));
}

describe('the tools section', () => {
  it('has a page for every slug it advertises, and vice versa', () => {
    const dropdown = (
      navOptions as Record<string, { 'dropdown-links': Record<string, { link: string }> }>
    ).tools['dropdown-links'];
    const linked = Object.values(dropdown)
      .map((entry) => entry.link)
      .filter((link) => link.startsWith('/tools/'))
      .map((link) => link.replace('/tools/', ''));

    for (const slug of toolPages()) {
      expect(linked, `content/tools/${slug}.mdx has no entry in the header's Tools menu`).toContain(
        slug
      );
    }
  });

  it('links nothing in the header that has no page behind it', () => {
    const dropdown = (
      navOptions as Record<string, { 'dropdown-links': Record<string, { link: string }> }>
    ).tools['dropdown-links'];
    const pages = toolPages();
    for (const entry of Object.values(dropdown)) {
      if (!entry.link.startsWith('/tools/')) continue;
      const slug = entry.link.replace('/tools/', '');
      expect(pages, `the header links /tools/${slug}, which has no .mdx`).toContain(slug);
    }
  });

  it('shows every tools page as a card on the tools page itself', () => {
    // The third list. A page reachable from the header but missing from the
    // index reads as an oversight to anyone who lands on /tools first.
    const index = readFileSync(`${CONTENT_DIR}/index.mdx`, 'utf8');
    for (const slug of toolPages()) {
      expect(index, `content/tools/index.mdx has no card for ${slug}`).toContain(`/tools/${slug}`);
    }
  });
});
