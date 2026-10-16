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
    expect(portsOf(service)).toEqual(['127.0.0.1:7687:7687']);
  });

  it('reads every form a port can be published in', () => {
    // The check matched only single-quoted short entries: "7474:7474",
    // 7687:7687 unquoted, or a long-syntax published: entry slipped past it
    // with the database exposed on every interface.
    const ports = (lines: string[]) =>
      portsOf(
        ['  graphdb:', '    ports:', ...lines.map((line) => `      ${line}`), '    volumes:'].join(
          '\n'
        )
      );
    expect(ports(["- '127.0.0.1:7687:7687'", '- "7474:7474"', '- 7687:7687'])).toEqual([
      '127.0.0.1:7687:7687',
      '7474:7474',
      '7687:7687',
    ]);
    expect(ports(['- target: 7687', '  published: 7687'])).toEqual(['long syntax: target: 7687']);
  });
});

/**
 * Every port a service block publishes, as written: short entries unquoted,
 * and a long-syntax entry named as such, so it cannot pass as loopback.
 */
function portsOf(block: string): string[] {
  const lines = block.split('\n');
  const start = lines.findIndex((line) => /^\s*ports:\s*$/.test(line));
  if (start === -1) return [];
  const indent = lines[start].search(/\S/);
  const found: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    if (line.search(/\S/) <= indent) break;
    const entry = /^\s*-\s*(.+?)\s*$/.exec(line)?.[1];
    if (entry === undefined) continue;
    const value = entry.replace(/^(['"])(.*)\1$/, '$2');
    found.push(/^\w+:\s/.test(value) ? `long syntax: ${value}` : value);
  }
  return found;
}
