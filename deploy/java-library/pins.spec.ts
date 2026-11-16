import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The library service's Dockerfile builds each Reactome library from a commit,
 * and deploy/java/PINS.md says which commit and why. The two are kept by hand,
 * so they can drift: an image built from a commit nobody verified, while the
 * table still names the verified one. Every commit the Dockerfile names must be
 * the table's, row for row, and named the same way in each of its stages.
 */
const dockerfile = readFileSync(join(__dirname, 'Dockerfile'), 'utf8');
const pins = readFileSync(join(__dirname, '../java/PINS.md'), 'utf8');

/** The Dockerfile's ARG <NAME>_COMMIT=<sha> lines, by name, each stage's. */
function commitArgs(text: string) {
  const found = new Map<string, Set<string>>();
  for (const [, name = '', sha = ''] of text.matchAll(/^ARG ([A-Z0-9_]+)_COMMIT=([0-9a-f]{40})$/gm))
    found.set(name, (found.get(name) ?? new Set()).add(sha));
  return found;
}

/** The PINS.md row's short commit for a repository. */
function pinnedCommit(table: string, repository: string) {
  const row = table.split('\n').find((line) => line.includes(`\`reactome/${repository}\``));
  return row?.match(/\| `([0-9a-f]{7,40})`/)?.[1];
}

const REPOSITORIES: Record<string, string> = {
  REACTOME_PARENT: 'reactome-parent',
  GRAPH_CORE: 'graph-core',
  SBML_EXPORTER: 'sbml-exporter',
  BIOPAX3_EXPORTER: 'BioPAX3Exporter',
};

describe('the library service pins', () => {
  const args = commitArgs(dockerfile);

  it('names every library it builds, and only those', () => {
    expect([...args.keys()].sort()).toEqual(Object.keys(REPOSITORIES).sort());
  });

  for (const [name, repository] of Object.entries(REPOSITORIES)) {
    it(`builds ${repository} at PINS.md's commit`, () => {
      const shas = [...(args.get(name) ?? [])];
      expect(shas).toHaveLength(1);
      const pinned = pinnedCommit(pins, repository) ?? `no PINS.md row for reactome/${repository}`;
      expect(shas[0]?.startsWith(pinned), `${shas[0]} is not PINS.md's ${pinned}`).toBe(true);
    });
  }

  it('catches a stage that names another commit', () => {
    const drifted = dockerfile.replace(
      /^(ARG GRAPH_CORE_COMMIT=)[0-9a-f]{40}$/m,
      `$1${'0'.repeat(40)}`
    );
    expect(commitArgs(drifted).get('GRAPH_CORE')?.size).toBe(2);
  });
});
