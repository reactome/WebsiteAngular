// @vitest-environment node
//
// /search/query and /search/query/paginated -- the website's search -- with
// stand-ins for Solr (the reactome and target cores) and the report service:
// search-core's fallback chain, grouped and plain search, paging, and the
// report of a search that finds nothing. Java's answers measured 17 Oct 2026.
import { URLSearchParams } from 'node:url';
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';

vi.mock('./graph.mjs', () => ({
  read: async () => [{ version: 97 }],
  configured: () => true,
  close: async () => {},
  envSetting: (key, fallback = '') => process.env[key] || fallback,
}));

const { app, facetQueryParams } = await import('./service.mjs');

let base;
let server;
let solrServer;
let reportServer;
let asked;
let answer;
let reports;

const listen = async (handler) => {
  const { createServer } = await import('node:http');
  const listening = createServer(handler);
  await new Promise((resolve) => listening.listen(0, '127.0.0.1', resolve));
  return listening;
};

beforeAll(async () => {
  solrServer = await listen((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const [path, query = ''] = request.url.split('?');
      const sent = [...new URLSearchParams(request.method === 'GET' ? query : body)];
      const handler = path.replace('/solr', '');
      asked.push([handler, sent]);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(answer(handler, sent)));
    });
  });
  reportServer = await listen((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      reports.push({ url: request.url, body });
      response.end();
    });
  });
  process.env.SOLR_URL = `http://127.0.0.1:${solrServer.address().port}/solr/reactome`;
  process.env.REPORT_URL = `http://127.0.0.1:${reportServer.address().port}`;
  await new Promise((resolve) => {
    server = app().listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  for (const name of ['SOLR_URL', 'REPORT_URL']) delete process.env[name];
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => solrServer.close(resolve));
  await new Promise((resolve) => reportServer.close(resolve));
});

const get = (path) => fetch(`${base}/ContentService/search/${path}`);
const until = async (ready) => {
  for (let tries = 0; !ready() && tries < 400; tries += 1)
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(ready()).toBe(true);
};
const fqs = (sent) => sent.filter(([name]) => name === 'fq').map(([, value]) => value);
const value = (sent, name) => sent.find(([key]) => key === name)?.[1];

/** Facets that found `found`, with two types. */
const facets = (found) => ({
  response: { numFound: found },
  facet_counts: {
    facet_fields: {
      species_facet: ['Homo sapiens', found],
      type_facet: found ? ['Protein', 6, 'Reaction', 2] : [],
      keywords_facet: [],
      compartment_facet: [],
    },
  },
});
const doc = (id, name) => ({
  dbId: id,
  stId: `R-HSA-${id}`,
  name,
  type: 'Protein',
  exactType: 'Protein',
});
const grouped = (groups) => ({
  grouped: {
    type_facet: {
      matches: 8,
      ngroups: groups.length,
      groups: groups.map(([groupValue, docs]) => ({
        groupValue,
        doclist: { numFound: docs.length + 1, start: 0, docs },
      })),
    },
  },
  highlighting: { 1: { name: ['<span class="highlighting" >TP53</span>'] } },
});

describe('facetQueryParams, as the fallback chain changes the query', () => {
  it('asks for the deleted entries, and with another parser', () => {
    expect(
      facetQueryParams({ query: 'x', scope: 'BOTH', deleted: true, parserType: 'DISMAX' })
    ).toEqual([
      ['fq', 'deleted:true'],
      ['defType', 'dismax'],
      ['q', 'x'],
    ]);
  });
});

