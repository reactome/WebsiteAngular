// @vitest-environment node
//
// The parameter record (parameters.ts) and its standard form. A URL in
// standard form is labelled cacheable at the edge; anything else is answered
// but never stored, so a record that missed an endpoint, invented a
// parameter or let an alias through would let the cache fill with copies of
// one answer (spec 011).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PATH_KINDS, RECORD, declaredQuery, standardForm } from './parameters.ts';

const { endpoints } = await import('./service.ts');
const GETS = endpoints
  .filter((e: { method?: string }) => !e.method || e.method === 'GET')
  .map((e: { path: string }) => e.path);
const OPENAPI = JSON.parse(
  readFileSync(new URL('./openapi-snapshot.json', import.meta.url), 'utf8')
);
const variables = (path: string) => [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
const shape = (path: string) => path.replace(/\{[^}]+\}/g, '{}');

describe('the record', () => {
  it('has one entry for each GET endpoint node answers, and no other, in the order Express routes them', () => {
    // The order is what classify.ts relies on to find the endpoint a URL
    // reaches, a literal route before the template that would also match it.
    expect(Object.keys(RECORD)).toEqual(GETS);
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
      ['/ContentService/exporter/fireworks/{id}', 'private'],
      ['/ContentService/interactors/psicquic/resources', 'never'],
    ]);
  });
});

