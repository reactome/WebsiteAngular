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
      at += /^[A-Za-z_$][\w$]*$/.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
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
  const problems = [];
  for (const d of ts.getPreEmitDiagnostics(program)) {
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
    const sourceFile = program.getSourceFile(d.file.fileName);
    const declaration = sourceFile.statements.find(ts.isVariableStatement)?.declarationList
      .declarations[0];
    const initializer = declaration?.initializer;
    const at =
      initializer && d.start !== undefined && d.start >= initializer.getStart()
        ? jsonPath(initializer, d.start)
        : '$';
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
