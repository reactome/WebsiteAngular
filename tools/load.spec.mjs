// @vitest-environment node
//
// Every service module loads under Node itself (spec 013). Node 24 runs the
// services' TypeScript by stripping the types, and refuses what it cannot
// strip or link: a type imported without `type`, an enum, a parameter
// property, an import without its extension. Vitest compiles them all
// happily, so a service could pass every spec here and not start.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import path from 'node:path';
import { expect, it } from 'vitest';

const ROOT = path.join(import.meta.dirname, '..');
// With the two command-line tools run under Node as they are: the library
// workflow runs one daily, and nothing else would load it before then.
const SERVICES = [
  'content-node',
  'render',
  'analysis-gateway',
  'api-types',
  'analysis-types',
  'java-parity',
  'library-update',
];

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
  PSICQUIC_REGISTRY_URL: 'http://127.0.0.1:9/',
  EUROPE_PMC_URL: 'http://127.0.0.1:9/',
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

/**
 * What Node would refuse in a script, without running it (review of #544:
 * `node --check` only parses, and passes an enum or a type imported as a
 * value). Its types stripped as Node strips them, which refuses what Node
 * refuses; the rest parsed; and every name it imports, unless marked `type`,
 * looked for among the exports of the module it names, which is loaded.
 */
function scriptProblems(file) {
  const source = readFileSync(file, 'utf8');
  let code = source;
  if (file.endsWith('.ts'))
    try {
      code = stripTypeScriptTypes(source);
    } catch (error) {
      return [`${file}: ${error.message.split('\n')[0]}`];
    }
  const scratch = mkdtempSync(path.join(tmpdir(), 'script-'));
  try {
    const stripped = path.join(scratch, 'script.mjs');
    writeFileSync(stripped, code);
    const parse = spawnSync(process.execPath, ['--check', stripped], { encoding: 'utf8' });
    if (parse.status !== 0) return [`${file}: ${parse.stderr.split('\n').find(Boolean)}`];
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const wanted = [];
  for (const statement of ts.createSourceFile(file, source, ts.ScriptTarget.Latest).statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
    const from = statement.moduleSpecifier.text;
    // This repository's modules; packages are not this check's to doubt.
    if (!from.startsWith('.') && !path.isAbsolute(from)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements)
      if (!element.isTypeOnly)
        wanted.push([
          path.resolve(path.dirname(file), from),
          (element.propertyName ?? element.name).text,
        ]);
  }
  if (wanted.length === 0) return [];
  const check = `
    const missing = [];
    for (const [target, name] of ${JSON.stringify(wanted)}) {
      const exports = await import(target);
      if (!(name in exports)) missing.push(target + ' has no export ' + name);
    }
    console.log(JSON.stringify(missing));`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', check], {
    env: NOWHERE,
    encoding: 'utf8',
  });
  const last = run.stdout.trim().split('\n').at(-1) ?? '';
  return last.startsWith('[')
    ? JSON.parse(last).map((m) => `${file}: ${m}`)
    : [`${file}: ${run.stderr.split('\n').find(Boolean)}`];
}

it('checks the scripts that run when loaded as Node would, without running them', () => {
  const scripts = modules.filter((m) => RUN_ON_LOAD.has(m.replace(/\.(mjs|ts)$/, '')));
  expect(scripts).toHaveLength(RUN_ON_LOAD.size);
  expect(scripts.flatMap((file) => scriptProblems(path.join(ROOT, file)))).toEqual([]);
}, 120_000);

it('refuses a script with what Node cannot strip, or a type imported as a value', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'scripts-'));
  try {
    const thing = path.join(ROOT, 'tools/api-types/fixtures/thing.model.ts');
    const write = (name, text) => {
      writeFileSync(path.join(dir, name), text);
      return path.join(dir, name);
    };
    expect(scriptProblems(write('enum.ts', 'export {};\nenum E { A }\n')).join()).toMatch(
      /enum|TypeScript/i
    );
    expect(
      scriptProblems(
        write('value.ts', `import { Thing } from '${thing}';\nexport const t: Thing | 0 = 0;\n`)
      )
    ).toEqual([expect.stringMatching(/has no export Thing$/)]);
    expect(
      scriptProblems(
        write('type.ts', `import type { Thing } from '${thing}';\nexport const t: Thing | 0 = 0;\n`)
      )
    ).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
