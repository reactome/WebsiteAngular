/**
 * Legacy links in the shipped content point somewhere that works.
 *
 * The news archive spells the old browser's fragments -- `#TOOL=AT` opened the
 * analysis tool, `#R-HSA-…` opened a pathway -- and `UrlStateService` translates
 * them. It can only translate the shapes it is given, and three of the
 * forty-seven analysis links were simply mistyped in the source:
 *
 *   /PathwayBrowser//PathwayBrowser/#/TOOL=AT   (the path written twice)
 *   /PathwayBrowser/#/R-HSA-TOOL=AT             (two fragments run together)
 *   /#TOOL=AT                                   (no PathwayBrowser at all)
 *
 * Each landed somewhere plausible and did nothing, which is the hard kind to
 * notice. Measured on beta 2026-09-16: the first two opened the browser with no
 * tool, the third the homepage, while the well-formed ones opened the analysis
 * form.
 *
 * Read off the files rather than the rendered site, so a mistyped link fails
 * before it ships rather than after.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CONTENT = 'projects/website-angular/content';

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return path.endsWith('.mdx') ? [path] : [];
  });
}

/** Every legacy analysis link in the content, with the file it came from. */
function analysisLinks(): { file: string; link: string }[] {
  return markdownFiles(CONTENT).flatMap((file) => {
    const body = readFileSync(file, 'utf8');
    return [...body.matchAll(/[^\s()<>]*TOOL=[A-Za-z_]+/g)].map((match) => ({
      file,
      link: match[0],
    }));
  });
}

describe('legacy analysis-tool links in the content', () => {
  it('are all written in a shape the browser can act on', () => {
    // The two the fragment reader handles: `/PathwayBrowser/#TOOL=AT` and the
    // `#/` variant, absolute or relative. Anything else reaches a page that
    // quietly does nothing.
    const usable = /^(https:\/\/reactome\.org)?\/PathwayBrowser\/#\/?TOOL=[A-Za-z_]+$/;
    const broken = analysisLinks().filter(({ link }) => !usable.test(link));
    expect(broken, 'legacy links that will not open the analysis tool').toEqual([]);
  });

  it('finds the links it is meant to be checking', () => {
    // A regex that matches nothing would make the case above pass for ever.
    expect(analysisLinks().length).toBeGreaterThan(40);
  });
});
