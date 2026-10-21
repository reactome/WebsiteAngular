// @vitest-environment node
//
// /search/suggest and /search/spellcheck, without a Solr: what is asked of
// it, what is read from its answer, and the checks Spring makes first.
// Java's answers measured on 16 Oct 2026.
import { URLSearchParams } from 'node:url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { app } from './service.ts';
import { collations, facetMapping, suggestionsFrom } from './search-endpoints.ts';
import { solr, queued } from './solr.ts';

let base;
let server;

/**
 * Until `ready()` holds, checking every 5ms for up to two seconds -- well
 * inside the test's own five, so a condition never met fails here, saying so.
 */
async function until(ready) {
  for (let tries = 0; !ready() && tries < 400; tries += 1)
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(ready()).toBe(true);
}

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

describe('facetMapping, as SolrConverter.getFacetMap builds it', () => {
  const answer = (fields, numFound = 7) => ({
    response: { numFound },
    facet_counts: { facet_queries: {}, facet_fields: fields },
  });

  it("writes Java's fields in Jackson's order, whatever order Solr gives", () => {
    const mapping = facetMapping(
      answer({
        compartment_facet: ['cytosol', 3],
        type_facet: ['Protein', 5, 'Complex', 2],
        species_facet: ['Homo sapiens', 6],
        keywords_facet: ['Transport', 1],
      })
    );
    expect(JSON.stringify(mapping)).toBe(
      '{"totalNumFount":7,' +
        '"speciesFacet":{"available":[{"name":"Homo sapiens","count":6}]},' +
        '"typeFacet":{"available":[{"name":"Protein","count":5},{"name":"Complex","count":2}]},' +
        '"keywordFacet":{"available":[{"name":"Transport","count":1}]},' +
        '"compartmentFacet":{"available":[{"name":"cytosol","count":3}]}}'
    );
  });

  it('leaves out what NON_EMPTY leaves out: an empty list, a null or empty name', () => {
    expect(
      JSON.stringify(
        facetMapping(answer({ iconCategories_facet: [], species_facet: [null, 4, '', 2] }))
      )
    ).toBe(
      '{"totalNumFount":7,"speciesFacet":{"available":[{"count":4},{"count":2}]},"iconCategoriesFacet":{}}'
    );
  });

  it("is Java's null when Solr gives no facet fields", () => {
    expect(facetMapping(answer({}))).toBe(undefined);
    expect(facetMapping({ response: { numFound: 0 } })).toBe(undefined);
  });

  it('fails, as Java does, on a facet field it has no place for', () => {
    expect(() => facetMapping(answer({ unknown_facet: ['x', 1] }))).toThrow();
  });
});

