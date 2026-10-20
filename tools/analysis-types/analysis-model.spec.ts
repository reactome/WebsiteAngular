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
import { describe, expect, it } from 'vitest';
import type { Analysis } from '../../projects/pathway-browser/src/app/model/analysis.model.ts';
import type { HarEntry } from '../api-types/answers.ts';
import {
  compileAnswers,
  describe as describeProblem,
  ROOT,
  type Answer,
} from '../api-types/compile.ts';

const HARS = path.join(ROOT, 'e2e', 'har');
const RECORDED = path.join(import.meta.dirname, 'recorded');
const MODEL = path.join(ROOT, 'projects/pathway-browser/src/app/model/analysis.model');

/**
 * What the site reads each answer as, by method and path: the type each call
 * in projects/pathway-browser's analysis.service.ts names.
 */
const READ_AS: [method: string, pattern: RegExp, type: string][] = [
  ['POST', /^\/AnalysisService\/identifiers\/(projection|url(\/projection)?)?$/, 'Analysis.Result'],
  ['GET', /^\/AnalysisService\/species\/homoSapiens\/\d+$/, 'Analysis.Result'],
  ['GET', /^\/AnalysisService\/token\/[^/]+$/, 'Analysis.Result'],
  ['GET', /^\/AnalysisService\/token\/[^/]+\/found\/all\/[^/]+$/, 'Analysis.FoundEntities'],
  ['POST', /^\/AnalysisService\/token\/[^/]+\/filter\/pathways$/, 'Analysis.Pathway[]'],
  ['GET', /^\/AnalysisService\/token\/[^/]+\/reactions\/[^/]+$/, 'number[]'],
  ['GET', /^\/AnalysisService\/token\/[^/]+\/notFound$/, 'Analysis.NotFoundIdentifier[]'],
];

/** Each distinct recorded answer with the type it is read as. */
function recordedAnswers(dir = HARS): Answer[] {
  const answers = new Map<string, Answer>();
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.har'))) {
    const har = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as {
      log: { entries: HarEntry[] };
    };
    for (const { request, response } of har.log.entries) {
      const file = response.content?._file;
      if (response.status !== 200 || !file) continue;
      const route = new URL(request.url, 'http://x').pathname;
      const kind = READ_AS.find(
        ([method, pattern]) => method === request.method && pattern.test(route)
      );
      if (!kind) continue;
      const body = readFileSync(path.join(dir, file), 'utf8');
      const key = createHash('sha1').update(kind[2]).update(body).digest('hex').slice(0, 10);
      answers.set(key, {
        key,
        route: `${request.method} ${route}`,
        source: name,
        type: kind[2],
        body,
      });
    }
  }
  // The kinds of analysis the recordings never run, recorded by record.ts.
  for (const name of readdirSync(RECORDED).filter((f) => f.endsWith('.json'))) {
    const recorded = JSON.parse(readFileSync(path.join(RECORDED, name), 'utf8')) as {
      route: string;
      answer: unknown;
    }[];
    for (const { route, answer } of recorded) {
      const [method, url] = route.split(' ');
      if (!method || !url) throw new Error(`${name}: "${route}" is not "<method> <url>"`);
      const pathname = new URL(url, 'http://x').pathname;
      const kind = READ_AS.find(([m, pattern]) => m === method && pattern.test(pathname));
      if (!kind) throw new Error(`${name}: nothing reads ${route}`);
      const body = JSON.stringify(answer);
      const key = createHash('sha1').update(kind[2]).update(body).digest('hex').slice(0, 10);
      answers.set(key, { key, route: `${method} ${pathname}`, source: name, type: kind[2], body });
    }
  }
  return [...answers.values()];
}

/** The problems found compiling `answers`, one line each, with where. */
const typeProblems = (answers: Answer[]) =>
  compileAnswers(answers, `import type { Analysis } from ${JSON.stringify(MODEL)};`).map(
    describeProblem
  );

/** The analysis type an answer read as a result says it is. */
const summaryType = (a: Answer) => (JSON.parse(a.body) as Analysis.Result).summary.type;

/** The first answer read as `type`, which every test here needs one of. */
function firstOf(answers: Answer[], type: string): Answer {
  const found = answers.find((a) => a.type === type);
  if (!found) throw new Error(`no recorded answer is read as ${type}`);
  return found;
}

describe('the analysis model against recorded answers', () => {
  const answers = recordedAnswers();

  it('has an answer for every way the site reads one, and every kind of analysis', () => {
    const covered = new Set(answers.map((a) => a.type));
    expect(READ_AS.map(([, , type]) => type).filter((type) => !covered.has(type))).toEqual([]);
    const kinds = new Set(answers.filter((a) => a.type === 'Analysis.Result').map(summaryType));
    expect([...kinds].sort()).toEqual(['EXPRESSION', 'OVERREPRESENTATION', 'SPECIES_COMPARISON']);
  });

  it('names only analysis types the site knows', async () => {
    // `summary.type` is typed `Type | string` on purpose, so an unknown type
    // degrades rather than breaks; the compile check cannot see it, so this does.
    const { Analysis } =
      await import('../../projects/pathway-browser/src/app/model/analysis.model.ts');
    const known: readonly string[] = Analysis.TYPES;
    const unknown = answers
      .filter((a) => a.type === 'Analysis.Result')
      .map(summaryType)
      .filter((type) => !known.includes(type));
    expect(unknown).toEqual([]);
  });

  it('describes every recorded answer exactly', () => {
    expect(typeProblems(answers)).toEqual([]);
  }, 60_000);

  it('notices an answer without a field the site reads', () => {
    const result = firstOf(answers, 'Analysis.Result');
    const body = JSON.parse(result.body) as { summary: Partial<Analysis.Result['summary']> };
    delete body.summary.token;
    const problems = typeProblems([{ ...result, key: 'mutated', body: JSON.stringify(body) }]);
    expect(problems.join('\n')).toMatch(/'token' is missing/);
  }, 60_000);

  it('notices a field the type does not declare', () => {
    const found = firstOf(answers, 'Analysis.FoundEntities');
    const body = { ...(JSON.parse(found.body) as object), undeclared: 1 };
    const problems = typeProblems([{ ...found, key: 'mutated', body: JSON.stringify(body) }]);
    expect(problems.join('\n')).toMatch(/undeclared\W{0,3} does not exist/);
  }, 60_000);
});
