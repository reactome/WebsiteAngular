// @vitest-environment node
//
// /search/suggest and /search/spellcheck, without a Solr: what is asked of
// it, what is read from its answer, and the checks Spring makes first.
// Java's answers measured on 16 Oct 2026.
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
