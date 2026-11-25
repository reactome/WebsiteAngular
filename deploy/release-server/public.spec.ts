import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Nothing server-specific in what spec 032 adds (FR-011, SC-006): the release
 * server's host names beyond its public one, its paths, addresses and other
 * services stay on the server. An allowlist, not a list of what to refuse: a
 * check naming the server's details would publish them itself.
 *
 * Every host name, IP address and absolute path in these files must be one of
 * the public ones below or a placeholder (`*.example`). A new one is either
 * public -- add it here, saying so in review -- or belongs on the server.
 */
const ROOT = join(__dirname, '../..');
const SCANNED = [
  'specs/032-release-server',
  'deploy/release-server',
  'deploy/nginx/site-local-examples',
  'deploy/nginx/release.conf',
  'deploy/site',
];

const HOSTS = [
  'release.reactome.org',
  'download.reactome.org',
  'beta.reactome.org',
  'reactome.org',
  'host.docker.internal',
];
const ADDRESSES = [/^127\.0\.0\.1$/, /^0\.0\.0\.0$/, /^203\.0\.113\.\d+$/];
const PATHS = [
  '/etc/nginx/',
  '/etc/letsencrypt',
  '/etc/ssl/cloudflare',
  '/var/www/certbot',
  '/run/php',
  '/run/secrets/',
  '/srv/wiki',
];

function files(path: string): string[] {
  const full = join(ROOT, path);
  if (!existsSync(full)) return [];
  if (!statSync(full).isDirectory()) return [full];
  return readdirSync(full).flatMap((name) => files(join(path, name)));
}

/** What in `text` is not public: host names, addresses and absolute paths. */
function unlisted(text: string): string[] {
  const hosts = [
    ...text.matchAll(
      /\b(?:[a-z0-9-]+\.)+(?:org|com|net|io|ca|uk|edu|aws|internal|local|lan|example)\b/g
    ),
  ]
    .map(([host]) => host)
    .filter((host) => !HOSTS.includes(host) && !/(^|\.)example$/.test(host));
  const addresses = [...text.matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)]
    .map(([address]) => address)
    .filter((address) => !ADDRESSES.some((allowed) => allowed.test(address)));
  const paths = [
    ...text.matchAll(
      /(?:^|[^\w.~-])(\/(?:usr|opt|home|srv|var|etc|run|mnt|data|tmp|root)\/[\w./-]*)/g
    ),
  ]
    .map(([, path = '']) => path)
    .filter((path) => !PATHS.some((allowed) => path.startsWith(allowed)));
  return [...new Set([...hosts, ...addresses, ...paths])];
}

describe('what spec 032 adds is public', () => {
  const scanned = SCANNED.flatMap(files).filter((file) => !file.endsWith('public.spec.ts'));

  it('scans the guide and the spec', () => {
    expect(scanned.length).toBeGreaterThan(5);
  });

  it('names no host, address or path of a server', () => {
    const found = scanned.flatMap((file) =>
      unlisted(readFileSync(file, 'utf8')).map((what) => `${relative(ROOT, file)}: ${what}`)
    );
    expect(found).toEqual([]);
  });

  it('sees one when one is there', () => {
    // Made-up details, of each kind the check reads.
    expect(
      unlisted(
        'proxy to build.internal at 10.1.2.3, files in /usr/local/somewhere/download/99, ' +
          'logs in /home/someone/x, and wiki.example at 127.0.0.1 under /etc/nginx/site-local'
      )
    ).toEqual([
      'build.internal',
      '10.1.2.3',
      '/usr/local/somewhere/download/99',
      '/home/someone/x',
    ]);
  });
});
