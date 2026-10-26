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
  // Above layer 6: what both search families share (T024-T025).
  'search-core': [
    'java-text',
    'body',
    'spring',
    'answers',
    'objects',
    'reference-entities',
    'search-params',
    'release',
  ],
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
 * leaves: a leaf that reached the registry, a family or the server would
 * close a cycle through whatever imports it.
 */
const isLeaf = (name: string) =>
  !isFamily(name) && !isShared(name) && !TOOLS.has(name) && !['registry', 'server'].includes(name);

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
        // The families, and the Endpoint types their lists are declared in.
        if (!isFamily(other) && other !== 'endpoint') say('the registry imports only the families');
      } else if (name === 'server') {
        if (isFamily(other)) say('the server imports the registry, never a family');
      } else if (!isLeaf(other)) say('a leaf imports only leaves');
    }
  }
  return found;
}

/**
 * Every reach outside this directory that survives when Node strips the
 * types, as "module imports target" or "module reads target". The service's
 * image holds only this directory (and tools/package.json), so such a reach
 * passes every check here and fails there (spec 016, research R1).
 *
 * Read: imports and re-exports that are not `import type` or `export type`
 * (`import { type X }` leaves `import {}` behind, which loads the module),
 * `import()`, `require()`, `import x = require()`, `import.meta.resolve()`,
 * and a file named relative to the module, `new URL('…', import.meta.url)`.
 * An `import()` whose path is not written out is refused: nothing can say
 * where it goes. Imports in type positions are erased; a package (no leading
 * `.`) is the image's to install, not this check's.
 */
function valueEscapes(modules: Record<string, string>): string[] {
  const found: string[] = [];
  /** Where a written path goes: outside, or null when it stays here or is a package. */
  const outside = (specifier: ts.Expression | undefined) => {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return null;
    const target = specifier.text;
    if (!target.startsWith('.')) return null;
    const resolved = path.posix.normalize(path.posix.join('tools', 'content-node', target));
    return resolved.startsWith('tools/content-node/') ? null : target;
  };
  const isImportMeta = (node: ts.Node) =>
    ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword;
  for (const [name, source] of Object.entries(modules)) {
    const file = ts.createSourceFile(`${name}.ts`, source, ts.ScriptTarget.Latest, true);
    const check = (specifier: ts.Expression | undefined, verb = 'imports') => {
      const target = outside(specifier);
      if (target) found.push(`${name} ${verb} ${target}`);
    };
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) {
        if (node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword)
          check(node.moduleSpecifier);
      } else if (ts.isExportDeclaration(node)) {
        if (!node.isTypeOnly) check(node.moduleSpecifier);
      } else if (ts.isImportEqualsDeclaration(node)) {
        if (ts.isExternalModuleReference(node.moduleReference) && !node.isTypeOnly)
          check(node.moduleReference.expression);
      } else if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const [first] = node.arguments;
        if (callee.kind === ts.SyntaxKind.ImportKeyword) {
          if (first && !ts.isStringLiteralLike(first))
            found.push(`${name} imports a path not written out`);
          else check(first);
        } else if (ts.isIdentifier(callee) && callee.text === 'require') check(first);
        else if (
          ts.isPropertyAccessExpression(callee) &&
          callee.name.text === 'resolve' &&
          isImportMeta(callee.expression)
        )
          check(first);
      } else if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'URL' &&
        node.arguments?.[1] &&
        ts.isPropertyAccessExpression(node.arguments[1]) &&
        node.arguments[1].name.text === 'url' &&
        isImportMeta(node.arguments[1].expression)
      ) {
        check(node.arguments[0], 'reads');
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
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

  it('refuse a leaf reaching the registry, a family, the server or a tool', () => {
    expect(
      violations({
        graph: "import { endpoints } from './registry.ts';",
        solr: "import { x } from './search-endpoints.ts';\nimport './server.ts';",
        settings: "import { diffAll } from './diff.ts';",
        // A module added without a place in the table is a leaf too.
        'new-helper':
          "import { y } from './citation-endpoints.ts';\nimport { z } from './domain.ts';",
      })
    ).toEqual([
      'graph imports registry: a leaf imports only leaves',
      'solr imports search-endpoints: a leaf imports only leaves',
      'solr imports server: a leaf imports only leaves',
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
          "import { a } from './citation-endpoints.ts';\nimport type { Endpoint } from './endpoint.ts';\nimport { read } from './graph.ts';",
      })
    ).toEqual([
      'server imports citation-endpoints: the server imports the registry, never a family',
      'registry imports graph: the registry imports only the families',
    ]);
  });

  it('let families and shared modules take the Endpoint types from their leaf', () => {
    expect(
      violations({
        'citation-endpoints': "import type { Endpoint } from './endpoint.ts';",
        answers: "import type { Answer, Handler, Request } from './endpoint.ts';",
      })
    ).toEqual([]);
  });

  it('reach outside this directory only for types, which Node erases', () => {
    expect(valueEscapes(real)).toEqual([]);
  });

  it('refuse a value import or a read from outside this directory, in any form', () => {
    expect(
      valueEscapes({
        'search-core': [
          "import { FacetCount } from '../../projects/contract/search.ts';",
          "import { type Facet } from '../../projects/contract/search.ts';",
          "import '../../projects/contract/search.ts';",
          "export { Facet } from '../../projects/contract/search.ts';",
          "const m = await import('../java-parity/parity.ts');",
          "import x = require('../render/render.ts');",
          'const t = await import(`../java-parity/parity.ts`);',
          'const c = await import(where);',
          "const r = require('../render/render.ts');",
          "const u = import.meta.resolve('../render/render.ts');",
          "const d = readFileSync(new URL('../../projects/contract/x.json', import.meta.url));",
        ].join('\n'),
      })
    ).toEqual([
      'search-core imports ../../projects/contract/search.ts',
      'search-core imports ../../projects/contract/search.ts',
      'search-core imports ../../projects/contract/search.ts',
      'search-core imports ../../projects/contract/search.ts',
      'search-core imports ../java-parity/parity.ts',
      'search-core imports ../render/render.ts',
      'search-core imports ../java-parity/parity.ts',
      'search-core imports a path not written out',
      'search-core imports ../render/render.ts',
      'search-core imports ../render/render.ts',
      'search-core reads ../../projects/contract/x.json',
    ]);
  });

  it('let a module take types from anywhere, and values from here or a package', () => {
    expect(
      valueEscapes({
        'search-core': [
          "import type { FacetCount } from '../../projects/contract/search.ts';",
          "export type { Facet } from '../../projects/contract/search.ts';",
          "type T = import('../../projects/contract/search.ts').Facet;",
          "import { read } from './graph.ts';",
          "import { read as r } from '../content-node/graph.ts';",
          "import express from 'express';",
          "const snapshot = readFileSync(new URL('./domain-snapshot.json', import.meta.url));",
          'const render = new URL(`${RENDER_SERVICE}/render/x.png`);',
          "const { endpoints } = await import('./registry.ts');",
        ].join('\n'),
      })
    ).toEqual([]);
  });

  it('let the tools read anything, the endpoint list included', () => {
    expect(
      violations({
        diff: "import { app } from './server.ts';\nimport { endpoints } from './registry.ts';",
      })
    ).toEqual([]);
  });
});
