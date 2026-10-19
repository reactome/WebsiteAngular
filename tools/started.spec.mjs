// @vitest-environment node
//
// A service starts when Node is started with it, whatever its file is called
// (spec 013). The test was `endsWith('service.mjs')`: renamed to `.ts`, the
// content service loaded, never listened and exited 0. Each is started here
// through a link of another name, with nothing it could reach: a credentials
// file that does not exist and closed ports for the graph and the index.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';

const ROOT = path.join(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(tmpdir(), 'started-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The first line the service prints within the time, or what it said on stopping. */
function start(file, env) {
  const link = path.join(dir, `renamed-${path.basename(path.dirname(file))}.mjs`);
  symlinkSync(path.join(ROOT, file), link);
  const child = spawn(process.execPath, [link], { env: { ...process.env, ...env } });
  return new Promise((resolve) => {
    let out = '';
    const done = (said) => {
      clearTimeout(timer);
      child.kill();
      resolve(said);
    };
    const timer = setTimeout(() => done(`nothing after 15 s: ${out}`), 15_000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (/listening|render service on/.test(out)) done(out.split('\n')[0]);
    });
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('exit', (code) => done(`exited ${code}: ${out}`));
  });
}

/**
 * A port nothing listens on. Not 0: the services read it as unset and take
 * their defaults, which are the ports the running services use.
 */
const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(String(port)));
    });
  });

const NOWHERE = {
  CONTENT_NODE_ENV_FILE: path.join(dir, 'absent.env'),
  NEO4J_URI: 'bolt://127.0.0.1:9',
  SOLR_URL: 'http://127.0.0.1:9',
  REPORT_URL: 'http://127.0.0.1:9',
  RENDER_SERVICE_URL: 'http://127.0.0.1:9',
};

it('starts the content service under another file name', async () => {
  const said = await start('tools/content-node/service.mjs', {
    ...NOWHERE,
    CONTENT_NODE_HOST: '127.0.0.1',
    CONTENT_NODE_PORT: await freePort(),
  });
  expect(said).toMatch(/^content-node listening on/);
}, 30_000);

it('starts the render service under another file name', async () => {
  const said = await start('tools/render/service.mjs', {
    RENDER_HOST: '127.0.0.1',
    RENDER_PORT: await freePort(),
    RENDER_CACHE: path.join(dir, 'cache'),
    RENDER_BASE: 'http://127.0.0.1:9',
  });
  expect(said).toMatch(/^render service on/);
}, 30_000);
