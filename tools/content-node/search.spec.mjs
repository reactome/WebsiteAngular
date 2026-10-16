// @vitest-environment node
//
// /search/suggest and /search/spellcheck, without a Solr: what is asked of
// it, what is read from its answer, and the checks Spring makes first.
// Java's answers measured on 16 Oct 2026.
import { URLSearchParams } from 'node:url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { app, collations, suggestionsFrom } from './service.mjs';

let base;
let server;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app().listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('collations, as SolrJ reads them', () => {
  it('reads the flat collation list, strings or extended objects', () => {
    expect(
      collations({
        spellcheck: { collations: ['collation', 'apoptosis', 'collation', 'apoptotic'] },
      })
    ).toEqual(['apoptosis', 'apoptotic']);
    expect(
      collations({
        spellcheck: { collations: ['collation', { collationQuery: 'tp53', hits: 3 }] },
      })
    ).toEqual(['tp53']);
    expect(collations({})).toEqual([]);
  });
});

describe('suggestionsFrom, the collations that find something', () => {
  it('asks the handler with spellcheck.q, then /exists for each, keeping order', async () => {
    const asked = [];
    const ask = async (handler, params) => {
      asked.push([handler, params]);
      if (handler === '/suggest')
        return {
          spellcheck: { collations: ['collation', 'a', 'collation', 'b', 'collation', 'c'] },
        };
      const q = params.find(([name]) => name === 'q')[1];
      return { response: { numFound: q === 'b' ? 0 : 2 } };
    };
    expect(await suggestionsFrom('/suggest', 'x', ask)).toEqual(['a', 'c']);
    expect(asked[0]).toEqual(['/suggest', [['spellcheck.q', 'x']]]);
    expect(asked.slice(1).map(([handler]) => handler)).toEqual(['/exists', '/exists', '/exists']);
  });
});

describe('the suggest and spellcheck endpoints, before Solr', () => {
  for (const route of ['suggest', 'spellcheck']) {
    it(`/${route} without a query is Spring's 400`, async () => {
      const response = await fetch(`${base}/ContentService/search/${route}`);
      expect(response.status).toBe(400);
      expect((await response.json()).messages).toEqual([
        "Required request parameter 'query' for method parameter type String is not present",
      ]);
    });

    it(`/${route} with an empty query is Java's empty 200`, async () => {
      const response = await fetch(`${base}/ContentService/search/${route}?query=`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('');
      expect(response.headers.get('content-type')).toBe(null);
    });
  }
});

describe('the suggest endpoint, against a stand-in Solr', () => {
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
      request.on('end', () => answer(request, new URLSearchParams(body), response));
    });
    await new Promise((resolve) => solrServer.listen(0, '127.0.0.1', resolve));
    for (const name of names) saved[name] = process.env[name];
    process.env.SOLR_USER = 'reader';
    process.env.SOLR_PASSWORD = 'not-a-secret';
  });

  afterAll(async () => {
    for (const name of names)
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    await new Promise((resolve) => solrServer.close(resolve));
  });

  const useSolr = () =>
    (process.env.SOLR_URL = `http://127.0.0.1:${solrServer.address().port}/solr/reactome`);
  const collationsOf = (values) => ({
    spellcheck: { collations: values.flatMap((value) => ['collation', value]) },
  });

  it('sends a repeated query joined with commas, as Spring does, and pins the JSON layout', async () => {
    useSolr();
    asked = [];
    answer = (request, params, response) => {
      asked.push([request.url, Object.fromEntries(params)]);
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify(
          request.url.endsWith('/suggest') ? collationsOf(['a,b']) : { response: { numFound: 1 } }
        )
      );
    };
    const response = await fetch(`${base}/ContentService/search/suggest?query=a&query=b`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(['a,b']);
    expect(asked[0]).toEqual([
      '/solr/reactome/suggest',
      { wt: 'json', 'json.nl': 'flat', 'spellcheck.q': 'a,b' },
    ]);
  });

  it("answers a failing Solr with Java's 500 envelope, not text", async () => {
    useSolr();
    answer = (_request, _params, response) => {
      response.statusCode = 500;
      response.end('{}');
    };
    const response = await fetch(`${base}/ContentService/search/spellcheck?query=x`);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe(500);
    expect(body.reason).toBe('INTERNAL_SERVER_ERROR');
  });

  it('never repeats credentials written into SOLR_URL', async () => {
    process.env.SOLR_URL = `http://someone:hunter2@127.0.0.1:${solrServer.address().port}/solr/reactome`;
    const logged = [];
    const error = console.error;
    console.error = (...line) => logged.push(line.join(' '));
    try {
      const response = await fetch(`${base}/ContentService/search/suggest?query=x`);
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('hunter2');
    } finally {
      console.error = error;
    }
    expect(logged.join('\n')).not.toContain('hunter2');
    expect(logged.join('\n')).toContain('SOLR_URL');
  });

  it('asks Solr at most SOLR_CONCURRENCY at a time', async () => {
    useSolr();
    let open = 0;
    let most = 0;
    answer = (request, _params, response) => {
      open += 1;
      most = Math.max(most, open);
      setTimeout(() => {
        open -= 1;
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify(
            request.url.endsWith('/suggest')
              ? collationsOf(['a', 'b'])
              : { response: { numFound: 1 } }
          )
        );
      }, 20);
    };
    const answers = await Promise.all(
      Array.from({ length: 8 }, () => fetch(`${base}/ContentService/search/suggest?query=x`))
    );
    expect(answers.map((response) => response.status)).toEqual(Array(8).fill(200));
    expect(most).toBe(2);
  });
});
