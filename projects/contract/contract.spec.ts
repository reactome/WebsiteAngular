// @vitest-environment node
//
// The contract holds types only and imports nothing outside itself (spec 016,
// research R1). The content service reads it under Node, which strips types
// and runs what is left, from an image holding only its own directory: a value
// here, or an import of the site, would pass the checks and fail there.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** A statement's kind as a reader says it: `FirstStatement` is the compiler's name for a variable. */
const kindOf = (statement: ts.Statement) =>
  ts.isVariableStatement(statement)
    ? 'a variable'
    : ts.isFunctionDeclaration(statement)
      ? 'a function'
      : ts.isClassDeclaration(statement)
        ? 'a class'
        : ts.isEnumDeclaration(statement)
          ? 'an enum'
          : ts.isModuleDeclaration(statement)
            ? 'a namespace'
            : `a ${ts.SyntaxKind[statement.kind]}`;

/** What a contract module declares or imports that it may not, as "module: why". */
function violations(modules: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [name, source] of Object.entries(modules)) {
    const say = (why: string) => found.push(`${name}: ${why}`);
    const file = ts.createSourceFile(`${name}.ts`, source, ts.ScriptTarget.Latest, true);
    const outside = (specifier: ts.Expression) => {
      if (!ts.isStringLiteral(specifier)) return 'a computed specifier';
      const target = specifier.text;
      if (!target.startsWith('./')) return target;
      return path.posix.normalize(target).includes('/') ? target : null;
    };
    for (const statement of file.statements) {
      if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
      if (ts.isImportDeclaration(statement)) {
        if (statement.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword)
          say('an import that is not `import type`');
        const where = outside(statement.moduleSpecifier);
        if (where) say(`imports ${where}, outside the contract`);
        continue;
      }
      if (ts.isExportDeclaration(statement)) {
        if (!statement.isTypeOnly) say('an export that is not `export type`');
        const where = statement.moduleSpecifier && outside(statement.moduleSpecifier);
        if (where) say(`re-exports ${where}, outside the contract`);
        continue;
      }
      say(`${kindOf(statement)}, which is not a type`);
    }
    // import('…') anywhere, a type position included, reads a module too.
    const visit = (node: ts.Node) => {
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        const where = outside(node.argument.literal as ts.Expression);
        if (where) say(`refers to ${where}, outside the contract`);
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

describe('the contract', () => {
  it('holds only types, importing only itself', () => {
    expect(Object.keys(real).length).toBeGreaterThan(0);
    expect(violations(real)).toEqual([]);
  });

  it('refuses a value of any kind', () => {
    expect(
      violations({
        search: [
          'export const EMPTY = {};',
          'export function f() {}',
          'export class C {}',
          'export enum E { A }',
          'export namespace N { export type T = string; }',
        ].join('\n'),
      })
    ).toEqual([
      'search: a variable, which is not a type',
      'search: a function, which is not a type',
      'search: a class, which is not a type',
      'search: an enum, which is not a type',
      'search: a namespace, which is not a type',
    ]);
  });

  it('refuses an import of the site, a package, or anything that is not a type', () => {
    expect(
      violations({
        search: [
          "import type { SearchFilters } from '../website-angular/src/model/search.model.ts';",
          "import { x } from './scalars.ts';",
          "import type { Cy } from 'cytoscape';",
          "export type { Facet } from '../website-angular/src/model/search.model.ts';",
          "export type T = import('../pathway-browser/src/app/model/search.model.ts').Search.Entry;",
        ].join('\n'),
      })
    ).toEqual([
      'search: imports ../website-angular/src/model/search.model.ts, outside the contract',
      'search: an import that is not `import type`',
      'search: imports cytoscape, outside the contract',
      'search: re-exports ../website-angular/src/model/search.model.ts, outside the contract',
      'search: refers to ../pathway-browser/src/app/model/search.model.ts, outside the contract',
    ]);
  });

  it('lets one module take types from another', () => {
    expect(
      violations({
        search:
          "import type { Long } from './scalars.ts';\nexport type { Long } from './scalars.ts';\nexport interface E { id: Long }",
      })
    ).toEqual([]);
  });
});