const ok = { ok: true };
const at = (endpoint: string, url: string) => standardForm(endpoint, url);

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
    const cases: [endpoint: string, url: string, standard: boolean][] = [
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
        '/ContentService/search/icon/R-ICO-13748',
        false,
      ],
      [
        '/ContentService/search/icon/{identifier}',
        '/ContentService/search/icon/R-ICO-013748',
        true,
      ],
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
  const url = (query: string) => `/ContentService/data/event/R-HSA-1/in-depth?${query}`;

  it('takes declared parameters with valid values, in any order, view and includeRef included', () => {
    for (const query of [
      'view=nested&includeRef=true',
      'includeRef=false&maxDepth=-1',
      'attributes=species,compartment',
    ])
      expect([query, at(inDepth, url(query))]).toEqual([query, ok]);
  });

  it('refuses an undeclared parameter, a repeated one, and every spelling of a value but one', () => {
    const cases: [query: string, rule: string][] = [
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

// Review of #530: aliases each found accepted, and the mutations that
// survived the tests above.
describe('standardForm: one spelling, where Java answers many', () => {
  const no = (rule: string) => ({ ok: false, rule });
  const cases: [string, string, unknown][] = [
    // species read leniently, or ignored when unknown on /pathways/low
    [
      '/ContentService/data/pathways/low/entity/{id}',
      '/ContentService/data/pathways/low/entity/R-HSA-199420?species=9606',
      ok,
    ],
    [
      '/ContentService/data/pathways/low/entity/{id}',
      '/ContentService/data/pathways/low/entity/R-HSA-199420?species=nosuchspecies',
      no('parameter:species'),
    ],
    [
      '/ContentService/data/pathways/low/entity/{id}',
      '/ContentService/data/pathways/low/entity/R-HSA-199420?species=%D9%A9%D9%A6%D9%A0%D9%A6',
      no('parameter:species'),
    ],
    [
      '/ContentService/data/schema/{id}/count',
      '/ContentService/data/schema/Pathway/count?species=HOMO__sapiens',
      no('parameter:species'),
    ],
    // a value spelled twice
    [
      '/ContentService/data/event/{id}/in-depth',
      '/ContentService/data/event/R-HSA-1/in-depth?maxDepth=%31',
      no('parameter:maxDepth'),
    ],
    [
      '/ContentService/data/event/{id}/in-depth',
      '/ContentService/data/event/R-HSA-1/in-depth?includeRef=tru%65',
      no('parameter:includeRef'),
    ],
    [
      '/ContentService/search/query',
      '/ContentService/search/query?query=p53&species=Homo+sapiens',
      no('parameter:species'),
    ],
    [
      '/ContentService/search/query',
      '/ContentService/search/query?query=p53&species=Homo%20sapiens',
      ok,
    ],
    ['/ContentService/search/query', '/ContentService/search/query?query=uniprot:P04637', ok],
    // maxDepth: every negative is no limit, 0 is 1
    [
      '/ContentService/data/event/{id}/in-depth',
      '/ContentService/data/event/R-HSA-1/in-depth?maxDepth=-1',
      ok,
    ],
    [
      '/ContentService/data/event/{id}/in-depth',
      '/ContentService/data/event/R-HSA-1/in-depth?maxDepth=-7',
      no('parameter:maxDepth'),
    ],
    [
      '/ContentService/data/event/{id}/in-depth',
      '/ContentService/data/event/R-HSA-1/in-depth?maxDepth=0',
      no('parameter:maxDepth'),
    ],
    // attributes: empty items dropped, repeats
    [
      '/ContentService/data/event/{id}/in-depth',
      '/ContentService/data/event/R-HSA-1/in-depth?attributes=species,compartment',
      ok,
    ],
    [
      '/ContentService/data/event/{id}/in-depth',
      '/ContentService/data/event/R-HSA-1/in-depth?attributes=species,compartment,,',
      no('parameter:attributes'),
    ],
    [
      '/ContentService/data/event/{id}/in-depth',
      '/ContentService/data/event/R-HSA-1/in-depth?attributes=species,species',
      no('parameter:attributes'),
    ],
    // mapping finds the resource ignoring case; GO is cut to digits
    [
      '/ContentService/data/mapping/{resource}/{identifier}/reactions',
      '/ContentService/data/mapping/UniProt/P01308/reactions',
      ok,
    ],
    [
      '/ContentService/data/mapping/{resource}/{identifier}/reactions',
      '/ContentService/data/mapping/uNiPrOt/P01308/reactions',
      no('path:resource'),
    ],
    [
      '/ContentService/data/mapping/{resource}/{identifier}/reactions',
      '/ContentService/data/mapping/ENSEMBL%20Fungi/X/reactions',
      ok,
    ],
    [
      '/ContentService/data/mapping/{resource}/{identifier}/pathways',
      '/ContentService/data/mapping/GO/GO:0006915/pathways',
      ok,
    ],
    [
      '/ContentService/data/mapping/{resource}/{identifier}/pathways',
      '/ContentService/data/mapping/GO/goXYZ0006915/pathways',
      no('path:identifier'),
    ],
    // declared, never read
    [
      '/ContentService/search/diagram/{diagram}/occurrences/{instance}',
      '/ContentService/search/diagram/R-HSA-1/occurrences/R-HSA-2?types=x',
      no('parameter:types'),
    ],
    // a list's item given twice
    [
      '/ContentService/search/query',
      '/ContentService/search/query?query=p53&types=Protein&types=Protein',
      no('parameter:types'),
    ],
    [
      '/ContentService/search/pathways/of/{dbId}',
      '/ContentService/search/pathways/of/50758?fields=BOGUS',
      no('parameter:fields'),
    ],
    // survivors of the mutation run
    ['/ContentService/data/query/{id}', '/ContentService/data/query/R-HSA-1.0', no('path:id')],
    ['/ContentService/data/query/{id}', '/ContentService/data/query/R-HSA-1.01', no('path:id')],
    ['/ContentService/data/query/{id}', '/ContentService/data/query/REACT_0', no('path:id')],
    ['/ContentService/data/query/{id}', '/ContentService/data/query/REACT_01', no('path:id')],
    ['/ContentService/data/query/{id}', '/ContentService/data/query/uniprot:P04637', ok],
    ['/ContentService/data/query/{id}', '/ContentService/data/query/uniprot:', no('path:id')],
    [
      '/ContentService/data/pathways/top/{id}',
      '/ContentService/data/pathways/top/09606',
      no('path:id'),
    ],
    [
      '/ContentService/data/person/{id}',
      '/ContentService/data/person/0000-0001-5807-006x',
      no('path:id'),
    ],
    [
      '/ContentService/references/mapping/{identifier}',
      `/ContentService/references/mapping/${'A'.repeat(65)}`,
      no('path:identifier'),
    ],
    [
      '/ContentService/references/mapping/{identifier}',
      '/ContentService/references/mapping/P04%20637',
      no('path:identifier'),
    ],
    ['/ContentService/search/icon/query', '/ContentService/search/icon/query?page=2147483647', ok],
    [
      '/ContentService/search/icon/query',
      '/ContentService/search/icon/query?page=2147483648',
      no('parameter:page'),
    ],
    ['/ContentService/data/query/{id}', '/ContentService/data/QUERY/R-HSA-1', no('form')],
    ['/ContentService/data/nothing', '/ContentService/data/nothing', no('form')],
    [
      '/ContentService/search/query',
      '/ContentService/search/query?query=%E0%A4%A',
      no('parameter:query'),
    ],
  ];
  // Second review of #530.
  const lowSpecies = (value: string) =>
    `/ContentService/data/pathways/low/entity/R-HSA-199420?species=${value}`;
  const low = '/ContentService/data/pathways/low/entity/{id}';
  const depth = (value: string) => `/ContentService/data/event/R-HSA-1/in-depth?${value}`;
  const event = '/ContentService/data/event/{id}/in-depth';
  cases.push(
    // a taxId no species has filters nothing; a Species dbId is a taxId's alias
    [low, lowSpecies('1'), no('parameter:species')],
    [low, lowSpecies('48887'), no('parameter:species')],
    [
      '/ContentService/data/mapping/{resource}/{identifier}/pathways',
      '/ContentService/data/mapping/GO/GO:0006915/pathways?species=48887',
      no('parameter:species'),
    ],
    [
      '/ContentService/data/mapping/{resource}/{identifier}/pathways',
      '/ContentService/data/mapping/GO/GO:0006915/pathways?species=9606',
      ok,
    ],
    // a relationship pattern: unknown names, case and order match the same
    [event, depth('attributes=species,compartment,referenceEntity'), ok],
    [event, depth('attributes=species,zzz'), no('parameter:attributes')],
    [event, depth('attributes=SPECIES'), no('parameter:attributes')],
    [event, depth('attributes=compartment,species'), no('parameter:attributes')],
    // a depth past an object's tree is no limit's answer
    [event, depth('maxDepth=10'), ok],
    [event, depth('maxDepth=11'), no('parameter:maxDepth')],
    [event, depth('maxDepth=2147483647'), no('parameter:maxDepth')],
    // the database name with characters a path may carry bare
    [
      '/ContentService/data/mapping/{resource}/{identifier}/reactions',
      '/ContentService/data/mapping/COSMIC%20(genes)/TP53/reactions',
      ok,
    ],
    [
      '/ContentService/data/mapping/{resource}/{identifier}/reactions',
      '/ContentService/data/mapping/COSMIC%20%28genes%29/TP53/reactions',
      no('path:resource'),
    ],
    // `!` is left bare by the strict encoding itself; `%21` is its second spelling
    ['/ContentService/search/query', '/ContentService/search/query?query=a!', ok],
    [
      '/ContentService/search/query',
      '/ContentService/search/query?query=a%21',
      no('parameter:query'),
    ]
  );
  // Each character Angular's HttpParams leaves bare, both ways.
  for (const char of ['@', ':', '$', ',', ';', '=', '?', '/']) {
    const strict = encodeURIComponent(`a${char}b`);
    cases.push(
      ['/ContentService/search/query', `/ContentService/search/query?query=${strict}`, ok],
      ['/ContentService/search/query', `/ContentService/search/query?query=a${char}b`, ok]
    );
  }
  for (const [endpoint, url, expected] of cases)
    it(url, () => {
      expect(standardForm(endpoint, url)).toEqual(expected);
    });
});
