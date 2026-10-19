// @vitest-environment node
//
// Every recorded content API answer against the type the site reads it as
// (spec 012, User Story 1). Until a route's type is fixed, its problems are a
// count in known-problems.json that may only go down: a change that makes any
// route's answers fit its type worse fails here.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALLS } from './calls.mjs';
import { describe as line } from './compile.mjs';
import { checkAnswers, groupOf, matchAnswers, ratchet } from './content.mjs';

const KNOWN = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'known-problems.json'), 'utf8')
);

/** Paths the recordings hold answers for that no call of the site reads. */
const NOT_READ = ['/v3/api-docs'];

const where = (c) => `${c.file} › ${c.method}${(c.n ?? 1) > 1 ? ` #${c.n}` : ''}`;

describe('recorded content API answers', () => {
  const matched = matchAnswers();
  const groups = [...new Set(matched.checks.map((c) => groupOf(c.route.split(' ')[1])))].sort();
  const problems = [];

  it('reads every recorded answer, apart from the routes listed as not read', () => {
    expect([...matched.notRead.keys()].sort()).toEqual(NOT_READ);
  });

  it('has answers for every call except those the table names as gaps, and none for those', () => {
    const covered = (c) => matched.coverage.get(c) > 0;
    const json = CALLS.filter((c) => !c.indirect && !['text', 'blob'].includes(c.type));
    expect(json.filter((c) => !c.gap && !covered(c)).map(where)).toEqual([]);
    expect(json.filter((c) => c.gap && covered(c)).map(where)).toEqual([]);
  });

  for (const group of groups)
    it(`compiles the ${group} answers as their types`, () => {
      const members = matched.checks.filter((c) => groupOf(c.route.split(' ')[1]) === group);
      const found = checkAnswers(members);
      problems.push(...found);
      // A route not in known-problems.json is held to none: say what is wrong.
      const strict = found.filter((p) => !(p.route in KNOWN)).map(line);
      expect(strict.slice(0, 40)).toEqual([]);
    }, 180_000);

  it('finds exactly the problems known-problems.json allows, route by route', () => {
    expect(ratchet(problems, KNOWN)).toEqual([]);
  });
});

describe('the ratchet', () => {
  const found = (route, n) => Array.from({ length: n }, () => ({ route }));

  it('fails when a route has more problems than before', () => {
    expect(ratchet(found('GET /a', 3), { 'GET /a': 2 })).toEqual([
      'GET /a: 3 problems, known-problems.json allows 2 (more than before)',
    ]);
  });

  it('fails when a route has fewer, until the file is lowered', () => {
    expect(ratchet(found('GET /a', 1), { 'GET /a': 2 })).toEqual([
      'GET /a: 1 problems, known-problems.json still allows 2 (lower it)',
    ]);
    expect(ratchet([], { 'GET /a': 2 })).toEqual([
      'GET /a: 0 problems, known-problems.json still allows 2 (lower it)',
    ]);
  });

  it('holds a route it does not name to none', () => {
    expect(ratchet(found('GET /b', 1), {})).toEqual([
      'GET /b: 1 problems, known-problems.json allows 0 (more than before)',
    ]);
    expect(ratchet(found('GET /a', 2), { 'GET /a': 2 })).toEqual([]);
  });
});
