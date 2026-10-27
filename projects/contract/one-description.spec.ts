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

/**
 * A type that describes an answer's shape itself, rather than naming another
 * type: an object type, a mapped type, or either inside a union, an
 * intersection, parentheses, an array or a wrapper (`Readonly<{…}>`).
 */
const describesShape = (type: ts.TypeNode): boolean =>
  ts.isTypeLiteralNode(type) ||
  ts.isMappedTypeNode(type) ||
  (ts.isParenthesizedTypeNode(type) && describesShape(type.type)) ||
  (ts.isArrayTypeNode(type) && describesShape(type.elementType)) ||
  (ts.isUnionTypeNode(type) && type.types.some(describesShape)) ||
  (ts.isIntersectionTypeNode(type) && type.types.some(describesShape)) ||
  (ts.isTypeReferenceNode(type) && (type.typeArguments ?? []).some(describesShape));

/** A declaration's name with the namespaces it sits in: `Search.Icon.Entry`. */
function qualifiedName(node: ts.Node & { name: ts.Identifier }): string {
  const parts = [node.name.text];
  // A source file's parent is undefined at run time, whatever its type says.
  for (
    let at = node.parent as ts.Node | undefined;
    at !== undefined;
    at = at.parent as ts.Node | undefined
  )
    if (ts.isModuleDeclaration(at)) parts.unshift(at.name.text);
  return parts.join('.');
}

/** The name a type reference names, its last part: `GroupedResult` of `GroupedResult<E>`. */
const referenced = (type: ts.TypeNode): string | null =>
  ts.isTypeReferenceNode(type)
    ? ts.isIdentifier(type.typeName)
      ? type.typeName.text
      : type.typeName.right.text
    : null;

/**
 * The names readers give the contract's types by aliasing them in their own
 * code (`type SearchResult = GroupedResult<…>`, the pathway browser's
 * `Search.Entry`), by qualified name, following aliases of aliases. A type
 * imported from the contract under another name counts as the contract's.
 */
function localAliases(readers: Record<string, string>, contract: Set<string>): Set<string> {
  const known = new Set(contract);
  for (const [file, source] of Object.entries(readers))
    for (const statement of parse(file, source).statements)
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        /\/contract\/[^/]+\.ts$/.test(statement.moduleSpecifier.text)
      ) {
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings))
          for (const element of bindings.elements) known.add(element.name.text);
      }
  const aliases = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [file, source] of Object.entries(readers)) {
      const visit = (node: ts.Node) => {
        if (ts.isTypeAliasDeclaration(node)) {
          const target = referenced(node.type);
          const name = qualifiedName(node);
          if (target !== null && known.has(target) && !aliases.has(name)) {
            aliases.add(name);
            known.add(node.name.text);
            grew = true;
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(parse(file, source));
    }
  }
  return aliases;
}

/**
 * The readers' aliases, written down: a name stays protected when its alias
 * is turned into a description, which a list read from the code alone would
 * lose along with the alias. The spec holds this list to the code both ways.
 */
const READER_ALIASES = [
  'ResultGroup',
  'Search.Entry',
  'Search.Facet',
  'Search.Icon.Entry',
  'Search.Icon.Result',
  'Search.PathwayOf',
  'Search.Result',
  'SearchResult',
];

/** Every declaration in the readers that describes, again, an answer the contract has. */
function secondDescriptions(readers: Record<string, string>, names: Set<string>): string[] {
  const found: string[] = [];
  // A contract name or a re-export's is protected wherever it is declared; an
  // alias's, by its qualified name.
  const isProtected = (node: ts.Node & { name: ts.Identifier }) =>
    names.has(node.name.text) || names.has(qualifiedName(node));
  for (const [file, source] of Object.entries(readers)) {
    const visit = (node: ts.Node) => {
      if (ts.isInterfaceDeclaration(node) && isProtected(node))
        found.push(`${file}: interface ${qualifiedName(node)}`);
      if (ts.isClassDeclaration(node) && node.name && isProtected({ ...node, name: node.name }))
        found.push(`${file}: class ${node.name.text}`);
      if (ts.isTypeAliasDeclaration(node) && isProtected(node) && describesShape(node.type))
        found.push(`${file}: type ${qualifiedName(node)}`);
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
const contractOwn = contractNames(contract);
const aliases = localAliases(readers, contractOwn);
const names = new Set([...contractOwn, ...readerAliases(readers), ...READER_ALIASES]);

describe('one description per answer', () => {
  it('knows the contract by its names and the names readers give it', () => {
    // The site reads the search entry's view as SearchEntry.
    expect([...names]).toEqual(
      expect.arrayContaining(['SearchEntryView', 'SearchEntry', 'FacetCount'])
    );
  });

  it("lists the readers' aliases exactly, so one turned into a description is still caught", () => {
    expect([...aliases].sort()).toEqual([...READER_ALIASES].sort());
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
          'f.ts': 'type Facet = Readonly<{ name: string }>;',
          'g.ts': 'type IconEntry = { [K in "a" | "b"]: string };',
          'h.ts': 'export namespace Search { export interface Entry { dbId: string } }',
          'i.ts': 'export class SearchEntry { dbId = 0; }',
          'j.ts': 'type FacetCount = ({ name: string })[];',
          'k.ts': 'type Facet = Record<string, FacetCount>;',
        },
        new Set(['SearchEntry', 'FacetCount', 'IconEntry', 'Facet', 'ResultGroup', 'Search.Entry'])
      )
    ).toEqual([
      'a.ts: interface SearchEntry',
      'b.ts: type FacetCount',
      'c.ts: interface Search.IconEntry',
      'f.ts: type Facet',
      'g.ts: type IconEntry',
      'h.ts: interface Search.Entry',
      'i.ts: class SearchEntry',
      'j.ts: type FacetCount',
    ]);
  });
});
