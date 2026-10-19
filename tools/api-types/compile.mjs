/**
 * Compile real answers as values of the types the site reads them as (spec
 * 012, research R3; first written for the AnalysisService in #540).
 *
 * Each answer becomes a virtual file `const answer: <type> = <body>`, compiled
 * with the project's own compiler options, so a field the type does not
 * declare, a field it requires that the answer lacks, or a value of the wrong
 * kind is a compile error. A wrong-kind message does not say where ("Type
 * 'string' is not assignable to type 'number'"), and an answer can be a
 * megabyte: each problem carries the JSON path of the value it points at.
 */
import path from 'node:path';
import ts from 'typescript';

export const ROOT = path.join(import.meta.dirname, '..', '..');

let options;
function compilerOptions() {
  if (options) return options;
  const config = ts.getParsedCommandLineOfConfigFile(
    path.join(ROOT, 'tsconfig.json'),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} }
  );
  options = {
    ...config.options,
    noEmit: true,
    allowJs: false,
    skipLibCheck: true,
    // An answer read as `string[]` leaves its imports unused, which says
    // nothing about the answer.
    noUnusedLocals: false,
    // The types need no ambient declarations; loading them all only slows
    // each program.
    types: [],
  };
  return options;
}

/**
 * The JSON path, from the answer's root, of the innermost value containing
 * `position` in the answer's initializer.
 */
function jsonPath(initializer, position) {
  let node = initializer;
  let at = '$';
  for (;;) {
    if (ts.isObjectLiteralExpression(node)) {
      const property = node.properties.find((p) => p.pos <= position && position < p.end);
      if (!property || !ts.isPropertyAssignment(property)) return at;
      const name = ts.isStringLiteral(property.name) ? property.name.text : property.name.getText();
      at = step(at, name);
      // A message on the key itself (a missing or undeclared field) is about
      // this property; one inside the value goes on down.
      if (position < property.initializer.getStart()) return at;
      node = property.initializer;
    } else if (ts.isArrayLiteralExpression(node)) {
      const index = node.elements.findIndex((e) => e.pos <= position && position < e.end);
      if (index === -1) return at;
      at += `[${index}]`;
      node = node.elements[index];
    } else if (ts.isPrefixUnaryExpression(node) || ts.isParenthesizedExpression(node)) {
      return at;
    } else return at;
  }
}

/** The answer's value: the initializer of the file's one declaration. */
const initializerOf = (sourceFile) =>
  sourceFile?.statements.find(ts.isVariableStatement)?.declarationList.declarations[0]?.initializer;

/**
 * The compiler's codes for a field left out or not declared, which it reports
 * once per object literal, the first it meets: the rest of the object's
 * fields go unsaid, and an extra field hides a missing one. Counted that way,
 * a type could fit its answers worse and the count stay the same.
 */
const FIELD_CODES = new Set([2353, 2561, 2739, 2740, 2741]);

/** Whether the deepest message of a diagnostic is about a missing or extra field. */
function endsInField(d) {
  let chain = d.messageText;
  if (typeof chain === 'string') return false;
  while (chain.next?.length) chain = chain.next[0];
  return FIELD_CODES.has(chain.code);
}

/**
 * Every field each object in the answer has that its type does not declare,
 * and every field its type requires that it lacks, by JSON path. An object
 * whose type is a union is left to the compiler; one whose type allows any
 * field is checked only for the fields it requires.
 */
function fieldProblems(checker, initializer) {
  const found = [];
  const walk = (node, at) => {
    if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach((e, i) => walk(e, `${at}[${i}]`));
      return;
    }
    if (!ts.isObjectLiteralExpression(node)) return;
    const contextual = checker.getContextualType(node);
    const type = contextual && checker.getNonNullableType(contextual);
    const names = new Map();
    for (const p of node.properties)
      if (ts.isPropertyAssignment(p)) {
        const name = ts.isStringLiteral(p.name) ? p.name.text : p.name.getText();
        names.set(name, p);
      }
    const checkable =
      type && !type.isUnion() && !(type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown));
    if (checkable) {
      const shown = checker.typeToString(type);
      const declared = new Map(checker.getPropertiesOfType(type).map((s) => [s.name, s]));
      // A type that allows any field (an index signature) still requires the
      // ones it names: only the check for extra fields is off.
      const open = checker.getIndexInfosOfType(type).length > 0;
      for (const name of names.keys())
        if (!open && !declared.has(name))
          found.push({
            path: step(at, name),
            message: `Property '${name}' does not exist in type '${shown}'.`,
          });
      for (const [name, symbol] of declared)
        if (!names.has(name) && !(symbol.flags & ts.SymbolFlags.Optional))
          found.push({ path: at, message: `Property '${name}' is missing in type '${shown}'.` });
    }
    for (const [name, p] of names) walk(p.initializer, step(at, name));
  };
  walk(initializer, '$');
  return found;
}

