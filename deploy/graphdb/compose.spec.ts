import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The graph database's image tag and its store's volume name the same release.
 *
 * The store lives in a volume so a restart does not copy it again, and a volume
 * outlives the image: change only the tag and the new release's container
 * serves the previous release's data, with nothing to say so. Naming the
 * volume for the release makes a tag change without a volume change a failure
 * here instead.
 */
const compose = readFileSync(join(__dirname, '../../docker-compose.yml'), 'utf8');
const service = compose.slice(
  compose.indexOf('\n  graphdb:\n'),
  compose.indexOf('\n  content-node:\n')
);

describe('the graph database service', () => {
  it('stores each release in a volume named for it', () => {
    const tag = /image:\s*public\.ecr\.aws\/reactome\/graphdb:Release(\d+)\s/.exec(service)?.[1];
    const volume = /-\s*graphdb-release(\d+):\/var\/lib\/neo4j\/data\b/.exec(service)?.[1];
    expect(tag, 'no Release tag on the graphdb image').toBeDefined();
    expect(volume, 'no release volume mounted on the store').toBe(tag);
    expect(compose).toMatch(new RegExp(`^  graphdb-release${tag}:`, 'm'));
  });

  it('publishes bolt on loopback only', () => {
    const published = [...service.matchAll(/^\s*-\s*'([^']*:\d+:\d+)'\s*$/gm)].map((m) => m[1]);
    expect(published).toEqual(['127.0.0.1:7687:7687']);
  });
});
