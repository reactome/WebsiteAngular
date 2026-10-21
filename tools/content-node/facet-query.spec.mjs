// @vitest-environment node
//
// /search/facet_query, without a Solr: Spring's reading of its parameters,
// what search-core asks Solr's /facet handler, and its filter correction.
// Java's answers measured on 16 Oct 2026.
import { URLSearchParams } from 'node:url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { app, facetQueryParams } from './service.ts';
import { springList, springScope } from './spring.ts';

describe('springList, a List<String> parameter as Spring binds it', () => {
  it('splits one value at commas and trims each part', () => {
    expect(springList([' Homo sapiens ,Mus musculus'])).toEqual(['Homo sapiens', 'Mus musculus']);
  });
  it('takes repeated values as they are, untrimmed and unsplit', () => {
    expect(springList([' Homo sapiens ', 'a,b'])).toEqual([' Homo sapiens ', 'a,b']);
  });
  it('is null when absent and empty when empty', () => {
    expect(springList([])).toBe(null);
    expect(springList([''])).toEqual([]);
  });
});

describe('springScope, the Query.Scope parameter with its default', () => {
  const message = (type, value) =>
    `Failed to convert value of type '${type}' to required type 'org.reactome.server.search.domain.Query$Scope'; ` +
    'nested exception is org.springframework.core.convert.ConversionFailedException: Failed to convert from type ' +
    '[java.lang.String] to type [@io.swagger.v3.oas.annotations.Parameter @org.springframework.web.bind.annotation.RequestParam ' +
    `org.reactome.server.search.domain.Query$Scope] for value '${value}'; nested exception is ` +
    `java.lang.IllegalArgumentException: No enum constant org.reactome.server.search.domain.Query.Scope.${value}`;

  it('defaults when absent or empty, trims, and takes the first of several', () => {
    expect(springScope([])).toEqual({ value: 'PHYSICAL_ENTITY' });
    expect(springScope([''])).toEqual({ value: 'PHYSICAL_ENTITY' });
    expect(springScope([' BOTH '])).toEqual({ value: 'BOTH' });
    expect(springScope(['BOTH', 'bad'])).toEqual({ value: 'BOTH' });
  });
  it("refuses any other name, in any case, with Spring's 400", () => {
    expect(springScope(['both'])).toEqual({ error: message('java.lang.String', 'both') });
    expect(springScope(['bad', 'BOTH'])).toEqual({ error: message('java.lang.String[]', 'bad') });
  });
  it("is null when blank, which Java's configureScope cannot take: its 500", () => {
    expect(springScope([' '])).toEqual({ value: null });
    expect(springScope(['', 'BOTH'])).toEqual({ value: null });
  });
  it('quotes the value as sent, and names the constant trimmed', () => {
    expect(springScope([' bad'])).toEqual({
      error: message('java.lang.String', ' bad').replace('Scope. bad', 'Scope.bad'),
    });
  });
  it('of several, a blank first value is not null but a name that is no constant', () => {
    expect(springScope([' ', 'BOTH'])).toEqual({
      error: message('java.lang.String[]', ' ').replace('Scope. ', 'Scope.'),
    });
  });
});

describe('facetQueryParams, as SolrCore.getFacetingInformation(Query) asks', () => {
  it('scopes, then filters by species, types, keywords and compartments, then not deleted', () => {
    expect(
      facetQueryParams({
        query: 'TP53',
        scope: 'PHYSICAL_ENTITY',
        species: ['Homo sapiens', 'Mus musculus'],
        types: ['Protein'],
        keywords: ['Transport'],
        compartments: ['cytosol'],
      })
    ).toEqual([
      ['fq', '-isReferenceSummary:true'],
      ['fq', '{!tag=sf}species_facet:("Homo sapiens" OR "Mus musculus")'],
      ['fq', '{!tag=tf}type_facet:("Protein")'],
      ['fq', '{!tag=kf}keywords_facet:("Transport")'],
      ['fq', '{!tag=cf}compartment_facet:("cytosol")'],
      ['fq', '-deleted'],
      ['q', 'TP53'],
    ]);
  });
  it('REFERENCE_ENTITY and BOTH scopes, and no filter for an empty list', () => {
    expect(facetQueryParams({ query: 'x', scope: 'REFERENCE_ENTITY', species: [] })).toEqual([
      ['fq', 'hasReferenceEntity:false'],
      ['fq', '-deleted'],
      ['q', 'x'],
    ]);
    expect(facetQueryParams({ query: 'x', scope: 'BOTH' })).toEqual([
      ['fq', '-deleted'],
      ['q', 'x'],
    ]);
  });
  it('drops empty names from a list, leaving a bare tag when nothing is left', () => {
    const species = ['', 'Homo sapiens'];
    expect(facetQueryParams({ query: 'x', scope: 'BOTH', species })[0]).toEqual([
      'fq',
      '{!tag=sf}species_facet:("Homo sapiens")',
    ]);
    expect(facetQueryParams({ query: 'x', scope: 'BOTH', types: [''] })[0]).toEqual([
      'fq',
      '{!tag=tf}',
    ]);
  });
});