const step = (at, name) =>
  /^[A-Za-z_$][\w$]*$/.test(name) ? `${at}.${name}` : `${at}[${JSON.stringify(name)}]`;

/**
 * Compile `answers` ({key, route, source, type, body}) with `header` (the
 * import lines their types need) at the top of each. Returns the problems:
 * {route, source, key, path, message}, sorted; a diagnostic outside the
 * answers (a broken type file) comes back with route 'elsewhere'.
 */
export function compileAnswers(answers, header) {
  const opts = compilerOptions();
  const prefix = `${header}\nexport const answer: `;
  const files = new Map();
  for (const a of answers)
    files.set(path.join(ROOT, `answer-${a.key}.ts`), {
      answer: a,
      text: `${prefix}${a.type} = ${a.body};\n`,
    });
  const host = ts.createCompilerHost(opts);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  const source = host.getSourceFile.bind(host);
  host.readFile = (f) => files.get(f)?.text ?? read(f);
  host.fileExists = (f) => files.has(f) || exists(f);
  host.getSourceFile = (f, language, ...rest) =>
    files.has(f)
      ? ts.createSourceFile(f, files.get(f).text, language, true)
      : source(f, language, ...rest);
  const program = ts.createProgram([...files.keys()], opts, host);
  const checker = program.getTypeChecker();
  const problems = [];
  const walked = new Set();
  for (const [fileName, file] of files) {
    const initializer = initializerOf(program.getSourceFile(fileName));
    const { route, source: from, key } = file.answer;
    if (initializer)
      for (const { path: at, message } of fieldProblems(checker, initializer)) {
        problems.push({ route, source: from ?? '', key, path: at, message });
        walked.add(`${fileName} ${at}`);
      }
  }
  for (const d of ts.getPreEmitDiagnostics(program)) {
    // Fields left out or not declared are found, all of them, by
    // fieldProblems; the compiler reports only the first of each object.
    if (FIELD_CODES.has(d.code) && d.file && files.has(d.file.fileName)) continue;
    const message = ts.flattenDiagnosticMessageText(d.messageText, ' ');
    const file = d.file && files.get(d.file.fileName);
    if (!file) {
      problems.push({
        route: 'elsewhere',
        source: d.file?.fileName ?? '',
        key: '',
        path: '',
        message,
      });
      continue;
    }
    const initializer = initializerOf(program.getSourceFile(d.file.fileName));
    const at =
      initializer && d.start !== undefined && d.start >= initializer.getStart()
        ? jsonPath(initializer, d.start)
        : '$';
    // The same missing or extra field again, wrapped in "not assignable" (an
    // intersection type reports it so); kept where fieldProblems found
    // nothing there, as for a union, which it leaves to the compiler.
    if (endsInField(d) && walked.has(`${d.file.fileName} ${at}`)) continue;
    const { route, source: from, key } = file.answer;
    problems.push({ route, source: from ?? '', key, path: at, message });
  }
  return problems.sort((a, b) =>
    `${a.route} ${a.key} ${a.path} ${a.message}`.localeCompare(
      `${b.route} ${b.key} ${b.path} ${b.message}`
    )
  );
}

/** One line per problem, as the checks report them (contracts/check-output.md). */
export const describe = (p) =>
  p.route === 'elsewhere'
    ? `elsewhere: ${p.source}: ${p.message}`
    : `${p.route} [${p.source}]: ${p.path}: ${p.message}`;
