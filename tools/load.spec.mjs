// @vitest-environment node
//
// Every service module loads under Node itself (spec 013). Node 24 runs the
// services' TypeScript by stripping the types, and refuses what it cannot
// strip or link: a type imported without `type`, an enum, a parameter
// property, an import without its extension. Vitest compiles them all
// happily, so a service could pass every spec here and not start.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const ROOT = path.join(import.meta.dirname, '..');
const SERVICES = ['content-node', 'render', 'analysis-gateway', 'api-types', 'analysis-types'];

/**
 * Command-line scripts that do their work when loaded (record answers, write
 * snapshots, launch a browser): checked for syntax only, never run here.
 */
const RUN_ON_LOAD = new Set([
  'tools/analysis-types/record',
  'tools/content-node/diff',
  'tools/content-node/snapshot-case',
  'tools/content-node/snapshot-domain',
  'tools/content-node/snapshot-graph-names',
  'tools/content-node/snapshot-rfd',
  'tools/content-node/snapshot-schema',
  'tools/render/render',
]);

const modules = SERVICES.flatMap((dir) =>
  readdirSync(path.join(ROOT, 'tools', dir))
    .filter((f) => /\.(mjs|ts)$/.test(f) && !/\.spec\.(mjs|ts)$/.test(f) && !f.endsWith('.d.ts'))
    .map((f) => `tools/${dir}/${f}`)
);

/** Nothing a loaded module could reach: no credentials file, closed ports. */
const NOWHERE = {
  ...process.env,
  CONTENT_NODE_ENV_FILE: path.join(ROOT, 'tools', 'absent.env'),
  NEO4J_URI: 'bolt://127.0.0.1:9',
  SOLR_URL: 'http://127.0.0.1:9',
  REPORT_URL: 'http://127.0.0.1:9',
};

/** What Node says loading `modules`, one child process for all, or '' when all load. */
function loadUnderNode(files) {
  const script = `
    const failed = [];
    for (const file of ${JSON.stringify(files)}) {
      try { await import(${JSON.stringify(ROOT + '/')} + file); }
      catch (e) { failed.push(file + ': ' + e.message.split('\\n')[0]); }
    }
    console.log(JSON.stringify(failed));
    process.exit(0);`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: NOWHERE,
    encoding: 'utf8',
    timeout: 60_000,
  });
  const last = run.stdout.trim().split('\n').at(-1) ?? '';
  return last.startsWith('[') ? JSON.parse(last) : [`no answer: ${run.stderr.slice(0, 500)}`];
}

it('loads every service module under Node', () => {
  const imported = modules.filter((m) => !RUN_ON_LOAD.has(m.replace(/\.(mjs|ts)$/, '')));
  expect(imported.length).toBeGreaterThan(20);
  expect(loadUnderNode(imported)).toEqual([]);
}, 90_000);

it('parses the scripts that run when loaded, without running them', () => {
  const scripts = modules.filter((m) => RUN_ON_LOAD.has(m.replace(/\.(mjs|ts)$/, '')));
  expect(scripts).toHaveLength(RUN_ON_LOAD.size);
  const failed = scripts.filter(
    (file) => spawnSync(process.execPath, ['--check', path.join(ROOT, file)]).status !== 0
  );
  expect(failed).toEqual([]);
}, 60_000);
