// @vitest-environment node
//
// The table of the site's content API calls (calls.mjs) and the source agree:
// a call the source makes that the table does not name is a call whose answer
// nothing checks.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALLS, TYPES, where, type Call } from './calls.ts';
import { ROOT } from './compile.ts';
import { scanCalls, type ScannedCall } from './scan.ts';

/** The first of a list the test needs to have one. */
function first<T>(list: T[]): T {
  const [item] = list;
  if (item === undefined) throw new Error('the list is empty');
  return item;
}

/** The scanned calls, numbered within their method as the table numbers them. */
function numbered(scanned: ScannedCall[]): (ScannedCall & { n: number })[] {
  const seen = new Map<string, number>();
  return scanned.map((c) => {
    const key = `${c.file} ${c.method}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    return { ...c, n: seen.get(key) ?? 1 };
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

const flat = (type: string) => type.replace(/\s+/g, ' ').replace(/;\s*}/g, ' }');

/**
 * Where the table and the source disagree: a call only one of them has, or
 * one whose method or answer type differs. Matching by place alone let a call
 * change its type, or two calls in one method swap, unseen (review of #542).
 */
function differences(calls: Call[], scanned: ScannedCall[]): string[] {
  const table = new Map(calls.filter((c) => !c.indirect).map((c) => [where(c), c]));
  const source = new Map(numbered(scanned).map((c) => [where(c), c]));
  const found: string[] = [];
  for (const [w, c] of source) {
    const entry = table.get(w);
    if (!entry) found.push(`not in the table: ${w}`);
    else if (entry.http !== c.http || flat(entry.reads ?? entry.type) !== flat(c.readAs))
      found.push(
        `differs from the source: ${w}: the table says ${entry.http} ${entry.reads ?? entry.type}, the source ${c.http} ${c.readAs}`
      );
  }
  for (const w of table.keys()) if (!source.has(w)) found.push(`no longer in the source: ${w}`);
  return found;
}

describe('the call table', () => {
  const scanned = scanCalls();

  it('names every content API call the source makes, and nothing else', () => {
    expect(differences(CALLS, scanned)).toEqual([]);
  });

  it('notices a call added to the source, or one gone from it', () => {
    const added = [
      ...scanned,
      { file: 'projects/x/new.service.ts', method: 'fetch', http: 'GET', readAs: 'X', line: 1 },
    ];
    expect(differences(CALLS, added)).toEqual([
      'not in the table: projects/x/new.service.ts › fetch',
    ]);
    expect(differences(CALLS.slice(1), scanned)).toEqual([
      `not in the table: ${where(first(CALLS))}`,
    ]);
    expect(differences(CALLS, scanned.slice(1))).toEqual([
      `no longer in the source: ${where(first(numbered(scanned)))}`,
    ]);
  });

  it('notices a call whose answer type or method changed, or two calls that swapped', () => {
    const call = first(numbered(scanned));
    const retyped = scanned.map((c, i) => (i === 0 ? { ...c, readAs: 'Other[]' } : c));
    expect(differences(CALLS, retyped)).toEqual([
      expect.stringMatching(
        new RegExp(
          `^differs from the source: .*${call.method}.*the source ${call.http} Other\\[\\]$`
        )
      ),
    ]);
    const posted = scanned.map((c, i) => (i === 0 ? { ...c, http: 'POST' } : c));
    expect(differences(CALLS, posted)).toHaveLength(1);
    // breadcrumb's two calls read different types: in the other order, both differ.
    const i = scanned.findIndex((c) => c.file.endsWith('breadcrumb.component.ts'));
    const swapped = [...scanned];
    const [a, b] = [scanned[i], scanned[i + 1]];
    if (!a || !b) throw new Error('the breadcrumb’s two calls are not in the scan');
    [swapped[i], swapped[i + 1]] = [b, a];
    expect(differences(CALLS, swapped)).toHaveLength(2);
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
