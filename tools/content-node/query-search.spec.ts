// @vitest-environment node
//
// /search/query and /search/query/paginated -- the website's search -- with
// stand-ins for Solr (the reactome and target cores) and the report service:
// search-core's fallback chain, grouped and plain search, paging, and the
// report of a search that finds nothing. Java's answers measured 17 Oct 2026.
import { URLSearchParams } from 'node:url';
import type { RequestListener, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';

vi.mock('./graph.ts', () => ({
  read: async () => [{ version: 97 }],
  configured: () => true,
  close: async () => {},
  envSetting: (key: string, fallback = '') => process.env[key] || fallback,
}));

const { app } = await import('./server.ts');
const { facetQueryParams } = await import('./search-endpoints.ts');

/** A form or query as the service sent it to Solr: name and value, in order. */
type Sent = [string, string][];
let base: string;
let server: Server;
let solrServer: Server;
let reportServer: Server;
/** What the stand-in Solr was asked: its handler, and what it was sent. */
let asked: [string, Sent][];
/** The stand-in Solr's answer to a request. */
let answer: (handler: string, sent: Sent) => unknown;
/** What reached the stand-in report service. */
let reports: { url: string | undefined; body: string }[];

const listen = async (handler: RequestListener) => {
  const { createServer } = await import('node:http');
  const listening = createServer(handler);
  await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
  return listening;
};
const portOf = (listening: Server) => (listening.address() as AddressInfo).port;

beforeAll(async () => {
  solrServer = await listen((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      const [path = '', query = ''] = (request.url ?? '').split('?');
      const sent = [...new URLSearchParams(request.method === 'GET' ? query : body)];
      const handler = path.replace('/solr', '');
      asked.push([handler, sent]);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(answer(handler, sent)));
    });
  });
  reportServer = await listen((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      reports.push({ url: request.url, body });
      response.end();
    });
  });
  process.env['SOLR_URL'] = `http://127.0.0.1:${portOf(solrServer)}/solr/reactome`;
  process.env['REPORT_URL'] = `http://127.0.0.1:${portOf(reportServer)}`;
  await new Promise<void>((resolve) => {
    server = app().listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${portOf(server)}`;
});

afterAll(async () => {
  for (const name of ['SOLR_URL', 'REPORT_URL']) delete process.env[name];
  for (const closing of [server, solrServer, reportServer])
    await new Promise<void>((resolve) => closing.close(() => resolve()));
});

/** The nth request Solr was asked; one not asked is the test's failure. */
const request = (at: number) => {
  const found = asked[at];
  if (!found) throw new Error(`Solr was not asked a request ${at}`);
  return found;
};
/** The nth report sent; one not sent is the test's failure. */
const report = (at: number) => {
  const found = reports[at];
  if (!found) throw new Error(`no report ${at} was sent`);
  return found;
};
const get = (path: string) => fetch(`${base}/ContentService/search/${path}`);
const until = async (ready: () => boolean) => {
  for (let tries = 0; !ready() && tries < 400; tries += 1)
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(ready()).toBe(true);
};
const fqs = (sent: Sent) => sent.filter(([name]) => name === 'fq').map(([, value]) => value);
const value = (sent: Sent, name: string) => sent.find(([key]) => key === name)?.[1];

/** Facets that found `found`, with two types. */
const facets = (found: number) => ({
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
const doc = (id: string, name: string) => ({
  dbId: id,
  stId: `R-HSA-${id}`,
  name,
  type: 'Protein',
  exactType: 'Protein',
});
const grouped = (groups: [string | null, object[]][]) => ({
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
      facetQueryParams({
        query: 'x',
        scope: 'BOTH',
        deleted: true,
        parserType: 'DISMAX',
        // The endpoint fills every list; an absent one reads as empty.
      } as Parameters<typeof facetQueryParams>[0])
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
    const response = await get('query?query=TP53&cluster=true&Start%20row=5&rows=30');
    expect(await response.text()).toBe(
      '{"results":[{"entries":[{"dbId":"1","stId":"R-HSA-1","id":"R-HSA-1","name":"<span class=\\"highlighting\\" >TP53</span>","type":"Protein","exactType":"Protein"}],' +
        '"typeName":"Protein","entriesCount":2,"rowCount":1}],"rowCount":1,"numberOfGroups":2,"numberOfMatches":8}'
    );
    expect(asked.map(([handler]) => handler)).toEqual([
      '/reactome/facet',
      '/reactome/search/grouped',
    ]);
    expect(request(1)[1]).toEqual([
      ['wt', 'json'],
      ['json.nl', 'flat'],
      ['fq', ''],
      ['fq', ''],
      ['fq', ''],
      ['fq', ''],
      ['fq', '-deleted'],
      ['fq', '-isReferenceSummary:true'],
      ['group.offset', '5'],
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
    expect([response.status, ((await response.json()) as { targets: unknown }).targets]).toEqual([
      404,
      null,
    ]);
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
    expect((report(0).url ?? '').split('?')[0]).toBe('/report/search/notfound');
    expect(report(0).body).toBe('{"term":"zzz","resource":""}');
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
    expect([response.status, ((await response.json()) as { targets: unknown }).targets]).toEqual([
      404,
      [{ term: 'P15056', resource: 'UNIPROT', target: true }],
    ]);
    await until(() => reports.length === 1);
    expect((report(0).url ?? '').split('?')[0]).toBe('/report/search/targets');
  });

  it('drops a filter the facets did not select from the search too, unless filters are forced', async () => {
    for (const [forced, calls, type] of [
      ['', 2, ''],
      ['&Force%20filters=true', 1, 'type_facet:("Nope")'],
    ] as const) {
      asked = [];
      answer = (handler) =>
        handler.endsWith('/facet') ? facets(8) : grouped([['Protein', [doc('1', 'TP53')]]]);
      await get(`query?query=TP53&types=Nope${forced}`);
      expect(asked.filter(([handler]) => handler.endsWith('/facet'))).toHaveLength(calls);
      expect(fqs(request(asked.length - 1)[1])[1]).toBe(type);
    }
  });

  it("is Java's 500 for a blank scope with a query, and its 404 without one", async () => {
    answer = (handler) => (handler.endsWith('/facet') ? facets(8) : grouped([]));
    const blank = await get('query?query=TP53&scope=%20');
    expect(blank.status).toBe(500);
    expect(((await blank.json()) as { messages: string[] }).messages).toEqual([
      'Something unexpected happened and the error has been reported.',
    ]);
    answer = () => ({ response: { numFound: 0, docs: [] } });
    const empty = await get('query?query=&scope=%20');
    expect(empty.status).toBe(404);
  });

  it('found only by the fallback, pages with no rows -- the 404 and a report, as Java', async () => {
    asked = [];
    reports = [];
    let facetCalls = 0;
    answer = (handler) => {
      // As given and as corrected: nothing; rebuilt without filters: found.
      if (handler.endsWith('/facet')) return facets((facetCalls += 1) <= 2 ? 0 : 8);
      if (handler.startsWith('/target')) return { response: { numFound: 0, docs: [] } };
      return grouped([]);
    };
    const response = await get('query?query=TP53&species=Nowhere');
    expect(response.status).toBe(404);
    const search = asked.find(([handler]) => handler.endsWith('/search/grouped'));
    if (!search) throw new Error('the grouped search was not asked');
    expect([value(search[1], 'group.offset'), value(search[1], 'group.limit')]).toEqual(['0', '0']);
    await until(() => reports.length === 1);
  });

  it('a plain search with an empty page is a 200 naming the targets, a null resource left out', async () => {
    reports = [];
    answer = (handler) => {
      if (handler.endsWith('/facet')) return facets(8);
      if (handler.startsWith('/target'))
        return {
          response: { numFound: 1, docs: [{ identifier: 'TP53_HUMAN', accessions: ['P04637'] }] },
        };
      return { response: { numFound: 8, docs: [] } };
    };
    const response = await get('query?query=P04637&cluster=false&Start%20row=900&scope=BOTH');
    expect(await response.text()).toBe(
      '{"results":[{"typeName":"Results","entriesCount":8,"rowCount":0}],"rowCount":0,"numberOfGroups":1,"numberOfMatches":8,' +
        '"targetResults":[{"term":"P04637","target":true}]}'
    );
    await until(() => reports.length === 1);
  });

  it('leaves out an empty term in a 200, as NON_EMPTY does', async () => {
    answer = (handler) => {
      if (handler.endsWith('/facet')) return facets(8);
      if (handler.startsWith('/target'))
        return {
          response: {
            numFound: 1,
            docs: [{ identifier: 'TP53_HUMAN', accessions: ['P04637'], resource: 'UNIPROT' }],
          },
        };
      return { response: { numFound: 8, docs: [] } };
    };
    const body = (await (
      await get('query?query=%20P04637&cluster=false&Start%20row=900&scope=BOTH')
    ).json()) as { targetResults: unknown };
    // In the order Java's HashSet writes them, not merely both present.
    expect(body.targetResults).toEqual([
      { term: 'P04637', resource: 'UNIPROT', target: true },
      { resource: 'UNIPROT', target: false },
    ]);
  });

  it("is Java's 500 when Solr's grouped answer has no grouping", async () => {
    answer = (handler) =>
      handler.endsWith('/facet') ? facets(8) : { response: { numFound: 0, docs: [] } };
    const response = await get('query?query=TP53');
    expect(response.status).toBe(500);
    expect(((await response.json()) as { messages: string[] }).messages).toEqual([
      'Something unexpected happened and the error has been reported.',
    ]);
  });

  it("is Java's 500 for a grouping without its count of groups or of matches", async () => {
    // SolrJ unboxes both; a missing one is its NullPointerException.
    for (const missing of ['ngroups', 'matches']) {
      answer = (handler) => {
        if (handler.endsWith('/facet')) return facets(8);
        const solr = grouped([['Protein', [doc('1', 'TP53')]]]);
        delete (solr.grouped.type_facet as Record<string, unknown>)[missing];
        return solr;
      };
      const response = await get('query?query=TP53');
      expect(response.status, missing).toBe(500);
      expect(((await response.json()) as { messages: string[] }).messages).toEqual([
        'Something unexpected happened and the error has been reported.',
      ]);
    }
  });

  it('leaves out the type of a group with none', async () => {
    answer = (handler) =>
      handler.endsWith('/facet') ? facets(8) : grouped([[null, [doc('1', 'TP53')]]]);
    const body = (await (await get('query?query=TP53')).json()) as { results: object[] };
    expect(Object.keys(body.results[0] ?? {})).toEqual(['entries', 'entriesCount', 'rowCount']);
  });

  it("is Spring's 400s, and Java's 500 for a blank cluster before Solr is asked", async () => {
    asked = [];
    const missing = await get('query');
    expect(missing.status).toBe(400);
    const parser = await get('query?query=x&parserType=lucene');
    expect(((await parser.json()) as { messages: string[] }).messages[0]).toMatch(
      /No enum constant org\.reactome\.server\.search\.domain\.ParserType\.lucene$/
    );
    const blank = await get('query?query=x&cluster=%20');
    expect([blank.status, ((await blank.json()) as { messages: string[] }).messages]).toEqual([
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
    expect([value(request(1)[1], 'group.offset'), value(request(1)[1], 'group.limit')]).toEqual([
      '10',
      '5',
    ]);
  });

  it("is Java's 404 for an empty query with a blank scope, as /query is", async () => {
    answer = () => ({ response: { numFound: 0, docs: [] } });
    const response = await get('query/paginated?query=&page=1&rowCount=10&scope=%20');
    expect(response.status).toBe(404);
  });

  it("with no types to page by and an empty page, reports first, then is Java's 500", async () => {
    reports = [];
    answer = (handler) => {
      if (handler.endsWith('/facet'))
        return {
          ...facets(8),
          facet_counts: {
            facet_fields: { ...facets(8).facet_counts.facet_fields, type_facet: [] },
          },
        };
      if (handler.startsWith('/target')) return { response: { numFound: 0, docs: [] } };
      return grouped([]);
    };
    const response = await get('query/paginated?query=TP53&page=1&rowCount=10');
    expect(response.status).toBe(500);
    expect(((await response.json()) as { messages: string[] }).messages).toEqual([
      'Something unexpected happened and the error has been reported.',
    ]);
    // This search's own report, not a late one from the test before.
    await until(() => reports.some((report) => report.body === '{"term":"TP53","resource":""}'));
  });

  it("is Java's 500 when there are no types to page by", async () => {
    answer = (handler) =>
      handler.endsWith('/facet')
        ? {
            ...facets(8),
            facet_counts: {
              facet_fields: { ...facets(8).facet_counts.facet_fields, type_facet: [] },
            },
          }
        : grouped([['Protein', [doc('1', 'TP53')]]]);
    const response = await get('query/paginated?query=TP53&page=1&rowCount=10');
    expect(response.status).toBe(500);
    expect(((await response.json()) as { messages: string[] }).messages).toEqual([
      'Something unexpected happened and the error has been reported.',
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
    ] as const) {
      const response = await get(`query/paginated?query=x&${query}`);
      expect([
        query,
        response.status,
        ((await response.json()) as { messages: string[] }).messages,
      ]).toEqual([query, 400, [message]]);
    }
  });
});
