#!/usr/bin/env node
/**
 * Shows that a move is a move (spec 014, research R6).
 *
 * Splitting the content service moves code between modules, and a move that
 * also edits what it moves is a change reviewed as if it were not. This
 * reads every top-level declaration and every endpoint in the content
 * service's modules as they are on the base branch and, for each that is no
 * longer in the module it was in, finds it now and compares its text -- its
 * leading comment included, `export` and whitespace normalised. Anything
 * changed or nowhere to be found is listed, and the check fails.
 *
 *   node scripts/check-move.mjs [base]        # base defaults to origin/main
 *
 * Imports are not compared (a moved module imports what it needs), nor is a
 * declaration that stayed where it was (an edit there is reviewed as an edit).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const DIR = 'tools/content-node';
const base = process.argv[2] ?? 'origin/main';

const isModule = (name) => name.endsWith('.ts') && !/\.(spec|d)\.ts$/.test(name);
const atBase = execFileSync('git', ['ls-tree', '--name-only', `${base}:${DIR}`], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(isModule);
const now = readdirSync(DIR).filter(isModule);

/** Whitespace collapsed, `export ` dropped: what a move may not change. */
const normal = (text) =>
  text
    .replace(/^\s*export\s+(?!\*)/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A module's top-level declarations by name, and its endpoints by method and path. */
function pieces(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const declarations = new Map();
  const endpoints = new Map();
  const add = (map, key, node) => {
    const list = map.get(key) ?? [];
    list.push(normal(node.getFullText(sf)));
    map.set(key, list);
  };
  const endpointsIn = (list) => {
    for (const element of list.elements) {
      let route = '?';
      let method = 'get';
      const find = (node) => {
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
          if (node.name.text === 'path' && route === '?') route = node.initializer.getText(sf);
          if (node.name.text === 'method') method = node.initializer.getText(sf);
        }
        ts.forEachChild(node, find);
      };
      find(element);
      add(endpoints, `${method} ${route}`, element);
    }
  };
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const initializer = declaration.initializer;
        // An endpoint list is compared endpoint by endpoint: moving one out
        // of a list changes the list, not the endpoint.
        if (
          initializer &&
          ts.isArrayLiteralExpression(initializer) &&
          /endpoints$/i.test(declaration.name.text)
        )
          endpointsIn(initializer);
        else add(declarations, declaration.name.text, statement);
      }
    } else if ('name' in statement && statement.name && ts.isIdentifier(statement.name)) {
      add(declarations, statement.name.text, statement);
    }
  }
  return { declarations, endpoints };
}

const read = (file, fromBase) =>
  fromBase
    ? execFileSync('git', ['show', `${base}:${DIR}/${file}`], {
        encoding: 'utf8',
        maxBuffer: 1 << 26,
      })
    : readFileSync(path.join(DIR, file), 'utf8');

const before = new Map(atBase.map((file) => [file, pieces(file, read(file, true))]));
const after = new Map(now.map((file) => [file, pieces(file, read(file, false))]));

const problems = [];
let moved = { declarations: 0, endpoints: 0 };
for (const kind of ['declarations', 'endpoints']) {
  for (const [file, { [kind]: was }] of before) {
    for (const [key, texts] of was) {
      // Still where it was: not a move.
      if (after.get(file)?.[kind].has(key)) continue;
      for (const text of texts) {
        const elsewhere = [...after].filter(([, p]) => p[kind].has(key));
        if (!elsewhere.length) {
          problems.push(`missing: ${key} (in ${file} at ${base}, nowhere now)`);
          continue;
        }
        moved[kind] += 1;
        if (!elsewhere.some(([, p]) => p[kind].get(key).includes(text)))
          problems.push(
            `changed: ${key} (now in ${elsewhere.map(([f]) => f).join(', ')}) differs from ${file} at ${base}`
          );
      }
    }
  }
}

console.log(
  `moved ${moved.declarations} declarations and ${moved.endpoints} endpoints, ` +
    `${problems.filter((p) => p.startsWith('changed')).length} changed; ` +
    `${problems.filter((p) => p.startsWith('missing')).length} missing`
);
for (const problem of problems) console.log(`  ${problem}`);
process.exit(problems.length ? 1 : 0);
