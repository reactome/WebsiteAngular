import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The PDF service's Dockerfile builds pdf-export from a commit, and
 * deploy/java/PINS.md says which ("The PDF service"). The two are kept by
 * hand, so they can drift: an image built from a commit nobody chose, while
 * the table still names the chosen one.
 */
const dockerfile = readFileSync(join(__dirname, 'Dockerfile'), 'utf8');
const pins = readFileSync(join(__dirname, '../java/PINS.md'), 'utf8');

describe('the PDF service pin', () => {
  const commits = [...dockerfile.matchAll(/^ARG ([A-Z0-9_]+)_COMMIT=([0-9a-f]{40})$/gm)];

  it('builds pdf-export, from one full commit, and nothing else', () => {
    expect(commits.map(([, name]) => name)).toEqual(['PDF_EXPORT']);
  });

  it("builds pdf-export at PINS.md's commit", () => {
    const row = pins.split('\n').find((line) => line.includes('`reactome/pdf-export`'));
    const pinned = row?.match(/\| `([0-9a-f]{7,40})`/)?.[1] ?? 'no PINS.md row for pdf-export';
    const built = commits[0]?.[2] ?? 'no commit in the Dockerfile';
    expect(built.startsWith(pinned), `${built} is not PINS.md's ${pinned}`).toBe(true);
  });

  it('fetches the tree at that commit, by that argument', () => {
    expect(dockerfile).toContain(
      'https://codeload.github.com/reactome/pdf-export/tar.gz/$PDF_EXPORT_COMMIT'
    );
  });
});