describe('the facet_query endpoint, against a stand-in Solr', () => {
  let base;
  let server;
  let solrServer;
  let asked;
  let answer;
  const saved = {};
  const names = ['SOLR_URL', 'SOLR_USER', 'SOLR_PASSWORD'];

  beforeAll(async () => {
    const { createServer } = await import('node:http');
    solrServer = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        const sent = [...new URLSearchParams(body)];
        asked.push([request.url, sent]);
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(answer(sent)));
      });
    });
    await new Promise((resolve) => solrServer.listen(0, '127.0.0.1', resolve));
    for (const name of names) saved[name] = process.env[name];
    process.env.SOLR_URL = `http://127.0.0.1:${solrServer.address().port}/solr/reactome`;
    process.env.SOLR_USER = 'reader';
    process.env.SOLR_PASSWORD = 'not-a-secret';
    await new Promise((resolve) => {
      server = app().listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    for (const name of names)
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => solrServer.close(resolve));
  });

  // Solr's counts for TP53, filtered by species when a species fq is sent.
  const counts = (sent) => {
    const filtered = sent.some(
      ([name, value]) => name === 'fq' && value.includes('species_facet:')
    );
    return {
      response: { numFound: filtered ? 1825 : 3428 },
      facet_counts: {
        facet_fields: {
          species_facet: ['Homo sapiens', 1825, 'Mus musculus', 202],
          type_facet: ['Protein', 9],
          keywords_facet: [],
          compartment_facet: ['cytosol', 3],
        },
      },
    };
  };

  it('splits selected from available, in FacetList order, empty lists left out', async () => {
    asked = [];
    answer = counts;
    const response = await fetch(
      `${base}/ContentService/search/facet_query?query=TP53&species=Homo%20sapiens`
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      '{"totalNumFount":1825,' +
        '"speciesFacet":{"selected":[{"name":"Homo sapiens","count":1825}],"available":[{"name":"Mus musculus","count":202}]},' +
        '"typeFacet":{"available":[{"name":"Protein","count":9}]},' +
        '"keywordFacet":{},' +
        '"compartmentFacet":{"available":[{"name":"cytosol","count":3}]}}'
    );
    expect(asked).toHaveLength(1);
  });

  it('asks again without a filter that selected nothing, unless filters are forced', async () => {
    asked = [];
    answer = counts;
    const corrected = await fetch(
      `${base}/ContentService/search/facet_query?query=TP53&species=Nonexistent`
    );
    expect((await corrected.json()).totalNumFount).toBe(3428);
    expect(asked.map(([, sent]) => sent.filter(([name]) => name === 'fq'))).toEqual([
      [
        ['fq', '-isReferenceSummary:true'],
        ['fq', '{!tag=sf}species_facet:("Nonexistent")'],
        ['fq', '-deleted'],
      ],
      [
        ['fq', '-isReferenceSummary:true'],
        ['fq', '-deleted'],
      ],
    ]);

    asked = [];
    const forced = await fetch(
      `${base}/ContentService/search/facet_query?query=TP53&species=Nonexistent&Force%20filters=true`
    );
    expect(forced.status).toBe(200);
    expect(asked).toHaveLength(1);
  });

  it("answers Spring's 400s and Java's empty 200 and 500 before asking Solr", async () => {
    asked = [];
    const missing = await fetch(`${base}/ContentService/search/facet_query`);
    expect(missing.status).toBe(400);
    const empty = await fetch(`${base}/ContentService/search/facet_query?query=`);
    expect([empty.status, await empty.text()]).toEqual([200, '']);
    const scope = await fetch(`${base}/ContentService/search/facet_query?query=x&scope=both`);
    expect(scope.status).toBe(400);
    const force = await fetch(
      `${base}/ContentService/search/facet_query?query=x&Force%20filters=maybe`
    );
    expect((await force.json()).messages).toEqual([
      "Failed to convert value of type 'java.lang.String' to required type 'java.lang.Boolean'; nested exception is java.lang.IllegalArgumentException: Invalid boolean value [maybe]",
    ]);
    const blank = await fetch(`${base}/ContentService/search/facet_query?query=x&scope=%20`);
    expect([blank.status, (await blank.json()).messages]).toEqual([
      500,
      ['Something unexpected happened and the error has been reported.'],
    ]);
    const unexpected = ['Something unexpected happened and the error has been reported.'];
    // A blank Boolean is null, which the primitive forceFilters cannot take --
    // before the empty-query check; a single empty value is the default.
    for (const forced of [
      'query=TP53&Force%20filters=%20',
      'query=&Force%20filters=%20',
      'query=TP53&Force%20filters=&Force%20filters=true',
    ]) {
      const response = await fetch(`${base}/ContentService/search/facet_query?${forced}`);
      expect([forced, response.status, (await response.json()).messages]).toEqual([
        forced,
        500,
        unexpected,
      ]);
    }
    const emptyBlank = await fetch(`${base}/ContentService/search/facet_query?query=&scope=%20`);
    expect([emptyBlank.status, await emptyBlank.text()]).toEqual([200, '']);
    expect(asked).toHaveLength(0);
  });

  it('takes the default, false, for one empty Force filters value', async () => {
    asked = [];
    answer = counts;
    // Unforced, a filter that selects nothing is dropped and Solr asked again.
    const response = await fetch(
      `${base}/ContentService/search/facet_query?query=TP53&species=Nonexistent&Force%20filters=`
    );
    expect(response.status).toBe(200);
    expect(asked).toHaveLength(2);
  });

  it("asks once when the only names dropped were empty: Java's lists lose them first", async () => {
    asked = [];
    answer = counts;
    const response = await fetch(
      `${base}/ContentService/search/facet_query?query=TP53&species=,Homo%20sapiens`
    );
    expect(response.status).toBe(200);
    expect(asked).toHaveLength(1);
  });

  it("is Java's failure when a list was given for a facet Solr did not count", async () => {
    asked = [];
    answer = () => ({
      response: { numFound: 1 },
      facet_counts: { facet_fields: { type_facet: [] } },
    });
    const response = await fetch(
      `${base}/ContentService/search/facet_query?query=TP53&species=Homo%20sapiens`
    );
    // Java's NullPointerException, not a Solr failure.
    expect([response.status, (await response.json()).messages]).toEqual([
      500,
      ['Something unexpected happened and the error has been reported.'],
    ]);
  });
});