describe('suggestionsFrom, the collations that find something', () => {
  it('asks the handler with spellcheck.q, then /exists for each, keeping order', async () => {
    const asked = [];
    const ask = async (handler, params, options) => {
      asked.push([handler, params, options]);
      if (handler === '/suggest')
        return {
          spellcheck: { collations: ['collation', 'a', 'collation', 'b', 'collation', 'c'] },
        };
      const q = params.find(([name]) => name === 'q')[1];
      return { response: { numFound: q === 'b' ? 0 : 2 } };
    };
    expect(await suggestionsFrom('/suggest', 'x', ask)).toEqual(['a', 'c']);
    expect(asked[0]).toEqual(['/suggest', [['spellcheck.q', 'x']], { signal: undefined }]);
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

  it('authenticates when a user is set, and not otherwise, as Java does', async () => {
    useSolr();
    const sent = [];
    answer = (request, _params, response) => {
      sent.push(request.headers.authorization);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(collationsOf([])));
    };
    await fetch(`${base}/ContentService/search/suggest?query=x`);
    process.env.SOLR_USER = '';
    process.env.SOLR_PASSWORD = '';
    try {
      await fetch(`${base}/ContentService/search/suggest?query=x`);
    } finally {
      process.env.SOLR_USER = 'reader';
      process.env.SOLR_PASSWORD = 'not-a-secret';
    }
    expect(sent).toEqual([
      `Basic ${Buffer.from('reader:not-a-secret').toString('base64')}`,
      undefined,
    ]);
  });

  it('refuses a user without a password, before asking Solr', async () => {
    useSolr();
    let reached = false;
    answer = (_request, _params, response) => {
      reached = true;
      response.end('{}');
    };
    process.env.SOLR_PASSWORD = '';
    try {
      const response = await fetch(`${base}/ContentService/search/suggest?query=x`);
      expect(response.status).toBe(500);
      const health = await (await fetch(`${base}/health`)).json();
      expect(health.solr).toBe(false);
    } finally {
      process.env.SOLR_PASSWORD = 'not-a-secret';
    }
    expect(reached).toBe(false);
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

  it('refuses past 64 waiting with a 503 to retry, and serves the rest', async () => {
    useSolr();
    const held = [];
    answer = (_request, _params, response) => held.push(response);
    const settled = [];
    const pending = Array.from({ length: 70 }, () =>
      fetch(`${base}/ContentService/search/suggest?query=x`).then(async (response) => {
        const answered = [
          response.status,
          response.headers.get('retry-after'),
          (await response.json()).reason,
        ];
        settled.push(answered);
        return answered;
      })
    );
    // Two at Solr, sixty-four waiting; the other four are refused at once.
    await until(() => settled.length === 4 && held.length === 2);
    expect(settled).toEqual(Array(4).fill([503, '5', 'SERVICE_UNAVAILABLE']));

    const release = (response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(collationsOf([])));
    };
    answer = (_request, _params, response) => release(response);
    held.splice(0).forEach(release);
    const answers = await Promise.all(pending);
    expect(answers.filter(([status]) => status === 200)).toHaveLength(66);
  });

  it('a waiter whose caller gives up leaves the queue and never reaches Solr', async () => {
    useSolr();
    const held = [];
    let arrived = 0;
    answer = (_request, _params, response) => {
      arrived += 1;
      held.push(response);
    };
    const busy = [solr('/exists', [['q', 'a']]), solr('/exists', [['q', 'b']])];
    await until(() => held.length === 2);
    const caller = new AbortController();
    const waiter = solr('/exists', [['q', 'c']], { signal: caller.signal });
    caller.abort();
    await expect(waiter).rejects.toThrow();
    held.splice(0).forEach((response) => response.end('{"response":{"numFound":0}}'));
    await Promise.all(busy);
    expect(arrived).toBe(2);
    // Both slots are free again: the one given up was not handed a slot.
    const again = [solr('/exists', [['q', 'd']]), solr('/exists', [['q', 'e']])];
    await until(() => held.length === 2);
    held.splice(0).forEach((response) => response.end('{"response":{"numFound":0}}'));
    await Promise.all(again);
  });

  it('a client that disconnects takes its queued call with it', async () => {
    useSolr();
    const held = [];
    let arrived = 0;
    answer = (_request, _params, response) => {
      arrived += 1;
      held.push(response);
    };
    const busy = [solr('/exists', [['q', 'a']]), solr('/exists', [['q', 'b']])];
    await until(() => held.length === 2);
    const client = new AbortController();
    const asked = fetch(`${base}/ContentService/search/suggest?query=x`, {
      signal: client.signal,
    }).catch(() => 'gone');
    await until(() => queued() === 1);
    client.abort();
    expect(await asked).toBe('gone');
    await until(() => queued() === 0);
    held.splice(0).forEach((response) => response.end('{"response":{"numFound":0}}'));
    await Promise.all(busy);
    // Anything still owed a slot would be asked now; give it the chance.
    const after = solr('/exists', [['q', 'f']]);
    await until(() => held.length === 1);
    held.splice(0).forEach((response) => response.end('{"response":{"numFound":0}}'));
    await after;
    expect(arrived).toBe(3);
  });

  for (const [route, handler, params] of [
    [
      'facet',
      '/facetall',
      [
        ['q', '*:*'],
        ['fq', 'hasReferenceEntity:false'],
      ],
    ],
    ['icon/facet', '/icon/facet', [['q', '{!term f=type}icon']]],
  ])
    it(`/${route} asks ${handler} as search-core does, and writes its FacetMapping`, async () => {
      useSolr();
      const asked = [];
      answer = (request, sent, response) => {
        asked.push([request.url, [...sent]]);
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            response: { numFound: 9 },
            facet_counts: { facet_fields: { type_facet: ['Protein', 9] } },
          })
        );
      };
      // Java's methods take no parameters: any given are not passed on.
      const response = await fetch(`${base}/ContentService/search/${route}?query=x&species=y`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(await response.text()).toBe(
        '{"totalNumFount":9,"typeFacet":{"available":[{"name":"Protein","count":9}]}}'
      );
      expect(asked).toEqual([
        [`/solr/reactome${handler}`, [['wt', 'json'], ['json.nl', 'flat'], ...params]],
      ]);
    });

  it("/facet with no facet fields from Solr is Java's empty 200", async () => {
    useSolr();
    answer = (_request, _sent, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({ response: { numFound: 0 }, facet_counts: { facet_fields: {} } })
      );
    };
    const response = await fetch(`${base}/ContentService/search/facet`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.headers.get('content-type')).toBe(null);
  });

  it("/icon/facet with Solr failing is Java's 500 envelope", async () => {
    useSolr();
    answer = (_request, _sent, response) => {
      response.statusCode = 503;
      response.end('{}');
    };
    const response = await fetch(`${base}/ContentService/search/icon/facet`);
    expect(response.status).toBe(500);
    expect((await response.json()).reason).toBe('INTERNAL_SERVER_ERROR');
  });
});
