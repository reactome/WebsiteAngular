// @vitest-environment node
//
// The parameter record (parameters.mjs) and its standard form. A URL in
// standard form is labelled cacheable at the edge; anything else is answered
// but never stored, so a record that missed an endpoint, invented a
// parameter or let an alias through would let the cache fill with copies of
// one answer (spec 011).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PATH_KINDS, RECORD, declaredQuery, standardForm } from './parameters.mjs';

const { endpoints } = await import('./service.mjs');
const GETS = endpoints.filter((e) => !e.method || e.method === 'GET').map((e) => e.path);
const OPENAPI = JSON.parse(
  readFileSync(new URL('./openapi-snapshot.json', import.meta.url), 'utf8')
);
const variables = (path) => [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
const shape = (path) => path.replace(/\{[^}]+\}/g, '{}');

describe('the record', () => {
  it('has one entry for each GET endpoint node answers, and no other', () => {
    expect(Object.keys(RECORD).sort()).toEqual([...GETS].sort());
  });

  it("names a GET operation in Java's published description, of the same shape, or says why not", () => {
    for (const [path, entry] of Object.entries(RECORD)) {
      if (entry.java === null) {
        expect([path, typeof entry.why]).toEqual([path, 'string']);
        expect([path, Array.isArray(entry.query)]).toEqual([path, true]);
        continue;
      }
      expect([path, OPENAPI.paths[entry.java]?.get !== undefined]).toEqual([path, true]);
      // The attribute forms answer for Java's /query/{id}/{attributeName}.
      if (!entry.attributeOf)
        expect([path, shape(entry.java)]).toEqual([
          path,
          shape(path.replace('/ContentService', '')),
        ]);
      expect([path, entry.query]).toEqual([path, undefined]);
    }
  });

  it('gives each path variable a kind it knows, and no other', () => {
    for (const [path, entry] of Object.entries(RECORD)) {
      expect([path, Object.keys(entry.path ?? {}).sort()]).toEqual([path, variables(path).sort()]);
      for (const kind of Object.values(entry.path ?? {}))
        expect([path, kind, kind in PATH_KINDS]).toEqual([path, kind, true]);
    }
  });

  it("takes a documented endpoint's query parameters from Java's description, view and includeRef included", () => {
    const names = declaredQuery('/ContentService/data/event/{id}/in-depth').map((p) => p.name);
    expect(names.sort()).toEqual(['attributes', 'includeRef', 'maxDepth', 'view']);
    expect(declaredQuery('/ContentService/search/query').map((p) => p.name)).toContain('Start row');
  });

  it('marks what is never stored: outside services, a daily date, a token', () => {
    expect(
      Object.entries(RECORD)
        .filter(([, entry]) => entry.cache)
        .map(([path, entry]) => [path, entry.cache])
        .sort()
    ).toEqual([
      ['/ContentService/citation/export', 'never'],
      ['/ContentService/citation/pathway/{id}', 'never'],
      ['/ContentService/citation/static/{id}', 'never'],
      ['/ContentService/exporter/diagram/{id}', 'private'],
      ['/ContentService/interactors/psicquic/resources', 'never'],
    ]);
  });
});

const ok = { ok: true };
const at = (endpoint, url) => standardForm(endpoint, url);

