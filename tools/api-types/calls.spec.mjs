// @vitest-environment node
//
// The table of the site's content API calls (calls.mjs) and the source agree:
// a call the source makes that the table does not name is a call whose answer
// nothing checks.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALLS, TYPES } from './calls.mjs';
import { ROOT } from './compile.mjs';
import { scanCalls } from './scan.mjs';

const where = (c) => `${c.file} › ${c.method}${(c.n ?? 1) > 1 ? ` #${c.n}` : ''}`;

/** The scanned calls, numbered within their method as the table numbers them. */
function numbered(scanned) {
  const seen = new Map();
  return scanned.map((c) => {
    const key = `${c.file} ${c.method}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    return { ...c, n: seen.get(key) };
  });
}

/**
 * Calls the site reads as anything at all today (research R1). Each is typed
 * by its own task (T010); one may leave this list, never join it.
 */
const READ_AS_ANYTHING = [
  'projects/pathway-browser/src/app/diagram/entity-popup/entity-popup.component.ts › molecules',
  'projects/pathway-browser/src/app/diagram/entity-popup/entity-popup.component.ts › molecules #2',
  'projects/pathway-browser/src/app/diagram/entity-popup/entity-popup.component.ts › interactors',
  'projects/website-angular/src/services/content-data.service.ts › getInstance',
];

export function differences(calls, scanned) {
  const table = new Set(calls.filter((c) => !c.indirect).map(where));
  const source = new Set(numbered(scanned).map(where));
  return [
    ...[...source].filter((w) => !table.has(w)).map((w) => `not in the table: ${w}`),
    ...[...table].filter((w) => !source.has(w)).map((w) => `no longer in the source: ${w}`),
  ];
}

describe('the call table', () => {
  const scanned = scanCalls();

  it('names every content API call the source makes, and nothing else', () => {
    expect(differences(CALLS, scanned)).toEqual([]);
  });

  it('notices a call added to the source, or one gone from it', () => {
    const added = [...scanned, { file: 'projects/x/new.service.ts', method: 'fetch', http: 'GET' }];
    expect(differences(CALLS, added)).toEqual([
      'not in the table: projects/x/new.service.ts › fetch',
    ]);
    expect(differences(CALLS.slice(1), scanned)).toEqual([`not in the table: ${where(CALLS[0])}`]);
    expect(differences(CALLS, scanned.slice(1))).toEqual([
      `no longer in the source: ${where(numbered(scanned)[0])}`,
    ]);
  });

  it('finds, by name, the calls whose URL comes from outside their file', () => {
    for (const call of CALLS.filter((c) => c.indirect)) {
      const text = readFileSync(path.join(ROOT, call.file), 'utf8');
      expect([where(call), new RegExp(`\\b${call.method}\\b`).test(text)]).toEqual([
        where(call),
        true,
      ]);
    }
  });

  it('reads no new answer as anything', () => {
    const anything = numbered(scanned)
      .filter((c) => /^(any|unknown|\(untyped\))$/.test(c.readAs))
      .map(where);
    expect(anything.filter((w) => !READ_AS_ANYTHING.includes(w))).toEqual([]);
    // And the list is kept exact: a call typed since is taken off it.
    expect(READ_AS_ANYTHING.filter((w) => !anything.includes(w))).toEqual([]);
  });

  it('says where every name a type uses comes from', () => {
    const names = new Set(
      CALLS.filter((c) => !['text', 'blob'].includes(c.type)).flatMap(
        (c) => c.type.match(/(?<![.\w])[A-Z]\w*/g) ?? []
      )
    );
    expect([...names].filter((n) => !(n in TYPES))).toEqual([]);
  });
});
