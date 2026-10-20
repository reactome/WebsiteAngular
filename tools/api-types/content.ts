/**
 * Every recorded content API answer, compiled as the type the site reads it
 * as (spec 012, User Story 1).
 *
 * An answer is matched to the calls that read it by method, route and any
 * query values a call needs (calls.ts). Each distinct answer is compiled once
 * per distinct type its readers use. The routes are checked in groups, one
 * program each: a failing answer costs the compiler about 7 s per megabyte,
 * and the largest routes are tens of megabytes (research R3).
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { recordedAnswers, type RecordedAnswer, type Skipped } from './answers.ts';
import { CALLS, TYPES, type Call } from './calls.ts';
import { compileAnswers, ROOT, type Answer, type Problem } from './compile.ts';

const NOT_JSON = new Set(['text', 'blob']);

const routes = (call: Call): string[] => (Array.isArray(call.route) ? call.route : [call.route]);
const pattern = (route: string) =>
  new RegExp(`^${route.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\w+\}/g, '[^/]+')}$`);

const placeholders = (route: string) => route.match(/\{\w+\}/g)?.length ?? 0;

/** The route of `call` that `answer` was asked on, if it is one this call reads. */
function routeOf(call: Call, answer: RecordedAnswer): string | undefined {
  if (call.http !== answer.method || NOT_JSON.has(call.type)) return undefined;
  // A value is the one the call sends; null, a parameter it never sends.
  if (call.query && Object.entries(call.query).some(([k, v]) => answer.query.get(k) !== v))
    return undefined;
  return routes(call).find((r) => pattern(r).test(answer.path));
}

/** The groups the routes are compiled in, each its own program. */
export function groupOf(route: string | undefined): string {
  // Every route label is "<method> <path>"; one without a path is a mistake.
  if (route === undefined) throw new Error('a route label without its path');
  if (route === '/data/eventsHierarchy/{taxId}') return 'events hierarchy';
  if (route === '/data/query/enhanced/v2/{id}') return 'enhanced v2';
  return route.startsWith('/search') || route.startsWith('/interactors')
    ? 'search and interactors'
    : 'data';
}

/**
 * {checks, notRead, skipped, coverage}: `checks` are the answers to compile,
 * {key, route, source, type, body}; `notRead` counts answers on routes no call
 * reads, by path; `coverage` counts answers per call.
 */
/** What matching the answers to their readers found. */
export interface Matched {
  checks: Answer[];
  notRead: Map<string, number>;
  skipped: Skipped;
  coverage: Map<Call, number>;
}

export function matchAnswers(recorded = recordedAnswers()): Matched {
  const checks = new Map<string, Answer>();
  const notRead = new Map<string, number>();
  const coverage = new Map<Call, number>(CALLS.map((c) => [c, 0]));
  for (const answer of recorded.answers) {
    // A route written out wins over one with a placeholder that also fits:
    // /search/icon/query is not an icon called "query".
    let readers = CALLS.flatMap((call): [Call, string][] => {
      const route = routeOf(call, answer);
      return route ? [[call, route]] : [];
    });
    const fewest = Math.min(...readers.map(([, r]) => placeholders(r)));
    readers = readers.filter(([, r]) => placeholders(r) === fewest);
    // A reader that names the query it sends is the one reading this answer:
    // the website's search never asks for icons, so an icon search's answer is
    // the pathway browser's alone.
    if (readers.some(([call]) => call.query)) readers = readers.filter(([call]) => call.query);
    const read = readers.length > 0;
    for (const [call, route] of readers) {
      coverage.set(call, (coverage.get(call) ?? 0) + 1);
      const key = createHash('sha1')
        .update(call.type)
        .update(answer.body)
        .digest('hex')
        .slice(0, 10);
      if (!checks.has(key))
        checks.set(key, {
          key,
          // Per route and type read: two readers of one route are counted
          // apart, so one's progress cannot hide the other's regression.
          route: `${answer.method} ${route} as ${call.type}`,
          source: answer.source,
          type: call.type,
          body: answer.body,
        });
    }
    if (!read) notRead.set(answer.path, (notRead.get(answer.path) ?? 0) + 1);
  }
  return { checks: [...checks.values()], notRead, skipped: recorded.skipped, coverage };
}

/** The import lines for the names `types` use. */
function header(types: string[]): string {
  const names = new Set(types.flatMap((t) => t.match(/(?<![.\w])[A-Z]\w*/g) ?? []));
  return [...names]
    .filter((n) => n in TYPES)
    .sort()
    .map((n) => `import type { ${n} } from ${JSON.stringify(path.join(ROOT, TYPES[n] ?? ''))};`)
    .join('\n');
}

/** The problems found compiling `checks`, one program per group. */
export function checkAnswers(checks: Answer[]): Problem[] {
  const groups = new Map<string, Answer[]>();
  for (const c of checks) {
    const group = groupOf(c.route.split(' ')[1]);
    groups.set(group, [...(groups.get(group) ?? []), c]);
  }
  return [...groups].flatMap(([, members]) =>
    compileAnswers(members, header(members.map((m) => m.type)))
  );
}

/**
 * The difference between the problems found and the counts the ratchet
 * allows: one line per route whose count is not exactly what it allows.
 */
export function ratchet(
  problems: Pick<Problem, 'route'>[],
  known: Record<string, number>
): string[] {
  const found = new Map<string, number>();
  for (const p of problems) found.set(p.route, (found.get(p.route) ?? 0) + 1);
  const lines: string[] = [];
  for (const route of new Set([...found.keys(), ...Object.keys(known)]).values()) {
    const count = found.get(route) ?? 0;
    const allowed = known[route] ?? 0;
    if (count > allowed)
      lines.push(
        `${route}: ${count} problems, known-problems.json allows ${allowed} (more than before)`
      );
    else if (count < allowed)
      lines.push(
        `${route}: ${count} problems, known-problems.json still allows ${allowed} (lower it)`
      );
  }
  return lines.sort();
}
