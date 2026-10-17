import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A page's own requests must fit inside the per-client limits.
 *
 * Over HTTP/2 nginx counts every stream against `limit_conn`, so the limit is
 * the number of requests one visitor may have in flight at once. A cold load of
 * the Pathway Browser or the home page asks for about 40 files, 28 or more of
 * them in flight together; beta's limit of 24 refused the rest with 503, and a
 * page missing script chunks is blank. Measured with a fresh browser on beta's
 * origin, 13 Oct 2026.
 */
const A_PAGE_IN_FLIGHT = 40;

function limitConns(file: string): number[] {
  const conf = readFileSync(join(__dirname, file), 'utf8');
  return [...conf.matchAll(/^\s*limit_conn\s+\S+\s+(\d+);/gm)].map((m) => Number(m[1]));
}

describe('per-client request limits', () => {
  for (const file of ['dev.conf', 'release.conf', 'production.conf']) {
    it(`${file} lets one page's requests through at once`, () => {
      const limits = limitConns(file);
      expect(limits.length, 'no limit_conn found').toBeGreaterThan(0);
      for (const limit of limits) expect(limit).toBeGreaterThanOrEqual(A_PAGE_IN_FLIGHT);
    });
  }
});

/**
 * Uploads must reach the services: Java's own cap is 50 MiB, and a result for
 * many samples is several megabytes. local.conf once set nothing, so nginx's
 * 1 MB default refused local uploads that every deployment accepted.
 */
const JAVA_UPLOAD_CAP_MB = 50;

describe('request body limits', () => {
  for (const file of ['dev.conf', 'release.conf', 'production.conf', 'local.conf']) {
    it(`${file} lets an upload of Java's size through`, () => {
      const conf = readFileSync(join(__dirname, file), 'utf8');
      const sizes = [...conf.matchAll(/^\s*client_max_body_size\s+(\d+)m;/gm)].map((m) =>
        Number(m[1])
      );
      expect(sizes.length, 'no client_max_body_size').toBeGreaterThan(0);
      for (const size of sizes) expect(size).toBeGreaterThanOrEqual(JAVA_UPLOAD_CAP_MB);
    });
  }
});
