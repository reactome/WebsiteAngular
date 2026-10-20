// @vitest-environment node
//
// What may import what in the content service (spec 014,
// contracts/boundaries.md). Families -- the `*-endpoints.ts` modules -- import
// only shared modules, never another family, the registry or the server, so
// a change to one family's endpoints is a change to one family's module. The
// shared modules are layered, each importing only those beneath it.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The shared modules and what each may import besides the leaves
 * (contracts/boundaries.md): each only those beneath it, as the table names
 * them.
 */
const SHARED: Record<string, string[]> = {
  'java-text': [],
  body: ['java-text'],
  spring: ['java-text', 'body'],
  answers: ['java-text', 'spring'],
  objects: ['java-text', 'body', 'spring', 'answers'],
  'reference-entities': ['java-text', 'body', 'spring', 'answers', 'objects'],
  'search-params': ['java-text', 'body', 'spring', 'answers', 'objects'],
  release: ['java-text', 'body', 'spring', 'answers', 'objects'],
};
/**
 * The tools beside the service that read its endpoint list -- the parity
 * harness and the invalid-input corpus: they may import anything, and
 * nothing in the service may import them.
 */
const TOOLS = new Set(['diff', 'invalid-inputs']);
const isFamily = (name: string) => name.endsWith('-endpoints');
const isShared = (name: string) => name in SHARED;
/**
 * Everything else is a leaf -- graph, solr, domain, schema, settings and the
 * like, and any module added without a place here -- and imports only
 * leaves: a leaf that reached the registry, a family or the service would
 * close a cycle through whatever imports it.
 */
const isLeaf = (name: string) =>
  !isFamily(name) &&
  !isShared(name) &&
  !TOOLS.has(name) &&
  !['registry', 'server', 'service'].includes(name);

/**
 * The local modules a source imports -- static, type-only, side-effect,
 * re-exported or dynamic -- by name without `./` or an extension, as
 * TypeScript itself reads them.
 */
function importsOf(source: string): string[] {
  // Resolved against this directory, so `../content-node/registry.ts` and
  // `./registry.js` are the registry as much as `./registry.ts` is; a module
  // elsewhere is not one of this service's.
  const here = path.posix.join('tools', 'content-node');
  return ts
    .preProcessFile(source, true, true)
    .importedFiles.map((file) => file.fileName)
    .filter((name) => name.startsWith('.'))
    .map((name) => path.posix.normalize(path.posix.join(here, name)))
    .filter((resolved) => path.posix.dirname(resolved) === here)
    .map((resolved) => path.posix.basename(resolved).replace(/\.[cm]?[jt]s$/, ''));
}

/** Every import the boundaries forbid, as "module imports other: why". */
function violations(modules: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [name, source] of Object.entries(modules)) {
    for (const other of importsOf(source)) {
      const say = (why: string) => found.push(`${name} imports ${other}: ${why}`);
      if (TOOLS.has(name)) continue;
      if (TOOLS.has(other)) say('nothing in the service imports a tool');
      else if (isFamily(name)) {
        if (isFamily(other)) say('a family imports no other family');
        else if (!isShared(other) && !isLeaf(other)) say('a family imports only shared modules');
      } else if (isShared(name)) {
        if (!isLeaf(other) && !(SHARED[name] ?? []).includes(other))
          say(`${name} imports only ${(SHARED[name] ?? []).join(', ') || 'leaves'} beneath it`);
      } else if (name === 'registry') {
        if (!isFamily(other)) say('the registry imports only the families');
      } else if (name === 'server') {
        if (isFamily(other) || other === 'service')
          say('the server imports the registry, never a family');
      } else if (name === 'service') {
        // The list's last home until T026 removes it: anything but a tool.
      } else if (!isLeaf(other)) say('a leaf imports only leaves');
    }
  }
  return found;
}

const DIR = new URL('./', import.meta.url);
const real = Object.fromEntries(
  readdirSync(DIR)
    .filter((file) => file.endsWith('.ts') && !/\.(spec|d)\.ts$/.test(file))
    .map((file) => [file.replace(/\.ts$/, ''), readFileSync(new URL(file, DIR), 'utf8')])
);

describe('the content service boundaries', () => {
  it('hold in the service as it is', () => {
    expect(violations(real)).toEqual([]);
  });

  it('refuse a family importing another family, or the registry', () => {
    expect(
      violations({
        'search-endpoints': "import { x } from './citation-endpoints.ts';",
        'citation-endpoints': "import { endpoints } from './registry.ts';",
      })
    ).toEqual([
      'search-endpoints imports citation-endpoints: a family imports no other family',
      'citation-endpoints imports registry: a family imports only shared modules',
    ]);
  });

  it('read every form of import: dynamic, side-effect, with a comment in its list', () => {
    expect(
      violations({
        'search-endpoints': [
          "import {\n  // Java's name for it\n  x,\n} from './citation-endpoints.ts';",
          "import './server.ts';",
          "const { endpoints } = await import('./registry.ts');",
          "import { x as y } from '../content-node/pathways-events-endpoints.ts';",
          "import { z } from './release.js';",
        ].join('\n'),
      })
    ).toEqual([
      'search-endpoints imports citation-endpoints: a family imports no other family',
      'search-endpoints imports server: a family imports only shared modules',
      'search-endpoints imports registry: a family imports only shared modules',
      'search-endpoints imports pathways-events-endpoints: a family imports no other family',
    ]);
  });

  it('refuse a shared module importing one its row does not name', () => {
    expect(
      violations({
        spring: "import { javaJson } from './answers.ts';",
        // body is beneath answers, but answers' row does not name it.
        answers: "import { plainText } from './body.ts';",
        objects: "import { read } from './graph.ts';\nimport { only } from './answers.ts';",
      })
    ).toEqual([
      'spring imports answers: spring imports only java-text, body beneath it',
      'answers imports body: answers imports only java-text, spring beneath it',
    ]);
  });

  it('refuse a leaf reaching the registry, a family, the service or a tool', () => {
    expect(
      violations({
        graph: "import { endpoints } from './registry.ts';",
        solr: "import { x } from './search-endpoints.ts';\nimport './service.ts';",
        settings: "import { diffAll } from './diff.ts';",
        // A module added without a place in the table is a leaf too.
        'new-helper':
          "import { y } from './citation-endpoints.ts';\nimport { z } from './domain.ts';",
      })
    ).toEqual([
      'graph imports registry: a leaf imports only leaves',
      'solr imports search-endpoints: a leaf imports only leaves',
      'solr imports service: a leaf imports only leaves',
      'settings imports diff: nothing in the service imports a tool',
      'new-helper imports citation-endpoints: a leaf imports only leaves',
    ]);
  });

  it('refuse the server importing a family, and the registry anything but families', () => {
    expect(
      violations({
        server:
          "import { endpoints } from './registry.ts';\nimport { x } from './citation-endpoints.ts';\nimport { read } from './graph.ts';",
        registry:
          "import { a } from './citation-endpoints.ts';\nimport { read } from './graph.ts';",
      })
    ).toEqual([
      'server imports citation-endpoints: the server imports the registry, never a family',
      'registry imports graph: the registry imports only the families',
    ]);
  });

  it('let the tools read anything, the endpoint list included', () => {
    expect(
      violations({
        diff: "import { endpoints } from './service.ts';\nimport { x } from './registry.ts';",
      })
    ).toEqual([]);
  });
});
