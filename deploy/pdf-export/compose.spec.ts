import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The PDF service as compose runs it (spec 006 T100): what keeps it private,
 * what it reads, and that node is told where it is.
 */
const compose = readFileSync(join(__dirname, '../../docker-compose.yml'), 'utf8');
const dockerfile = readFileSync(join(__dirname, 'Dockerfile'), 'utf8');

/** A service's block: from its key to the next key at two spaces' indent. */
function service(name: string) {
  const start = compose.indexOf(`\n  ${name}:\n`);
  if (start === -1) return '';
  const next = /\n {2}[a-z][a-z-]*:\n/g;
  next.lastIndex = start + 1;
  return compose.slice(start, next.exec(compose)?.index ?? compose.length);
}
const pdf = service('pdf-export');

describe('the PDF service in compose', () => {
  it('is there', () => {
    expect(pdf, 'no pdf-export service in docker-compose.yml').not.toBe('');
  });

  it('is reached on loopback only, on the port node is given', () => {
    // Host networking publishes nothing; the service binds loopback itself.
    expect(pdf).toMatch(/^ {4}network_mode: host$/m);
    expect(pdf).not.toMatch(/^ {4}ports:/m);
    // Not set here, so the image's loopback stands.
    expect(pdf).not.toMatch(/^ {6}- BIND_ADDRESS=/m);
    expect(dockerfile).toMatch(/^ {4}BIND_ADDRESS=127\.0\.0\.1 \\$/m);
    expect(dockerfile).toMatch(/^ {4}PORT=4370$/m);
    expect(service('content-node')).toMatch(/^ {6}- PDF_SERVICE=http:\/\/127\.0\.0\.1:4370$/m);
    expect(pdf).toContain('http://127.0.0.1:4370/health');
  });

  it('is built here and never pulled from or pushed to a registry', () => {
    expect(pdf).toMatch(/^ {6}dockerfile: deploy\/pdf-export\/Dockerfile$/m);
    expect(pdf).not.toMatch(/^ {4}image:/m);
  });

  it('reads the graph credentials from a read-only mount, as their owner', () => {
    expect(pdf).toMatch(/^ {6}- [^\n]*:\/run\/secrets\/content-node\.env:ro$/m);
    expect(pdf).toMatch(/^ {6}- PDF_EXPORT_ENV_FILE=\/run\/secrets\/content-node\.env$/m);
    expect(pdf).toMatch(/^ {4}user: '\$\{CONTENT_NODE_UID:-1020\}:\$\{CONTENT_NODE_GID:-1001\}'$/m);
  });

  it('reads the release’s folder read-only, where the command line looks for it', () => {
    expect(pdf).toMatch(/^ {6}- \$\{RELEASE_FILES_DIR:-[^}]+\}:\/files:ro$/m);
    expect(dockerfile).toMatch(/"--files", "\/files"/);
  });

  it('keeps the printer’s working folder in memory, its user’s alone (pdf-export spec 002, T018)', () => {
    // A report's page holds what a user submitted, and one killed mid-print
    // stays until the service starts again: never on disk.
    expect(pdf).toMatch(/^ {6}- PDF_EXPORT_WORK=\/work$/m);
    const mount = pdf.match(/^ {4}tmpfs:\n {6}- \/work:(\S+)$/m)?.[1] ?? 'no tmpfs at /work';
    const options = mount.split(',');
    expect(options).toEqual(
      expect.arrayContaining([
        'mode=0700',
        'uid=${CONTENT_NODE_UID:-1020}',
        'gid=${CONTENT_NODE_GID:-1001}',
        'noexec',
      ])
    );
    expect(options.some((o) => /^size=\d+m$/.test(o))).toBe(true);
  });

  it('reads the analysis service directly, not through the gateway that sends it reports', () => {
    expect(pdf).toMatch(/^ {6}- ANALYSIS_SERVICE=http:\/\/127\.0\.0\.1:8080\/AnalysisService$/m);
  });

  it('is where the analysis gateway sends the reports (pdf-export spec 002, T021)', () => {
    const gateway = service('analysis-gateway');
    expect(gateway).toMatch(
      /^ {6}- REPORT_UPSTREAM=\$\{REPORT_UPSTREAM:-http:\/\/127\.0\.0\.1:4370\}$/m
    );
    expect(gateway).not.toMatch(/REPORT_LIMIT/);
  });

  it('gives Chromium room, and the whole a limit', () => {
    expect(pdf).toMatch(/^ {4}shm_size: '1gb'$/m);
    expect(pdf).toMatch(/^ {4}mem_limit: \d+[mg]$/m);
  });
});
