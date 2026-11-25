import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The analysis gateway's secrets file as compose mounts it (spec 031, review
 * of 25 Nov). In the short form a missing file is made a directory, the
 * gateway reads no identity secret, and every report is refused, on a server
 * where nobody has put the file yet, with nothing to say why.
 */
const compose = readFileSync(join(__dirname, '../../docker-compose.yml'), 'utf8');

function block(name: string) {
  const start = compose.indexOf(`\n  ${name}:\n`);
  if (start === -1) return '';
  const next = /\n {2}[a-z][a-z-]*:\n/g;
  next.lastIndex = start + 1;
  return compose.slice(start, next.exec(compose)?.index ?? compose.length);
}
const gateway = block('analysis-gateway');

describe('the analysis gateway in compose', () => {
  it('mounts the file a host names, and will not start without it', () => {
    expect(gateway).toMatch(/^ {8}source: \$\{ANSWER_ENV_FILE:-[^}]+\}$/m);
    expect(gateway).toMatch(/^ {8}target: \/run\/secrets\/answer\.env$/m);
    expect(gateway).toMatch(/^ {8}read_only: true$/m);
    expect(gateway).toMatch(/^ {10}create_host_path: false$/m);
    expect(gateway).not.toMatch(/answer\.env:\/run\/secrets/);
  });
});
