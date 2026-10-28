import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The graph database's base image, its read-only image and its store's volume
 * name the same release.
 *
 * The store lives in a volume so a restart does not copy it again, and a volume
 * outlives the image: change only the tag and the new release's container
 * serves the previous release's data, with nothing to say so. Naming the
 * volume for the release makes a tag change without a volume change a failure
 * here instead. The same holds for the base the read-only image is built on:
 * a new tag over the old base would build the previous release under the new
 * name, and deploy/graphdb/next-release.sh reads the release from that name.
 */
const compose = readFileSync(join(__dirname, '../../docker-compose.yml'), 'utf8');
const service = compose.slice(
  compose.indexOf('\n  graphdb:\n'),
  compose.indexOf('\n  content-node:\n')
);

describe('the graph database service', () => {
  it('builds, names and stores one release', () => {
    const base = /GRAPHDB_IMAGE:\s*public\.ecr\.aws\/reactome\/graphdb:Release(\d+)\s/.exec(
      service
    )?.[1];
    const tag = /image:\s*reactome\/graphdb_readonly:Release(\d+)\s/.exec(service)?.[1];
    const volume = /-\s*graphdb-release(\d+):\/var\/lib\/neo4j\/data\b/.exec(service)?.[1];
    expect(base, "no Release tag on the release's image").toBeDefined();
    expect(tag, 'the read-only image names another release').toBe(base);
    expect(volume, 'no release volume mounted on the store').toBe(base);
    expect(compose).toMatch(new RegExp(`^  graphdb-release${base}:`, 'm'));
  });

  it('runs the release read-only', () => {
    expect(service).toMatch(/dockerfile:\s*Dockerfile\.readonly\s/);
    const dockerfile = readFileSync(join(__dirname, 'Dockerfile.readonly'), 'utf8');
    expect(dockerfile).toMatch(/^FROM \$\{GRAPHDB_IMAGE\}$/m);
    expect(dockerfile).toMatch(
      /dbms\.databases\.default_to_read_only=true' >> \/var\/lib\/neo4j\/conf\/neo4j\.conf$/m
    );
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
    // A comment at key indent between entries does not end the block.
    expect(
      portsOf(
        [
          '  graphdb:',
          '    ports:',
          "      - '127.0.0.1:7687:7687'",
          '    # a note',
          "      - '7474:7474'",
          '    volumes:',
        ].join('\n')
      )
    ).toEqual(['127.0.0.1:7687:7687', '7474:7474']);
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
    // A comment, at whatever indent, is not the next key: compose's own
    // comments sit at key indent between entries.
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (line.search(/\S/) <= indent) break;
    const entry = /^\s*-\s*(.+?)\s*$/.exec(line)?.[1];
    if (entry === undefined) continue;
    const value = entry.replace(/^(['"])(.*)\1$/, '$2');
    found.push(/^\w+:\s/.test(value) ? `long syntax: ${value}` : value);
  }
  return found;
}
