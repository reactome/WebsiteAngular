// @vitest-environment node
//
// /search/fireworks -- the species-wide search behind the Pathway Browser's
// "All pathways" results and its FoamTree -- with stand-ins for Solr (both
// the reactome and target cores) and for the report service a search that
// finds nothing is reported to. Java's answers measured 16 Oct 2026.
import { URLSearchParams } from 'node:url';
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';

vi.mock('./graph.mjs', () => ({
  // The release, for the report -- or the graph down, when a test says so.
  read: async () => {
    if (globalThis.graphDown) throw new Error('graph down');
    return [{ version: 97 }];
  },
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
let hanging = false;

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
      // A GET carries its parameters in the URL, a POST in its body.
      const [path, query = ''] = request.url.split('?');
      const sent = [...new URLSearchParams(request.method === 'GET' ? query : body)];
      asked.push([`${request.method} ${path.replace('/solr', '')}`, sent]);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(answer(request.url, sent)));
    });
  });
  reportServer = await listen((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      reports.push({
        url: request.url,
        authorization: request.headers.authorization,
        type: request.headers['content-type'],
        bytes: Buffer.concat(chunks),
        body: Buffer.concat(chunks).toString('latin1'),
      });
      // A report service that never answers, for the test that says so.
      if (!hanging) response.end();
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
        'POST /reactome/fireworks',
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
      'GET /target/search',
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

  it('names the terms the target core knows, in their HashSet order, and reports the targets', async () => {
    asked = [];
    reports = [];
    // BRAF and VHL fall in buckets 10 and 11 by String.hashCode, 11 and 8 by
    // Objects.hash, a TargetResult's: so VHL first, then BRAF.
    answer = (url) =>
      url.includes('/target/')
        ? {
            response: {
              numFound: 2,
              docs: [
                {
                  identifier: 'MD2L1_HUMAN',
                  accessions: ['Q13257'],
                  geneNames: ['MAD2L1'],
                  resource: 'UNIPROT',
                },
                {
                  identifier: 'BRAF_HUMAN',
                  accessions: ['P15056'],
                  geneNames: ['braf'],
                  resource: 'UNIPROT',
                },
              ],
            },
          }
        : { response: { numFound: 0, docs: [] } };
    const response = await get('?query=BRAF%20VHL&scope=BOTH');
    expect(response.status).toBe(404);
    expect(await response.text()).toBe(
      `{"code":404,"reason":"NOT_FOUND","url":"${base}/ContentService/search/fireworks",` +
        '"messages":["No entries found for query: BRAF VHL"],' +
        '"targets":[{"term":"VHL","resource":"UNIPROT","target":false},{"term":"BRAF","resource":"UNIPROT","target":true}]}'
    );
    expect(fqs(asked[1][1])).toEqual([]);
    await until(() => reports.length === 2);
    const byPath = Object.fromEntries(
      reports.map((report) => [report.url.split('?')[0], report.body])
    );
    expect(byPath).toEqual({
      '/report/search/targets': '[{"term":"BRAF","resource":"UNIPROT"}]',
      // The non-target terms, though the body is the original query, as Java's is.
      '/report/search/notfound': '{"term":"BRAF VHL","resource":""}',
    });
  });

  it("sends the report as Java's StringEntity does: Latin-1, '?' past it, and a bare name for no agent", async () => {
    reports = [];
    answer = () => ({ response: { numFound: 0, docs: [] } });
    // No User-Agent at all -- fetch always sends one -- is Java's null agent.
    const { request: send } = await import('node:http');
    await new Promise((resolve) =>
      send(`${base}/ContentService/search/fireworks?query=caf%C3%A9%20%F0%9F%98%80`, (response) => {
        response.resume();
        response.on('end', resolve);
      }).end()
    );
    await until(() => reports.length === 1);
    expect([...reports[0].bytes]).toEqual([
      ...Buffer.from('{"term":"café ?","resource":""}', 'latin1'),
    ]);
    expect(reports[0].url).toMatch(/&agent$/);
  });

  it('answers without waiting on a report service that never answers', async () => {
    reports = [];
    hanging = true;
    answer = () => ({ response: { numFound: 0, docs: [] } });
    try {
      const started = Date.now();
      const response = await get('?query=zzz');
      expect(response.status).toBe(404);
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      hanging = false;
    }
  });

  it("is Java's NullPointerException, and no report, for a target without an identifier", async () => {
    reports = [];
    answer = (url) =>
      url.includes('/target/')
        ? { response: { numFound: 1, docs: [{ accessions: ['P1'], resource: 'UNIPROT' }] } }
        : { response: { numFound: 0, docs: [] } };
    const response = await get('?query=x&scope=BOTH');
    expect([response.status, (await response.json()).messages]).toEqual([
      500,
      ['Something unexpected happened and the error has been reported.'],
    ]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reports.filter((report) => report.body.includes('"term":"x"'))).toHaveLength(0);
  });

  it('writes the agent and address as URIBuilder does, and control escapes as Jackson does', async () => {
    reports = [];
    answer = () => ({ response: { numFound: 0, docs: [] } });
    await get('?query=a%1Fb', { 'User-Agent': 'x*y~z' });
    await until(() => reports.length === 1);
    expect(reports[0].url).toMatch(/&agent=x\*y%7Ez$/);
    expect(reports[0].body).toBe('{"term":"a\\u001Fb","resource":""}');
  });

  it("authenticates with Java's default credentials when none are set", async () => {
    reports = [];
    answer = () => ({ response: { numFound: 0, docs: [] } });
    delete process.env.REPORT_USER;
    delete process.env.REPORT_PASSWORD;
    try {
      await get('?query=zzz');
      await until(() => reports.length === 1);
    } finally {
      process.env.REPORT_USER = 'reporter';
      process.env.REPORT_PASSWORD = 'not-a-secret';
    }
    expect(reports[0].authorization).toBe(
      `Basic ${Buffer.from('default:default').toString('base64')}`
    );
  });

  it('finds results without the graph: the release is read only to report', async () => {
    answer = () => ({ response: { numFound: 1, docs: [{ dbId: '1' }] } });
    globalThis.graphDown = true;
    try {
      const response = await get('?query=KNTC1');
      expect(response.status).toBe(200);
    } finally {
      globalThis.graphDown = false;
    }
  });

  it("is Java's NullPointerException for a target without accessions", async () => {
    answer = (url) =>
      url.includes('/target/')
        ? { response: { numFound: 1, docs: [{ identifier: 'X_HUMAN', resource: 'UNIPROT' }] } }
        : { response: { numFound: 0, docs: [] } };
    const response = await get('?query=x&scope=BOTH');
    expect(response.status).toBe(500);
  });

  it('reports the targets in the fresh HashSet Collectors.toSet() makes', async () => {
    reports = [];
    // Thirteen terms grow the set past sixteen buckets, where AC comes before
    // AR (buckets 1, 16); a fresh set of sixteen puts AR first (0, 1).
    const fillers = Array.from({ length: 11 }, (_, at) => `F${at}`);
    answer = (url) =>
      url.includes('/target/')
        ? {
            response: {
              numFound: 1,
              docs: [{ identifier: 'Q_HUMAN', accessions: ['AC', 'AR'], resource: 'UNIPROT' }],
            },
          }
        : { response: { numFound: 0, docs: [] } };
    await get(`?query=${['AC', 'AR', ...fillers].join('%20')}&scope=BOTH`);
    await until(() => reports.length === 2);
    const targets = reports.find((report) => report.url.startsWith('/report/search/targets'));
    expect(targets.body).toBe(
      '[{"term":"AR","resource":"UNIPROT"},{"term":"AC","resource":"UNIPROT"}]'
    );
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
