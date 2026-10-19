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

const flat = (type) => type.replace(/\s+/g, ' ').replace(/;\s*}/g, ' }');

/**
 * Where the table and the source disagree: a call only one of them has, or
 * one whose method or answer type differs. Matching by place alone let a call
 * change its type, or two calls in one method swap, unseen (review of #542).
 */
function differences(calls, scanned) {
  const table = new Map(calls.filter((c) => !c.indirect).map((c) => [where(c), c]));
  const source = new Map(numbered(scanned).map((c) => [where(c), c]));
  const found = [];
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
    const added = [...scanned, { file: 'projects/x/new.service.ts', method: 'fetch', http: 'GET' }];
    expect(differences(CALLS, added)).toEqual([
      'not in the table: projects/x/new.service.ts › fetch',
    ]);
    expect(differences(CALLS.slice(1), scanned)).toEqual([`not in the table: ${where(CALLS[0])}`]);
    expect(differences(CALLS, scanned.slice(1))).toEqual([
      `no longer in the source: ${where(numbered(scanned)[0])}`,
    ]);
  });

  it('notices a call whose answer type or method changed, or two calls that swapped', () => {
    const first = numbered(scanned)[0];
    const retyped = scanned.map((c, i) => (i === 0 ? { ...c, readAs: 'Other[]' } : c));
    expect(differences(CALLS, retyped)).toEqual([
      expect.stringMatching(
        new RegExp(
          `^differs from the source: .*${first.method}.*the source ${first.http} Other\\[\\]$`
        )
      ),
    ]);
    const posted = scanned.map((c, i) => (i === 0 ? { ...c, http: 'POST' } : c));
    expect(differences(CALLS, posted)).toHaveLength(1);
    // breadcrumb's two calls read different types: in the other order, both differ.
    const i = scanned.findIndex((c) => c.file.endsWith('breadcrumb.component.ts'));
    const swapped = [...scanned];
    [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
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
