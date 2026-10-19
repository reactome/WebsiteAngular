// @vitest-environment node
//
// The site's analysis types against what the AnalysisService really answers
// (spec 010 Story 5). Every answer the end-to-end recordings hold is compiled
// as a value of the type the site reads it as, so a field the type does not
// declare, a field it requires that an answer lacks, or a value of the wrong
// kind is a compile error here rather than a guess in the code that reads it.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(import.meta.dirname, '..', '..');
const HARS = path.join(ROOT, 'e2e', 'har');
const RECORDED = path.join(import.meta.dirname, 'recorded');
const MODEL = path.join(ROOT, 'projects/pathway-browser/src/app/model/analysis.model');

/**
 * What the site reads each answer as, by method and path: the type each call
 * in projects/pathway-browser's analysis.service.ts names.
 */
const READ_AS = [
  ['POST', /^\/AnalysisService\/identifiers\/(projection|url(\/projection)?)?$/, 'Analysis.Result'],
  ['GET', /^\/AnalysisService\/species\/homoSapiens\/\d+$/, 'Analysis.Result'],
  ['GET', /^\/AnalysisService\/token\/[^/]+$/, 'Analysis.Result'],
  ['GET', /^\/AnalysisService\/token\/[^/]+\/found\/all\/[^/]+$/, 'Analysis.FoundEntities'],
  ['POST', /^\/AnalysisService\/token\/[^/]+\/filter\/pathways$/, 'Analysis.Pathway[]'],
  ['GET', /^\/AnalysisService\/token\/[^/]+\/reactions\/[^/]+$/, 'number[]'],
  ['GET', /^\/AnalysisService\/token\/[^/]+\/notFound$/, 'Analysis.NotFoundIdentifier[]'],
];

/** Each distinct recorded answer with the type it is read as. */
function recordedAnswers(dir = HARS) {
  const answers = new Map();
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.har'))) {
    for (const { request, response } of JSON.parse(readFileSync(path.join(dir, name), 'utf8')).log
      .entries) {
      const file = response.content?._file;
      if (response.status !== 200 || !file) continue;
      const route = new URL(request.url, 'http://x').pathname;
      const kind = READ_AS.find(
        ([method, pattern]) => method === request.method && pattern.test(route)
      );
      if (!kind) continue;
      const body = readFileSync(path.join(dir, file), 'utf8');
      const key = createHash('sha1').update(kind[2]).update(body).digest('hex').slice(0, 10);
      answers.set(key, { key, route: `${request.method} ${route}`, type: kind[2], body });
    }
  }
  // The kinds of analysis the recordings never run, recorded by record.mjs.
  for (const name of readdirSync(RECORDED).filter((f) => f.endsWith('.json'))) {
    for (const { route, answer } of JSON.parse(readFileSync(path.join(RECORDED, name), 'utf8'))) {
      const [method, url] = route.split(' ');
      const pathname = new URL(url, 'http://x').pathname;
      const kind = READ_AS.find(([m, pattern]) => m === method && pattern.test(pathname));
      if (!kind) throw new Error(`${name}: nothing reads ${route}`);
      const body = JSON.stringify(answer);
      const key = createHash('sha1').update(kind[2]).update(body).digest('hex').slice(0, 10);
      answers.set(key, { key, route: `${method} ${pathname} [${name}]`, type: kind[2], body });
    }
  }
  return [...answers.values()];
}

/**
 * Compile each answer as `const answer: <type> = <body>` with the project's own
 * compiler options; the problems found, one line per answer and message.
 */
function typeProblems(answers) {
  const config = ts.getParsedCommandLineOfConfigFile(
    path.join(ROOT, 'tsconfig.json'),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} }
  );
  // An answer read as `number[]` leaves the import unused, which says nothing
  // about the answer.
  const options = {
    ...config.options,
    noEmit: true,
    allowJs: false,
    skipLibCheck: true,
    noUnusedLocals: false,
    // The model needs no ambient types; loading them all only slows each program.
    types: [],
  };
  const files = new Map(
    answers.map((a) => [
      path.join(ROOT, `recorded-${a.key}.ts`),
      `import type { Analysis } from ${JSON.stringify(MODEL)};\n` +
        `export const answer: ${a.type} = ${a.body};\n`,
    ])
  );
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  const source = host.getSourceFile.bind(host);
  host.readFile = (f) => files.get(f) ?? read(f);
  host.fileExists = (f) => files.has(f) || exists(f);
  host.getSourceFile = (f, language, ...rest) =>
    files.has(f) ? ts.createSourceFile(f, files.get(f), language) : source(f, language, ...rest);
  const program = ts.createProgram([...files.keys()], options, host);
  const byFile = new Map(answers.map((a) => [path.join(ROOT, `recorded-${a.key}.ts`), a]));
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => {
      const answer = d.file && byFile.get(d.file.fileName);
      const message = ts.flattenDiagnosticMessageText(d.messageText, ' ');
      return answer ? `${answer.route} (${answer.key}): ${message}` : `elsewhere: ${message}`;
    })
    .sort();
}

describe('the analysis model against recorded answers', () => {
  const answers = recordedAnswers();

  it('has an answer for every way the site reads one, and every kind of analysis', () => {
    const covered = new Set(answers.map((a) => a.type));
    expect(READ_AS.map(([, , type]) => type).filter((type) => !covered.has(type))).toEqual([]);
    const kinds = new Set(
      answers
        .filter((a) => a.type === 'Analysis.Result')
        .map((a) => JSON.parse(a.body).summary.type)
    );
    expect([...kinds].sort()).toEqual(['EXPRESSION', 'OVERREPRESENTATION', 'SPECIES_COMPARISON']);
  });

  it('names only analysis types the site knows', async () => {
    // `summary.type` is typed `Type | string` on purpose, so an unknown type
    // degrades rather than breaks; the compile check cannot see it, so this does.
    const { Analysis } =
      await import('../../projects/pathway-browser/src/app/model/analysis.model.ts');
    const TYPES = Analysis.TYPES;
    const unknown = answers
      .filter((a) => a.type === 'Analysis.Result')
      .map((a) => JSON.parse(a.body).summary.type)
      .filter((type) => !TYPES.includes(type));
    expect(unknown).toEqual([]);
  });

  it('describes every recorded answer exactly', () => {
    expect(typeProblems(answers)).toEqual([]);
  }, 60_000);

  it('notices an answer without a field the site reads', () => {
    const result = answers.find((a) => a.type === 'Analysis.Result');
    const body = JSON.parse(result.body);
    delete body.summary.token;
    const problems = typeProblems([{ ...result, key: 'mutated', body: JSON.stringify(body) }]);
    expect(problems.join('\n')).toMatch(/'token' is missing/);
  }, 60_000);

  it('notices a field the type does not declare', () => {
    const found = answers.find((a) => a.type === 'Analysis.FoundEntities');
    const body = { ...JSON.parse(found.body), undeclared: 1 };
    const problems = typeProblems([{ ...found, key: 'mutated', body: JSON.stringify(body) }]);
    expect(problems.join('\n')).toMatch(/undeclared\W{0,3} does not exist/);
  }, 60_000);
});
