// @vitest-environment node
//
// One description per answer (spec 016, FR-003): an answer in the contract is
// not described again by the site or the pathway browser, under its own name
// or under the name a reader re-exports it as. An alias of the contract's type
// is a name, not a description, and is allowed.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONTRACT = path.join(ROOT, 'projects/contract');
const READERS = ['projects/website-angular/src', 'projects/pathway-browser/src'];

/** Every non-spec TypeScript module under a directory, by repository path. */
function modules(dir: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const file of readdirSync(path.join(ROOT, dir), { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.ts') || file.endsWith('.spec.ts') || file.endsWith('.d.ts')) continue;
    const where = path.posix.join(dir, file.split(path.sep).join('/'));
    found[where] = readFileSync(path.join(ROOT, where), 'utf8');
  }
  return found;
}

const parse = (name: string, source: string) =>
  ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);

/** The contract's exported interfaces and types. */
function contractNames(contract: Record<string, string>): Set<string> {
  const names = new Set<string>();
  for (const [file, source] of Object.entries(contract))
    for (const statement of parse(file, source).statements)
      if (
        (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      )
        names.add(statement.name.text);
  return names;
}

/** The names readers re-export the contract's types as (`export type { A as B } from '…/contract/…'`). */
function readerAliases(readers: Record<string, string>): Set<string> {
  const names = new Set<string>();
  for (const [file, source] of Object.entries(readers))
    for (const statement of parse(file, source).statements)
      if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        /\/contract\/[^/]+\.ts$/.test(statement.moduleSpecifier.text) &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      )
        for (const element of statement.exportClause.elements) names.add(element.name.text);
  return names;
}

/** A type that describes an answer's shape itself, rather than naming another type. */
const describesShape = (type: ts.TypeNode): boolean =>
  ts.isTypeLiteralNode(type) ||
  (ts.isUnionTypeNode(type) && type.types.some(describesShape)) ||
  (ts.isIntersectionTypeNode(type) && type.types.some(describesShape));

/** Every declaration in the readers that describes, again, an answer the contract has. */
function secondDescriptions(readers: Record<string, string>, names: Set<string>): string[] {
  const found: string[] = [];
  for (const [file, source] of Object.entries(readers)) {
    const visit = (node: ts.Node) => {
      if (ts.isInterfaceDeclaration(node) && names.has(node.name.text))
        found.push(`${file}: interface ${node.name.text}`);
      if (ts.isTypeAliasDeclaration(node) && names.has(node.name.text) && describesShape(node.type))
        found.push(`${file}: type ${node.name.text}`);
      ts.forEachChild(node, visit);
    };
    visit(parse(file, source));
  }
  return found;
}

const contract = Object.fromEntries(
  readdirSync(CONTRACT)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .map((file) => [file, readFileSync(path.join(CONTRACT, file), 'utf8')])
);
const readers = Object.assign({}, ...READERS.map(modules)) as Record<string, string>;
const names = new Set([...contractNames(contract), ...readerAliases(readers)]);

describe('one description per answer', () => {
  it('knows the contract by its names and the names readers give it', () => {
    // The site reads the search entry's view as SearchEntry.
    expect([...names]).toEqual(
      expect.arrayContaining(['SearchEntryView', 'SearchEntry', 'FacetCount'])
    );
  });

  it('finds no answer described again by the site or the pathway browser', () => {
    expect(secondDescriptions(readers, names)).toEqual([]);
  });

  it('refuses an interface or an object type under a contract name, and allows an alias', () => {
    expect(
      secondDescriptions(
        {
          'a.ts': 'export interface SearchEntry { dbId: number }',
          'b.ts': 'type FacetCount = { name: string; count: number };',
          'c.ts': 'export namespace Search { export interface IconEntry { stId: string } }',
          'd.ts': "import type { FacetCount as F } from '../contract/search.ts';\ntype Facet = F;",
          'e.ts': 'type ResultGroup = Group<SearchEntryView>;',
        },
        new Set(['SearchEntry', 'FacetCount', 'IconEntry', 'Facet', 'ResultGroup'])
      )
    ).toEqual([
      'a.ts: interface SearchEntry',
      'b.ts: type FacetCount',
      'c.ts: interface IconEntry',
    ]);
  });
});