describe('standardForm: paths', () => {
  const query = '/ContentService/data/query/{id}';
  it('takes a stable id, one with a short version, a dbId and an old REACT_ id', () => {
    for (const id of [
      'R-HSA-109581',
      'R-HSA-109581.3',
      'R-MMU-1.123',
      '109581',
      'REACT_578',
      '9223372036854775807',
    ])
      expect([id, at(query, `/ContentService/data/query/${id}`)]).toEqual([id, ok]);
  });

  it('refuses the aliases Java also answers: padded, encoded, zero-led, other digits, long versions', () => {
    for (const id of [
      '%20R-HSA-109581',
      'R-HSA-109581%20',
      'r-hsa-109581',
      'R-HSA-0109581',
      'R-HSA-109581.1234',
      '0109581',
      '109581.2',
      '%EF%BC%91',
      '9223372036854775808',
      'REACT_578.1',
      'R%2DHSA-109581',
    ])
      expect([id, at(query, `/ContentService/data/query/${id}`)]).toEqual([
        id,
        { ok: false, rule: 'path:id' },
      ]);
  });

  it('refuses encoded letters in a fixed segment, and a trailing slash', () => {
    expect(at(query, '/ContentService/data/qu%65ry/R-HSA-1')).toEqual({ ok: false, rule: 'form' });
    expect(at(query, '/ContentService/data/query/R-HSA-1/')).toEqual({ ok: false, rule: 'form' });
  });

  it('knows each kind: species, class, attribute, resource, accession, icon, person', () => {
    const cases = [
      ['/ContentService/data/pathways/top/{id}', '/ContentService/data/pathways/top/9606', true],
      [
        '/ContentService/data/pathways/top/{id}',
        '/ContentService/data/pathways/top/Homo%20sapiens',
        false,
      ],
      ['/ContentService/data/schema/{id}/count', '/ContentService/data/schema/Pathway/count', true],
      [
        '/ContentService/data/schema/{id}/count',
        '/ContentService/data/schema/pathway/count',
        false,
      ],
      [
        '/ContentService/data/query/{id}/{attribute}',
        '/ContentService/data/query/R-HSA-1/displayName',
        true,
      ],
      [
        '/ContentService/data/query/{id}/{attribute}',
        '/ContentService/data/query/R-HSA-1/DISPLAYNAME',
        false,
      ],
      [
        '/ContentService/data/complexes/{resource}/{identifier}',
        '/ContentService/data/complexes/UniProt/P00533',
        true,
      ],
      [
        '/ContentService/data/complexes/{resource}/{identifier}',
        '/ContentService/data/complexes/Uni.*/P00533',
        false,
      ],
      [
        '/ContentService/search/icon/{identifier}',
        '/ContentService/search/icon/R-ICO-012345',
        false,
      ],
      ['/ContentService/search/icon/{identifier}', '/ContentService/search/icon/R-ICO-12345', true],
      ['/ContentService/data/person/{id}', '/ContentService/data/person/0000-0001-5807-0069', true],
      ['/ContentService/data/person/{id}', '/ContentService/data/person/x@y.org', false],
      [
        '/ContentService/search/diagram/{diagram}',
        '/ContentService/search/diagram/R-HSA-1.2?query=a',
        false,
      ],
    ];
    for (const [endpoint, url, standard] of cases)
      expect([url, at(endpoint, url).ok]).toEqual([url, standard]);
  });
});

describe('standardForm: query parameters', () => {
  const inDepth = '/ContentService/data/event/{id}/in-depth';
  const url = (query) => `/ContentService/data/event/R-HSA-1/in-depth?${query}`;

  it('takes declared parameters with valid values, in any order, view and includeRef included', () => {
    for (const query of [
      'view=nested&includeRef=true',
      'includeRef=false&maxDepth=-1',
      'attributes=species,compartment',
    ])
      expect([query, at(inDepth, url(query))]).toEqual([query, ok]);
  });

  it('refuses an undeclared parameter, a repeated one, and every spelling of a value but one', () => {
    const cases = [
      ['utm_source=x', 'parameter:utm_source'],
      ['view=nested&view=nested', 'parameter:view'],
      ['view=DETAIL', 'parameter:view'],
      ['includeRef=TRUE', 'parameter:includeRef'],
      ['includeRef=1', 'parameter:includeRef'],
      ['maxDepth=01', 'parameter:maxDepth'],
      ['maxDepth=%2B1', 'parameter:maxDepth'],
      ['maxDepth=0x1', 'parameter:maxDepth'],
      ['maxDepth=99999999999', 'parameter:maxDepth'],
      ['attributes=', 'parameter:attributes'],
      ['attributes=%20species', 'parameter:attributes'],
      ['view', 'parameter:view'],
      ['view=nested&&includeRef=true', 'form'],
    ];
    for (const [query, rule] of cases)
      expect([query, at(inDepth, url(query))]).toEqual([query, { ok: false, rule }]);
  });

  it("lets a list repeat; takes Java's spaced names in one spelling only", () => {
    const search = '/ContentService/search/query';
    expect(
      at(search, '/ContentService/search/query?query=p53&types=Protein&types=Complex')
    ).toEqual(ok);
    expect(at(search, '/ContentService/search/query?query=p53&Start%20row=10')).toEqual(ok);
    expect(at(search, '/ContentService/search/query?query=p53&Start+row=10')).toEqual({
      ok: false,
      rule: 'parameter:Start row',
    });
    expect(at(search, '/ContentService/search/query?query=p53&scope=BOTH&parserType=STD')).toEqual(
      ok
    );
    expect(at(search, '/ContentService/search/query?query=p53&scope=both')).toEqual({
      ok: false,
      rule: 'parameter:scope',
    });
  });

  it("reads an undocumented endpoint's own declaration", () => {
    const pwb = '/ContentService/data/detail/{id}/locationsInPWB';
    expect(
      at(pwb, '/ContentService/data/detail/R-HSA-1/locationsInPWB?directParticipants=true')
    ).toEqual(ok);
    expect(at(pwb, '/ContentService/data/detail/R-HSA-1/locationsInPWB?view=nested')).toEqual({
      ok: false,
      rule: 'parameter:view',
    });
  });
});
