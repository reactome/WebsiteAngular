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
 *    declaration of it is not the one the base branch's module had; or any
 *    name a moved declaration uses that is bound to something else where it
 *    is now -- a receiving module's own declaration of that name, or a
 *    global where the original had a declaration or an import.
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
      // A comment after a token on its own line is TypeScript's "trailing"
      // comment, which the next token's leading comments leave out.
      for (const range of ts.getTrailingCommentRanges(text, child.getEnd()) ?? []) comment(range);
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
  const imports = new Map(); // local name -> [specifier, imported name: a name, 'default' or '*']
  const effects = []; // specifiers imported for their side effects
  const reexports = new Map(); // exported name -> [specifier, name there]
  const stars = []; // specifiers of `export * from`
  const uses = new Map(); // declaration or endpoint key -> the names it uses
  // Endpoint lists by name, each what it holds in order: an endpoint's key,
  // or `...name` for a list spread into it, which listIdentity follows to the
  // list that name is bound to. The endpoints themselves are compared one by
  // one; this is what makes `endpoints` in the registry the list service.ts
  // declared, and a reordered, shortened or shadowing list, or one spread
  // under another list's name (`import { a as b }`), a different one.
  const lists = new Map();
  const add = (map, key, node) => {
    const list = map.get(key) ?? [];
    list.push(canonical(sf, node));
    map.set(key, list);
    const used = uses.get(key) ?? new Set();
    for (const name of namesUsed(node)) used.add(name);
    uses.set(key, used);
  };
  const endpointsIn = (list) => {
    const held = [];
    for (const element of list.elements) {
      // A family's own list spread into another (`...citationEndpoints`) is
      // no endpoint: its endpoints are read where that list is declared.
      // Whether a family is spread in at all is not this check's: the
      // route-order test (registry.spec) and the parameter record
      // (parameters.spec) fail on one missing or spread twice.
      if (ts.isSpreadElement(element) && ts.isIdentifier(element.expression)) {
        held.push(`...${element.expression.text}`);
        continue;
      }
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
      // The endpoint itself, not only its key: a list from a decoy module
      // with the same paths and other handlers is another list.
      held.push(`${method} ${route} ${canonical(sf, element)}`);
    }
    return held;
  };
  let unnamed = 0;
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const from = specifier(statement.moduleSpecifier.text);
      const clause = statement.importClause;
      if (!clause) effects.push(from);
      if (clause?.name) imports.set(clause.name.text, [from, 'default']);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) imports.set(bindings.name.text, [from, '*']);
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          imports.set(element.name.text, [from, (element.propertyName ?? element.name).text]);
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      if (statement.moduleSpecifier) {
        const from = specifier(statement.moduleSpecifier.text);
        const clause = statement.exportClause;
        if (!clause) stars.push(from);
        else if (ts.isNamedExports(clause))
          for (const element of clause.elements)
            reexports.set(element.name.text, [from, (element.propertyName ?? element.name).text]);
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const list = arrayOf(declaration.initializer);
        if (
          ts.isIdentifier(declaration.name) &&
          list &&
          /endpoints$/i.test(declaration.name.text)
        ) {
          lists.set(declaration.name.text, endpointsIn(list));
        } else if (ts.isIdentifier(declaration.name))
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
  return { declarations, endpoints, imports, effects, reexports, stars, uses, lists };
}

/**
 * The names a node refers to from outside itself: every identifier but a
 * property's name after a dot, a key in an object or class, and any name
 * the node declares within it (a local, a parameter: those bind the same
 * wherever the node is). The node's own name is left to the caller.
 */
