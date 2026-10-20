#!/usr/bin/env node
/**
 * Shows that a move is a move (spec 014, research R6).
 *
 * Splitting the content service moves code between modules, and a move that
 * also edits what it moves is a change reviewed as if it were not. This
 * reads every top-level statement and every endpoint in the content
 * service's modules as they are on the base branch and, for each that is no
 * longer in the module it was in, finds it now and compares it token for
 * token: strings, templates, regular expressions and comments exactly, only
 * the whitespace between tokens and a leading `export` set aside.
 *
 * What a moved declaration means can change without its text changing, so
 * two more things fail:
 *  - added: a declaration in a module that received moved code that was in
 *    none of the base branch's modules -- a new `javaTrim` beside a moved
 *    caller would quietly replace the one it called;
 *  - rebound: a name a moved declaration imports from a module whose
 *    declaration of it is not the one the base branch's module had.
 *
 *   node scripts/check-move.mjs [base]        # base defaults to origin/main
 *
 * Not compared: a statement that stayed where it was (an edit there is
 * reviewed as an edit) and import statements themselves (a moved module
 * imports what it needs; what each imported name resolves to is checked).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const DIR = 'tools/content-node';
const base = process.argv[2] ?? 'origin/main';

execFileSync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
const isModule = (name) => name.endsWith('.ts') && !/\.(spec|d)\.ts$/.test(name);
const atBase = execFileSync('git', ['ls-tree', '--name-only', `${base}:${DIR}`], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(isModule);
const now = readdirSync(DIR).filter(isModule);

/**
 * A node as a move may not change it: its tokens, literals exactly, the
 * comments inside it exactly (trailing spaces aside), and the comments
 * attached above it -- those after the last blank line before it, not a
 * module header and not the previous line's trailing comment.
 */
function canonical(sf, node) {
  const text = sf.text;
  const out = [];
  const comment = (range) => {
    out.push(
      text
        .slice(range.pos, range.end)
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
    );
  };
  // Leading comments attached to the statement.
  const leading = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  let attached = [];
  for (const range of leading) {
    const before = text.slice(
      attached.length ? attached[attached.length - 1].end : node.getFullStart(),
      range.pos
    );
    // A comment on the line the previous statement ends on is that statement's.
    if (!attached.length && !before.includes('\n') && node.getFullStart() > 0) continue;
    // A blank line between comments detaches those above it.
    if (/\n[ \t]*\n/.test(before)) attached = [];
    attached.push(range);
  }
  if (
    attached.length &&
    /\n[ \t]*\n/.test(text.slice(attached[attached.length - 1].end, node.getStart(sf)))
  )
    attached = [];
  attached.forEach(comment);
  // Tokens, with the comments between them.
  let first = true;
  const walk = (child) => {
    // Its doc comment is among the attached comments already; `export` on
    // the statement itself is the module boundary, not the code.
    if (child.kind === ts.SyntaxKind.JSDoc) return;
    if (
      child.kind === ts.SyntaxKind.ExportKeyword &&
      (child.parent === node || child.parent?.parent === node)
    )
      return;
    if (child.getChildCount(sf) === 0) {
      if (child.kind === ts.SyntaxKind.EndOfFileToken) return;
      if (!first)
        for (const range of ts.getLeadingCommentRanges(text, child.getFullStart()) ?? [])
          comment(range);
      first = false;
      out.push(child.getText(sf));
      return;
    }
    for (const grandchild of child.getChildren(sf)) walk(grandchild);
  };
  walk(node);
  return out.join(' ');
}

/** The array literal an endpoint list is, through `satisfies`, `as` or parentheses. */
function arrayOf(expression) {
  let e = expression;
  while (
    e &&
    (ts.isSatisfiesExpression(e) || ts.isAsExpression(e) || ts.isParenthesizedExpression(e))
  )
    e = e.expression;
  return e && ts.isArrayLiteralExpression(e) ? e : undefined;
}