describe('/query', () => {
  it('asks the facets, then /search/grouped, writing each type that has entries', async () => {
    asked = [];
    reports = [];
    answer = (handler) =>
      handler.endsWith('/facet')
        ? facets(8)
        : grouped([
            ['Protein', [doc('1', 'TP53')]],
            ['Reaction', []],
          ]);
    const response = await get('query?query=TP53&cluster=true&Start%20row=0&rows=30');
    expect(await response.text()).toBe(
      '{"results":[{"entries":[{"dbId":"1","stId":"R-HSA-1","id":"R-HSA-1","name":"<span class=\\"highlighting\\" >TP53</span>","type":"Protein","exactType":"Protein"}],' +
        '"typeName":"Protein","entriesCount":2,"rowCount":1}],"rowCount":1,"numberOfGroups":2,"numberOfMatches":8}'
    );
    expect(asked.map(([handler]) => handler)).toEqual([
      '/reactome/facet',
      '/reactome/search/grouped',
    ]);
    expect(asked[1][1]).toEqual([
      ['wt', 'json'],
      ['json.nl', 'flat'],
      ['fq', ''],
      ['fq', ''],
      ['fq', ''],
      ['fq', ''],
      ['fq', '-deleted'],
      ['fq', '-isReferenceSummary:true'],
      ['group.offset', '0'],
      ['group.limit', '30'],
      ['q', 'TP53'],
    ]);
    expect(reports).toHaveLength(0);
  });

  it('without clustering asks /search, a page of Results', async () => {
    asked = [];
    answer = (handler) =>
      handler.endsWith('/facet')
        ? facets(8)
        : { response: { numFound: 8, docs: [doc('2', 'MDM2')] } };
    const response = await get(
      'query?query=TP53&cluster=false&rows=5&Start%20row=10&species=Homo%20sapiens&types=Protein&parserType=EDISMAX'
    );
    expect(await response.json()).toEqual({
      results: [
        {
          entries: [
            {
              dbId: '2',
              stId: 'R-HSA-2',
              id: 'R-HSA-2',
              name: 'MDM2',
              type: 'Protein',
              exactType: 'Protein',
            },
          ],
          typeName: 'Results',
          entriesCount: 8,
          rowCount: 1,
        },
      ],
      rowCount: 1,
      numberOfGroups: 1,
      numberOfMatches: 8,
    });
    expect(asked[1]).toEqual([
      '/reactome/search',
      [
        ['wt', 'json'],
        ['json.nl', 'flat'],
        ['fq', 'species_facet:("Homo sapiens")'],
        ['fq', 'type_facet:("Protein")'],
        ['fq', ''],
        ['fq', ''],
        ['fq', '-deleted'],
        ['fq', '-isReferenceSummary:true'],
        ['defType', 'edismax'],
        ['start', '10'],
        ['rows', '5'],
        ['q', 'TP53'],
      ],
    ]);
  });

  it('finding nothing, falls back step by step, then reports and is the 404', async () => {
    asked = [];
    reports = [];
    answer = (handler) =>
      handler.endsWith('/facet') ? facets(0) : { response: { numFound: 0, docs: [] } };
    const response = await get('query?query=zzz&types=Protein&scope=PHYSICAL_ENTITY');
    expect([response.status, (await response.json()).targets]).toEqual([404, null]);
    // As given, then without filters in the default scope, then deleted,
    // then by dismax, then in every scope; then the target core.
    expect(
      asked.map(([handler, sent]) => [handler, fqs(sent).join(' & '), value(sent, 'defType') ?? ''])
    ).toEqual([
      [
        '/reactome/facet',
        '-isReferenceSummary:true & {!tag=tf}type_facet:("Protein") & -deleted',
        '',
      ],
      // The type selected nothing: facet_query's own correction drops it.
      ['/reactome/facet', '-isReferenceSummary:true & -deleted', ''],
      ['/reactome/facet', 'hasReferenceEntity:false & -deleted', ''],
      ['/reactome/facet', 'hasReferenceEntity:false & deleted:true', ''],
      ['/reactome/facet', 'hasReferenceEntity:false & -deleted', 'dismax'],
      ['/reactome/facet', '-deleted', 'dismax'],
      ['/target/search', '', ''],
    ]);
    await until(() => reports.length === 1);
    expect(reports[0].url.split('?')[0]).toBe('/report/search/notfound');
    expect(reports[0].body).toBe('{"term":"zzz","resource":""}');
  });

  it('with facets but an empty page, names the targets in the 404 and reports them', async () => {
    reports = [];
    answer = (handler) => {
      if (handler.endsWith('/facet')) return facets(8);
      if (handler.startsWith('/target'))
        return {
          response: {
            numFound: 1,
            docs: [{ identifier: 'BRAF_HUMAN', accessions: ['P15056'], resource: 'UNIPROT' }],
          },
        };
      return grouped([]);
    };
    const response = await get('query?query=P15056&scope=BOTH&Start%20row=900');
    expect([response.status, (await response.json()).targets]).toEqual([
      404,
      [{ term: 'P15056', resource: 'UNIPROT', target: true }],
    ]);
    await until(() => reports.length === 1);
    expect(reports[0].url.split('?')[0]).toBe('/report/search/targets');
  });

  it("is Spring's 400s, and Java's 500 for a blank cluster before Solr is asked", async () => {
    asked = [];
    const missing = await get('query');
    expect(missing.status).toBe(400);
    const parser = await get('query?query=x&parserType=lucene');
    expect((await parser.json()).messages[0]).toMatch(
      /No enum constant org\.reactome\.server\.search\.domain\.ParserType\.lucene$/
    );
    const blank = await get('query?query=x&cluster=%20');
    expect([blank.status, (await blank.json()).messages]).toEqual([
      500,
      ['Something unexpected happened and the error has been reported.'],
    ]);
    expect(asked).toHaveLength(0);
  });
});

describe('/query/paginated', () => {
  it('pages each type by rowCount over the number of types', async () => {
    asked = [];
    answer = (handler) =>
      handler.endsWith('/facet') ? facets(8) : grouped([['Protein', [doc('1', 'TP53')]]]);
    await get('query/paginated?query=TP53&page=3&rowCount=10');
    // Two types: five rows each, from the tenth.
    expect([value(asked[1][1], 'group.offset'), value(asked[1][1], 'group.limit')]).toEqual([
      '10',
      '5',
    ]);
  });

  it("is Java's 400 for a page or row count that is not positive, and Spring's when absent", async () => {
    for (const [query, message] of [
      ['page=0&rowCount=10', 'page should be greater than 0'],
      ['page=1&rowCount=0', 'rowCount should be greater than 0'],
      [
        'rowCount=10',
        "Required request parameter 'page' for method parameter type Integer is not present",
      ],
    ]) {
      const response = await get(`query/paginated?query=x&${query}`);
      expect([query, response.status, (await response.json()).messages]).toEqual([
        query,
        400,
        [message],
      ]);
    }
  });
});