function namesUsed(node) {
  const names = new Set();
  const declared = new Set();
  const visit = (n) => {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isNameOf =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isQualifiedName(p) && p.right === n) ||
        ((ts.isPropertyAssignment(p) ||
          ts.isMethodDeclaration(p) ||
          ts.isPropertyDeclaration(p) ||
          ts.isPropertySignature(p) ||
          ts.isMethodSignature(p) ||
          ts.isGetAccessorDeclaration(p) ||
          ts.isSetAccessorDeclaration(p) ||
          ts.isEnumMember(p)) &&
          p.name === n) ||
        (ts.isBindingElement(p) && p.propertyName === n) ||
        ((ts.isVariableDeclaration(p) ||
          ts.isParameter(p) ||
          ts.isFunctionDeclaration(p) ||
          ts.isClassDeclaration(p) ||
          ts.isInterfaceDeclaration(p) ||
          ts.isTypeAliasDeclaration(p) ||
          ts.isBindingElement(p)) &&
          p.name === n);
      if (!isNameOf) names.add(n.text);
      else if (
        n !== node.name &&
        (ts.isVariableDeclaration(p) ||
          ts.isParameter(p) ||
          ts.isFunctionDeclaration(p) ||
          ts.isClassDeclaration(p) ||
          ts.isBindingElement(p))
      )
        declared.add(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  // A top-level `const x = …` declares its own name, which is no local.
  if (ts.isVariableStatement(node))
    for (const d of node.declarationList.declarations)
      if (ts.isIdentifier(d.name)) declared.delete(d.name.text);
  return [...names].filter((name) => !declared.has(name));
}

/**
 * An endpoint list as what it holds, every spread followed to the list its
 * name is bound to -- declared in the module, or imported (through
 * re-exports) from another -- and expanded: the endpoints' keys in order.
 * A name that cannot be followed is kept as written.
 */
function listIdentity(modules, file, name, seen = new Set()) {
  const held = modules.get(file)?.lists.get(name) ?? [];
  return `endpoint list ${name}: ${expand(modules, file, held, seen).join(', ')}`;
}

function expand(modules, file, held, seen) {
  return held.flatMap((item) => {
    if (!item.startsWith('...')) return [item];
    const found = spreadList(modules, file, item.slice(3), seen);
    return found ?? [item];
  });
}

/** The keys a list spread as `name` in `file` holds, or undefined. */
function spreadList(modules, file, name, seen) {
  const key = `${file}#${name}`;
  // A list that spreads itself, however indirectly, is no list to follow.
  if (seen.has(key)) return undefined;
  const path = new Set(seen).add(key);
  const module = modules.get(file);
  if (module?.lists.has(name)) return expand(modules, file, module.lists.get(name), path);
  const from = module?.imports.get(name) ?? module?.reexports.get(name);
  if (from?.[0].startsWith('local:'))
    return spreadList(modules, `${from[0].slice(6)}.ts`, from[1], path);
  // From outside the service: known by where it comes from, as identity() knows one.
  if (from) return [`...${from[0]}#${from[1]}`];
  for (const star of module?.stars ?? [])
    if (star.startsWith('local:')) {
      const found = spreadList(modules, `${star.slice(6)}.ts`, name, path);
      if (found) return found;
    }
  return undefined;
}

/**
 * What a name is bound to at the top of a module: its declaration there,
 * what it imports (followed to a declaration), or a global.
 */
function bindingOf(modules, file, name) {
  const module = modules.get(file);
  if (module?.declarations.has(name))
    return `declared: ${module.declarations.get(name).join('\n')}`;
  if (module?.lists.has(name)) return `declared: ${listIdentity(modules, file, name)}`;
  if (module?.imports.has(name))
    return `imported: ${identity(modules, ...module.imports.get(name))}`;
  return 'global';
}

/**
 * An import specifier as one string: a module of this service by its name
 * (`local:answers`), anything else as written (`neo4j-driver`, `node:fs`,
 * `../render/params.ts`).
 */
function specifier(text) {
  const local = /^\.\/([\w-]+)(?:\.(?:ts|mjs|js))?$/.exec(text);
  return local ? `local:${local[1]}` : text;
}

/**
 * What `name` exported by a module is: the canonical text of its
 * declaration, following re-exports through this service's modules, or a
 * package's name and specifier. Undefined when it cannot be followed.
 */
function identity(modules, spec, name, seen = new Set()) {
  if (!spec.startsWith('local:')) return `${spec}#${name}`;
  const key = `${spec}#${name}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  const module = modules.get(`${spec.slice(6)}.ts`);
  if (!module) return undefined;
  const declared = module.declarations.get(name);
  if (declared) return declared.join('\n');
  if (module.lists.has(name)) return listIdentity(modules, `${spec.slice(6)}.ts`, name);
  const again = module.reexports.get(name) ?? module.imports.get(name);
  if (again) return identity(modules, again[0], again[1], seen);
  for (const star of module.stars) {
    const found = identity(modules, star, name, seen);
    if (found) return found;
  }
  return undefined;
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

// A module that is new, or that holds an endpoint list, is checked as one
// that received moved code even when no declaration moved into it: the
// registry assembles the lists and declares little else, so a statement
// added there (`aEndpoints.push(…)`) or an import it gained was never read.
for (const [file, now] of after) if (!before.has(file) || now.lists.size) receivers.add(file);

// Declarations that appeared in a module that received moved code: neither
// there at the base nor moved in.
for (const file of receivers) {
  for (const kind of ['declarations', 'endpoints']) {
    const there = before.get(file)?.[kind];
    for (const key of after.get(file)[kind].keys())
      if (!there?.has(key) && !origins.has(`${file}#${key}`))
        problems.push(`added: ${key} (in ${file}: not there at ${base}, nor moved in)`);
  }
}

