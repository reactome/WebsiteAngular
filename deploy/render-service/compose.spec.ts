import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The render service's files as compose gives them (specs/032 T016): a host
 * staging a release names a local folder, because the staged release is not on
 * the download site until it is published; every other host leaves it unset and
 * the page fetches from that site as before.
 */
const compose = readFileSync(join(__dirname, '../../docker-compose.yml'), 'utf8');
const service = readFileSync(join(__dirname, '../../tools/render/service.ts'), 'utf8');

function block(name: string) {
  const start = compose.indexOf(`\n  ${name}:\n`);
  if (start === -1) return '';
  const next = /\n {2}[a-z][a-z-]*:\n/g;
  next.lastIndex = start + 1;
  return compose.slice(start, next.exec(compose)?.index ?? compose.length);
}
const render = block('render');

describe('the render service in compose', () => {
  it('reads the folder a host names, read-only, and an empty one otherwise', () => {
    expect(render).toMatch(
      /^ {6}- \$\{RENDER_FILES_DIR:-\.\/deploy\/render-service\/no-files\}:\/files:ro$/m
    );
  });

  it('is told to read it only when a host names one', () => {
    // `:+`: unset, RENDER_FILES is empty, and the service treats empty as
    // unset -- the download site, as before.
    expect(render).toMatch(/^ {6}- RENDER_FILES=\$\{RENDER_FILES_DIR:\+\/files\}$/m);
    expect(service).toMatch(/process\.env\['RENDER_FILES'\] \|\| undefined/);
  });

  it('draws as many at once as a host chooses, two by default', () => {
    expect(render).toMatch(/^ {6}- RENDER_CONCURRENCY=\$\{RENDER_CONCURRENCY:-2\}$/m);
  });

  it('is held to the memory a host gives it, 3 GB by default', () => {
    // Fixed while the concurrency is not, a host drawing more at once would
    // see the container killed instead of its pages closed (spec 018).
    expect(render).toMatch(/^ {4}mem_limit: \$\{RENDER_MEM_LIMIT:-3g\}$/m);
  });
});
