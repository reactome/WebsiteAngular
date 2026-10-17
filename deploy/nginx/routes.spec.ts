import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every route to the content service takes a trailing slash.
 *
 * Spring matches `/x/` wherever it matches `/x`, on every ContentService
 * endpoint, and clients rely on it: the Pathway Browser asks for
 * `/search/fireworks/`. While Java serves whatever nginx does not route to
 * node, a slashed URL that misses node's route still gets an answer -- Java's.
 * Once Java is switched off it would get none, so each node location is
 * written to take the slash now: a regex ending `/?$`, an exact location with
 * its slashed twin.
 */
const conf = readFileSync(join(__dirname, 'common/routes-core.conf'), 'utf8');

const nodeLocations = [...conf.matchAll(/^location\s+(=|~)\s+(\S+)\s*\{([^}]*)\}/gm)]
  .filter((m) => m[3].includes('content-node-proxy.conf'))
  .map((m) => ({ kind: m[1], path: m[2] }));

describe('content-node routes', () => {
  it('are found', () => {
    expect(nodeLocations.length).toBeGreaterThan(30);
  });

  const exact = new Set(nodeLocations.filter((l) => l.kind === '=').map((l) => l.path));
  for (const { kind, path } of nodeLocations) {
    if (kind === '~')
      it(`${path} takes a trailing slash`, () => {
        expect(path.endsWith('/?$')).toBe(true);
      });
    else if (!path.endsWith('/'))
      it(`${path} has its slashed twin`, () => {
        expect(exact.has(`${path}/`)).toBe(true);
      });
  }
});
