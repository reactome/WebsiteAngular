// @vitest-environment node
//
// /search/fireworks -- the species-wide search behind the Pathway Browser's
// "All pathways" results and its FoamTree -- with stand-ins for Solr (both
// the reactome and target cores) and for the report service a search that
// finds nothing is reported to. Java's answers measured 16 Oct 2026.
import { URLSearchParams } from 'node:url';
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';

vi.mock('./graph.mjs', () => ({
  // The release, for the report.
  read: async () => [{ version: 97 }],
  configured: () => true,
  close: async () => {},
  envSetting: (key, fallback = '') => process.env[key] || fallback,
}));

const { app } = await import('./service.mjs');

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
      const sent = [...new URLSearchParams(body)];
      asked.push([request.url.replace('/solr', ''), sent]);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(answer(request.url, sent)));
    });
  });
  reportServer = await listen((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      reports.push({
        url: request.url,
        authorization: request.headers.authorization,
        type: request.headers['content-type'],
        body,
      });
      response.end();
    });
  });
  process.env.SOLR_URL = `http://127.0.0.1:${solrServer.address().port}/solr/reactome`;
  process.env.REPORT_URL = `http://127.0.0.1:${reportServer.address().port}`;
  process.env.REPORT_USER = 'reporter';
  process.env.REPORT_PASSWORD = 'not-a-secret';
  await new Promise((resolve) => {
    server = app().listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  for (const name of ['SOLR_URL', 'REPORT_URL', 'REPORT_USER', 'REPORT_PASSWORD'])
    delete process.env[name];
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => solrServer.close(resolve));
  await new Promise((resolve) => reportServer.close(resolve));
});

const get = (path, headers = {}) =>
  fetch(`${base}/ContentService/search/fireworks${path}`, { headers });
const until = async (ready) => {
  for (let tries = 0; !ready() && tries < 400; tries += 1)
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(ready()).toBe(true);
};
const fqs = (sent) => sent.filter(([name]) => name === 'fq').map(([, value]) => value);

describe('/fireworks, the species-wide search', () => {
  it('asks /fireworks for the species and those without, writing entries with their species', async () => {
    asked = [];
    reports = [];
    answer = () => ({
      response: {
        numFound: 4,
        docs: [{ dbId: '1', stId: 'R-HSA-1', name: 'KNTC1', fireworksSpecies: ['Homo sapiens'] }],
      },
      facet_counts: { facet_fields: { type_facet: ['Protein', 4] } },
    });
    const response = await get(
      '/?query=KNTC1&types=Protein&start=0&rows=30&scope=REFERENCE_ENTITY'
    );
    expect(await response.text()).toBe(
      '{"entries":[{"dbId":"1","stId":"R-HSA-1","id":"R-HSA-1","name":"KNTC1","fireworksSpecies":["Homo sapiens"]}],' +
        '"facets":[{"name":"Protein","count":4}],"found":4}'
    );
    expect(asked).toEqual([
      [
        '/reactome/fireworks',
        [
          ['wt', 'json'],
          ['json.nl', 'flat'],
          ['fq', 'hasReferenceEntity:false'],
          ['fq', 'fireworksSpecies:("Homo sapiens" OR "Entries without species")'],
          ['fq', '{!tag=tf}type_facet:("Protein")'],
          ['start', '0'],
          ['rows', '30'],
          ['q', 'KNTC1'],
        ],
      ],
    ]);
    expect(reports).toHaveLength(0);
  });

  it('finding nothing, is the 404 and reports the search as not found', async () => {
    asked = [];
    reports = [];
    answer = () => ({ response: { numFound: 0, docs: [] } });
    const response = await get('?query=zzz%20qqq', {
      'User-Agent': 'a browser',
      'X-Forwarded-For': '203.0.113.7',
    });
    expect([response.status, await response.json()]).toEqual([
      404,
      {
        code: 404,
        reason: 'NOT_FOUND',
        url: `${base}/ContentService/search/fireworks`,
        messages: ['No entries found for query: zzz qqq'],
        targets: null,
      },
    ]);
    // The target core, with the scope's filter, which it has no field for.
    expect(asked[1]).toEqual([
      '/target/search',
      [
        ['wt', 'json'],
        ['json.nl', 'flat'],
        ['fq', '-isReferenceSummary:true'],
        ['q', 'zzz qqq'],
      ],
    ]);
    await until(() => reports.length === 1);
    const [report] = reports;
    expect(report.url).toBe(
      '/report/search/notfound?releaseNumber=97&ip=203.0.113.7&agent=a+browser'
    );
    expect(report.authorization).toBe(
      `Basic ${Buffer.from('reporter:not-a-secret').toString('base64')}`
    );
    expect(report.type).toBe('application/json');
    expect(report.body).toBe('{"term":"zzz qqq","resource":""}');
  });

  it('names the terms the target core knows, and reports them as targets', async () => {
    asked = [];
    reports = [];
    answer = (url) =>
      url.includes('/target/')
        ? {
            response: {
              numFound: 1,
              docs: [
                {
                  identifier: 'KCJ13_HUMAN',
                  accessions: ['O60928'],
                  geneNames: ['KCNJ13'],
                  resource: 'UNIPROT',
                },
              ],
            },
          }
        : { response: { numFound: 0, docs: [] } };
    const response = await get('?query=kcnj13%20zzz&scope=BOTH');
    const body = await response.json();
    expect(body.targets).toEqual(
      expect.arrayContaining([
        { term: 'kcnj13', resource: 'UNIPROT', target: true },
        { term: 'zzz', resource: 'UNIPROT', target: false },
      ])
    );
    expect(body.targets).toHaveLength(2);
    expect(fqs(asked[1][1])).toEqual([]);
    await until(() => reports.length === 2);
    const byPath = Object.fromEntries(
      reports.map((report) => [report.url.split('?')[0], report.body])
    );
    expect(byPath).toEqual({
      '/report/search/targets': '[{"term":"kcnj13","resource":"UNIPROT"}]',
      // The non-target terms, though the body is the original query, as Java's is.
      '/report/search/notfound': '{"term":"kcnj13 zzz","resource":""}',
    });
  });

  it("is Spring's 400 for a missing query, and Java's 500 for a blank includeInteractors", async () => {
    asked = [];
    const missing = await get('');
    expect(missing.status).toBe(400);
    const blank = await get('?query=x&includeInteractors=%20');
    expect(blank.status).toBe(500);
    expect(asked).toHaveLength(0);
  });
});