// Every name a receiving module imports must be one the moved code's
// original module had -- declared there, or imported -- and resolve to the
// same thing: the same declaration (wherever it now lives, followed through
// re-exports) or the same package's export. A name the original did not have
// would shadow a global (`fetch`) or bring in something new. Side-effect
// imports likewise. Imports the receiving module already had at the base are
// its own.
for (const file of receivers) {
  const now = after.get(file);
  const had = before.get(file);
  const fromFiles = new Set(
    [...origins].filter(([k]) => k.startsWith(`${file}#`)).map(([, f]) => f)
  );
  // Its own base counts too: service.ts importing javaTrim back from where
  // its declaration moved is the javaTrim it had.
  if (had) fromFiles.add(file);
  const originsOf = [...fromFiles].map((f) => [f, before.get(f)]);
  for (const [local, [spec, name]] of now.imports) {
    const actual = identity(after, spec, name);
    // A list this module spreads into its own is checked through that list:
    // its identity is what the spread holds -- endpoint by endpoint, or where
    // it comes from outside the service -- wherever the list is used.
    if ([...now.lists.values()].some((held) => held.includes(`...${local}`))) continue;
    if (had?.imports.has(local) && identity(before, ...had.imports.get(local)) === actual) continue;
    const expected = originsOf
      .map(([f, was]) => {
        if (was.declarations.has(local)) return [f, was.declarations.get(local).join('\n')];
        if (was.lists.has(local)) return [f, listIdentity(before, f, local)];
        if (was.imports.has(local)) return [f, identity(before, ...was.imports.get(local))];
        return undefined;
      })
      .filter(Boolean);
    if (!expected.length) {
      problems.push(
        `rebound: ${local} in ${file} is imported, but ${[...fromFiles].join(', ')} had no ${local} at ${base} (a global, or something new)`
      );
      continue;
    }
    if (actual === undefined) {
      problems.push(`rebound: ${local} in ${file} cannot be followed to a declaration (${spec})`);
      continue;
    }
    for (const [f, was] of expected)
      if (was !== actual)
        problems.push(`rebound: ${local} in ${file} is not the ${local} ${f} had at ${base}`);
  }
  for (const spec of now.effects)
    if (!had?.effects.includes(spec) && !originsOf.some(([, was]) => was.effects.includes(spec)))
      problems.push(
        `added: import '${spec}' in ${file} (no original module imported it for its effects)`
      );
}

// Every name a declaration or endpoint uses must be bound now as it was:
// a moved one's, as in the module it came from -- a receiving module's own
// `javaTrim` would quietly replace the one a moved caller called, and a
// helper left behind unimported would fall through to a global of the same
// name (`close`) -- and one that stayed, as where it is, so its caller is
// not pointed at another module's `javaTrim` in the same change.
const stayed = [];
for (const [file, was] of before)
  for (const kind of ['declarations', 'endpoints'])
    for (const key of was[kind].keys())
      if (after.get(file)?.[kind].has(key)) stayed.push([`${file}#${key}`, file]);
for (const [where, from] of [...origins, ...stayed]) {
  const at = where.indexOf('#');
  const to = where.slice(0, at);
  const key = where.slice(at + 1);
  const kind = before.get(from).declarations.has(key) ? 'declarations' : 'endpoints';
  for (const name of after.get(to).uses.get(key) ?? []) {
    const was = bindingOf(before, from, name);
    const is = bindingOf(after, to, name);
    if (was === is) continue;
    // What it imported may have moved too: the same declaration, now here.
    if (was.startsWith('imported: ') && is === `declared: ${was.slice(10)}`) continue;
    if (was.startsWith('declared: ') && is === `imported: ${was.slice(10)}`) continue;
    if (kind === 'declarations' && name === key) continue; // its own name
    problems.push(
      `rebound: ${name}, used by ${key} in ${to}, is ${is.split(':')[0]} there; in ${from} at ${base} it was ${was.split(':')[0]}${was.split(':')[0] === is.split(':')[0] ? ' as something else' : ''}`
    );
  }
}

const count = (prefix) => problems.filter((p) => p.startsWith(prefix)).length;
console.log(
  `moved ${moved.declarations} declarations and ${moved.endpoints} endpoints, ` +
    `${count('changed')} changed; ${count('missing')} missing; ${count('added')} added; ${count('rebound')} rebound`
);
for (const problem of problems) console.log(`  ${problem}`);
process.exit(problems.length ? 1 : 0);
