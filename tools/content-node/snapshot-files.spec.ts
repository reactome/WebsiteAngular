// @vitest-environment node
//
// The snapshot files are read with a cast (JSON.parse(...) as T), which the
// compiler takes on trust. Here each file is imported as JSON and assigned to
// its type, so a field renamed or retyped on either side is a type error
// (spec 013, T017); `npm run check:types` runs it, and vitest the rest.
//
// A JSON import's arrays are arrays, never tuples, so a type is compared in
// the form Widened gives it: each tuple an array of its element kinds, each
// literal its primitive. Tuple lengths and flag values are checked at run
// time below.
import { describe, expect, it } from 'vitest';
import caseFile from './case-snapshot.json' with { type: 'json' };
import domainFile from './domain-snapshot.json' with { type: 'json' };
import graphNamesFile from './graph-names.json' with { type: 'json' };
import jsoupFile from './jsoup-tables.json' with { type: 'json' };
import openapiFile from './openapi-snapshot.json' with { type: 'json' };
import rfdFile from './rfd-snapshot.json' with { type: 'json' };
import schemaFile from './schema-snapshot.json' with { type: 'json' };
import type { StoredSnapshot } from './domain.ts';
import type { JsoupTables } from './jsoup-text.ts';
import type { GraphNames } from './parameters.ts';
import type { SchemaSnapshot } from './schema.ts';
import type { CaseSnapshot, RfdSnapshot } from './service.ts';
import type { OpenApiSnapshot } from './snapshot-openapi.ts';

/**
 * T as a JSON import types it: every tuple an array of its elements' union,
 * every literal its primitive (0 | 1 is number, 'D' is string).
 */
type Widened<T> = T extends readonly (infer E)[]
  ? Widened<E>[]
  : T extends string
    ? string
    : T extends number
      ? number
      : T extends boolean
        ? boolean
        : T extends object
          ? { [K in keyof T]: Widened<T[K]> }
          : T;

// Each line fails to compile when its file and its type disagree.
const files = {
  case: caseFile satisfies Widened<CaseSnapshot>,
  domain: domainFile satisfies Widened<StoredSnapshot>,
  graphNames: graphNamesFile satisfies Widened<GraphNames>,
  jsoup: jsoupFile satisfies Widened<JsoupTables>,
  openapi: openapiFile satisfies Widened<OpenApiSnapshot>,
  rfd: rfdFile satisfies Widened<RfdSnapshot>,
  schema: schemaFile satisfies Widened<SchemaSnapshot>,
};

const kinds = (tuple: unknown[]) =>
  tuple.map((value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value));

describe('the snapshot files, against their types', () => {
  it("domain-snapshot.json's tuples have their types' lengths and kinds", () => {
    for (const property of files.domain.properties) {
      expect(kinds(property).join()).toMatch(/^string,string,number(,string)?$/);
      // The flag, when there, is the one value the type allows.
      if (property.length > 3) expect([property, property[3]]).toEqual([property, 'D']);
    }
    for (const field of files.domain.fields)
      expect(kinds(field).join()).toMatch(
        /^string,string$|^string,string,string,string,string,(string|null)$/
      );
    for (const getter of files.domain.getterEntries)
      expect(kinds(getter).join()).toMatch(/^string,string,(string|object),string,string,string$/);
    for (const entry of files.domain.store) expect(kinds(entry).join()).toBe('string,array');
  });

  it("jsoup-tables.json's entities are [isBase, one or two code points], its tags four flags", () => {
    for (const entity of Object.values(files.jsoup.entities)) {
      expect([2, 3]).toContain(entity.length);
      expect([0, 1]).toContain(entity[0]);
    }
    for (const flags of Object.values(files.jsoup.tags)) {
      expect(flags).toHaveLength(4);
      for (const flag of flags) expect([0, 1]).toContain(flag);
    }
  });

  it("case-snapshot.json's lists are unit, case pairs", () => {
    expect(files.case.upper.length % 2).toBe(0);
    expect(files.case.lower.length % 2).toBe(0);
  });
});