/** A module's top-level statements by key, its endpoints by method and path, and its imports. */
function pieces(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const declarations = new Map();
  const endpoints = new Map();
  const imports = new Map(); // local name -> [module, imported name]
  const add = (map, key, node) => {
    const list = map.get(key) ?? [];
    list.push(canonical(sf, node));
    map.set(key, list);
  };
  const endpointsIn = (list) => {
    for (const element of list.elements) {
      let route = '?';
      let method = 'get';
      // The endpoint's own properties: a `method` deeper inside it is not its method.
      const own = ts.isObjectLiteralExpression(element) ? element.properties : [];
      for (const property of own) {
        if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
        if (property.name.text === 'path') route = property.initializer.getText(sf);
        if (property.name.text === 'method') method = property.initializer.getText(sf);
      }
      // A generated endpoint (a spread) is keyed by the first path it names.
      if (route === '?') {
        const find = (node) => {
          if (route !== '?') return;
          if (
            ts.isPropertyAssignment(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === 'path'
          )
            route = node.initializer.getText(sf);
          else ts.forEachChild(node, find);
        };
        find(element);
      }
      add(endpoints, `${method} ${route}`, element);
    }
  };
  let unnamed = 0;
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const from = statement.moduleSpecifier.text.replace(/^\.\//, '').replace(/\.(ts|mjs)$/, '');
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          imports.set(element.name.text, [from, (element.propertyName ?? element.name).text]);
      continue;
    }
    if (ts.isExportDeclaration(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const list = arrayOf(declaration.initializer);
        if (ts.isIdentifier(declaration.name) && list && /endpoints$/i.test(declaration.name.text))
          endpointsIn(list);
        else if (ts.isIdentifier(declaration.name))
          add(declarations, declaration.name.text, statement);
        else add(declarations, `(destructuring) ${declaration.name.getText(sf)}`, statement);
      }
    } else if ('name' in statement && statement.name && ts.isIdentifier(statement.name)) {
      add(declarations, statement.name.text, statement);
    } else {
      unnamed += 1;
      add(
        declarations,
        `(statement ${unnamed}: ${statement.getText(sf).slice(0, 40).replace(/\s+/g, ' ')})`,
        statement
      );
    }
  }
  return { declarations, endpoints, imports };
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
const moved = { declarations: 0, endpoints: 0 };
const receivers = new Set();
/** Where each moved declaration came from, for checking what its imports resolve to. */
const origins = new Map(); // `${file}#${name}` now -> base file
for (const kind of ['declarations', 'endpoints']) {
  for (const [file, { [kind]: was }] of before) {
    for (const [key, texts] of was) {
      if (after.get(file)?.[kind].has(key)) continue; // still where it was: not a move
      for (const text of texts) {
        const elsewhere = [...after].filter(([, p]) => p[kind].has(key));
        if (!elsewhere.length) {
          problems.push(`missing: ${key} (in ${file} at ${base}, nowhere now)`);
          continue;
        }
        moved[kind] += 1;
        const same = elsewhere.filter(([, p]) => p[kind].get(key).includes(text));
        for (const [to] of same.length ? same : elsewhere) {
          receivers.add(to);
          origins.set(`${to}#${key}`, file);
        }
        if (!same.length)
          problems.push(
            `changed: ${key} (now in ${elsewhere.map(([f]) => f).join(', ')}) differs from ${file} at ${base}`
          );
      }
    }
  }
}

// Declarations that appeared in a module that received moved code: neither
// there at the base nor moved in.
for (const file of receivers) {
  const there = before.get(file)?.declarations;
  for (const key of after.get(file).declarations.keys())
    if (!there?.has(key) && !origins.has(`${file}#${key}`))
      problems.push(`added: ${key} (in ${file}: not there at ${base}, nor moved in)`);
}

// A name a receiving module imports must resolve to the declaration the
// moved code's original module used: its own (it was a local there), or the
// same import.
for (const file of receivers) {
  const { imports } = after.get(file);
  const fromFiles = new Set(
    [...origins].filter(([k]) => k.startsWith(`${file}#`)).map(([, f]) => f)
  );
  for (const [local, [module, name]] of imports) {
    const target = after.get(`${module}.ts`)?.declarations.get(name);
    for (const origin of fromFiles) {
      const was = before.get(origin);
      const theirs = was.declarations.get(local);
      const importedThere = was.imports.get(local);
      if (theirs && target && !theirs.some((text) => target.includes(text)))
        problems.push(
          `rebound: ${local} in ${file} is ${module}.ts's, not the one ${origin} had at ${base}`
        );
      else if (!theirs && importedThere && importedThere.join('/') !== [module, name].join('/')) {
        // Imported in both: from the same module, or from where that module's moved to.
        const original = before.get(`${importedThere[0]}.ts`)?.declarations.get(importedThere[1]);
        if (!original || !target || !original.some((text) => target.includes(text)))
          problems.push(
            `rebound: ${local} in ${file} now from ${module}.ts, at ${base} from ${importedThere[0]}.ts`
          );
      }
    }
  }
}

const count = (prefix) => problems.filter((p) => p.startsWith(prefix)).length;
console.log(
  `moved ${moved.declarations} declarations and ${moved.endpoints} endpoints, ` +
    `${count('changed')} changed; ${count('missing')} missing; ${count('added')} added; ${count('rebound')} rebound`
);
for (const problem of problems) console.log(`  ${problem}`);
process.exit(problems.length ? 1 : 0);
