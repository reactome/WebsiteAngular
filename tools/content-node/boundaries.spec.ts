// @vitest-environment node
//
// What may import what in the content service (spec 014,
// contracts/boundaries.md). Families -- the `*-endpoints.ts` modules -- import
// only shared modules, never another family, the registry or the server, so
// a change to one family's endpoints is a change to one family's module. The
// shared modules are layered, each importing only those beneath it.
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** The shared modules, by layer: a module imports only from earlier layers. */
const LAYERS = [
  ['java-text'],
  ['body'],
  ['spring'],
  ['answers'],
  ['objects'],
  ['reference-entities', 'search-params', 'release'],
];
const layerOf = (name: string) => LAYERS.findIndex((layer) => layer.includes(name));
const isFamily = (name: string) => name.endsWith('-endpoints');

/**
 * The local modules a source imports -- static, type-only, side-effect,
 * re-exported or dynamic -- by name without `./` or an extension, as
 * TypeScript itself reads them.
 */
function importsOf(source: string): string[] {
  return ts
    .preProcessFile(source, true, true)
    .importedFiles.map((file) => /^\.\/([\w-]+)(?:\.(?:ts|mjs))?$/.exec(file.fileName)?.[1] ?? '')
    .filter(Boolean);
}

/** Every import the boundaries forbid, as "module imports other: why". */
function violations(modules: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [name, source] of Object.entries(modules)) {
    for (const other of importsOf(source)) {
      const say = (why: string) => found.push(`${name} imports ${other}: ${why}`);
      if (isFamily(name)) {
        if (isFamily(other)) say('a family imports no other family');
        else if (['registry', 'server', 'service'].includes(other))
          say('a family imports only shared modules');
      } else if (layerOf(name) >= 0) {
        const theirs = layerOf(other);
        if (isFamily(other) || ['registry', 'server', 'service'].includes(other))
          say('a shared module imports only shared modules beneath it');
        else if (theirs >= layerOf(name))
          say(`layer ${layerOf(name) + 1} imports layer ${theirs + 1}`);
      } else if (name === 'registry') {
        if (other === 'server') say('the registry is read by the server, not the other way');
      }
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
        ].join('\n'),
      })
    ).toEqual([
      'search-endpoints imports citation-endpoints: a family imports no other family',
      'search-endpoints imports server: a family imports only shared modules',
      'search-endpoints imports registry: a family imports only shared modules',
    ]);
  });

  it('refuse a shared module importing one above it', () => {
    expect(violations({ spring: "import { javaJson } from './answers.ts';" })).toEqual([
      'spring imports answers: layer 3 imports layer 4',
    ]);
  });
});
