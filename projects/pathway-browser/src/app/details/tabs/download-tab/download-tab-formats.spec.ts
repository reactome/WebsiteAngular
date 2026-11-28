import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DownloadFormat } from '../../../services/download.service';

/**
 * The tab's own description, shown before a pathway is open, names the formats
 * in bold. It once named BioPAX 2 and BioPAX 3 long after the tab offered one
 * BioPAX (Level 3), and never named the diagram's pictures. Every format it
 * names must be one the tab offers, and every one the tab offers must be named.
 */
describe('Download tab description', () => {
  const dir = __dirname;
  const html = readFileSync(join(dir, 'download-tab.component.html'), 'utf8');
  const ts = readFileSync(join(dir, 'download-tab.component.ts'), 'utf8');

  // Both markers found, or nothing: a missing one must not widen the slice.
  const start = html.indexOf('@if (!hasDownload())');
  const end = html.indexOf('@if (finalPathwayName())');
  const empty = start >= 0 && end > start ? html.slice(start, end) : '';
  const named = [...empty.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1].trim());

  // Only the pathway list's own names: from `pathwayItems` to the next list.
  const list = ts.slice(
    ts.indexOf('pathwayItems: PathwayItem[]'),
    ts.indexOf('analysisItems: AnaLysisItem[]')
  );
  const pathwayFormats = [...list.matchAll(/^\s*name: '([^']+)',$/gm)].map((m) => m[1]);
  const pictures = Object.values(DownloadFormat).map((f) => f.toUpperCase());
  const offered = [...pictures, ...pathwayFormats];

  it('reads the formats from both files', () => {
    expect(pathwayFormats).toEqual(['SBML', 'SBGN', 'BioPAX', 'PDF', 'Newt']);
    expect(named.length).toBeGreaterThan(3);
  });

  it('names only formats the tab offers', () => {
    const notOffered = named.filter((n) => !offered.includes(n) && n !== 'analysis report');
    expect(notOffered).toEqual([]);
  });

  it('names every format the tab offers', () => {
    expect(offered.filter((f) => !named.includes(f))).toEqual([]);
  });
});
