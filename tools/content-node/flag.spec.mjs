// @vitest-environment node
//
// /search/diagram/{pathwayId}/flag and /search/fireworks/flag, with stand-ins
// for the graph and Solr: what content-service's SearchManager asks Solr,
// how it folds the answer, and Java's errors. Measured 16 Oct 2026.
import { URLSearchParams } from 'node:url';
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';

const objects = {
  'R-HSA-446203': { labels: ['Pathway', 'Event', 'DatabaseObject'], hasDiagram: true },
};
const species = {
  Twice: [
    { dbId: 1, displayName: 'Twice', abbreviation: 'TWA' },
    { dbId: 2, displayName: 'Twice', abbreviation: 'TWB' },
  ],
  'Homo sapiens': { dbId: 48887, displayName: 'Homo sapiens', abbreviation: 'HSA' },
  'Mus musculus': { dbId: 48892, displayName: 'Mus musculus', abbreviation: 'MMU' },
};

vi.mock('./graph.mjs', () => ({
  read: async (cypher, params) => {
    if (cypher.includes(':Species')) return [species[params.name] ?? []].flat();
    return objects[params.id] ? [objects[params.id]] : [];
  },
  configured: () => true,
  close: async () => {},
  envSetting: (key, fallback = '') => process.env[key] || fallback,
}));

const { app, JavaHashMap } = await import('./service.mjs');

let base;
let server;
let solrServer;
let asked;
let answer;

beforeAll(async () => {
  const { createServer } = await import('node:http');
  solrServer = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const sent = [...new URLSearchParams(body)];
      asked.push([request.url.replace('/solr/reactome', ''), sent]);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(answer(sent)));
    });
  });
  await new Promise((resolve) => solrServer.listen(0, '127.0.0.1', resolve));
  process.env.SOLR_URL = `http://127.0.0.1:${solrServer.address().port}/solr/reactome`;
  await new Promise((resolve) => {
    server = app().listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  delete process.env.SOLR_URL;
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => solrServer.close(resolve));
});

const get = (path) => fetch(`${base}/ContentService/search/${path}`);
/** A java.util.HashSet's order for these keys, added in this order. */
const hashSet = (keys) => {
  const map = new JavaHashMap();
  for (const key of keys) map.set(key, true);
  return [...map.keys()];
};

describe('JavaHashMap.delete, as HashSet.remove', () => {
  it('unlinks a key and keeps the rest in order', () => {
    const map = new JavaHashMap();
    for (const key of ['q', 'a', 'b']) map.set(key, true);
    map.delete('q');
    map.delete('missing');
    expect([...map.keys()]).toEqual(['a', 'b']);
    expect(map.size).toBe(2);
  });

  it('refuses to remove from a tree bin, whose rebalancing it does not port, rather than corrupt it', () => {
    // Strings of "Aa" and "BB" share a hash; sixteen of them, past 64 buckets, make a tree bin.
    const map = new JavaHashMap();
    for (let at = 0; at < 60; at += 1) map.set(`filler${at}`, true);
    const colliding = [];
    for (let bits = 0; bits < 16; bits += 1)
      colliding.push([0, 1, 2, 3].map((bit) => (bits & (1 << bit) ? 'BB' : 'Aa')).join(''));
    for (const key of colliding) map.set(key, true);
    expect(() => map.delete(colliding[3])).toThrow(/tree bin/);
    expect(map.delete('filler7')).toBe(true);
  });
});

describe('/diagram/{pathwayId}/flag', () => {
  it('asks /diagrams/flagging for the term in the pathway, folding every occurrence in', async () => {
    asked = [];
    answer = () => ({
      response: {
        numFound: 2,
        docs: [
          {
            stId: 'R-HSA-9',
            occurrences: ['R-HSA-446203:true:R-HSA-4085001:#', 'R-HSA-1:true:R-HSA-2:#'],
          },
          { stId: 'R-HSA-8', occurrences: ['R-HSA-446203:false:R-HSA-8853383:R-HSA-5'] },
        ],
      },
    });
    const response = await get('diagram/R-HSA-446203/flag?query=CTSA');
    expect(await response.json()).toEqual({
      occurrences: hashSet(['R-HSA-9', 'R-HSA-4085001', 'R-HSA-8853383']),
      interactsWith: ['R-HSA-5'],
    });
    expect(asked).toEqual([
      [
        '/diagrams/flagging',
        [
          ['wt', 'json'],
          ['json.nl', 'flat'],
          ['q', '"CTSA" AND occurrences:R-HSA-446203*'],
          ['fl', 'occurrences,stId'],
          ['rows', '100'],
        ],
      ],
    ]);
  });

  it('flags through interactors when asked, and is the 404 for nothing', async () => {
    asked = [];
    answer = () => ({ response: { numFound: 0, docs: [] } });
    const response = await get('diagram/R-HSA-446203/flag?query=zzz&includeInteractors=true');
    expect([response.status, (await response.json()).messages]).toEqual([
      404,
      ["No entities with identifier 'zzz' found for R-HSA-446203"],
    ]);
    expect(asked[0][1].find(([name]) => name === 'q')).toEqual([
      'q',
      '"zzz" AND occurrencesWithInteractor:R-HSA-446203*',
    ]);
  });

  it("checks the pathway first, then a blank includeInteractors is Java's 500", async () => {
    asked = [];
    const bad = await get('diagram/xyz/flag?query=CTSA&includeInteractors=%20');
    expect([bad.status, (await bad.json()).messages]).toEqual([400, ["'xyz' cannot be found"]]);
    const blank = await get('diagram/R-HSA-446203/flag?query=CTSA&includeInteractors=%20');
    expect(blank.status).toBe(500);
    expect(asked).toHaveLength(0);
  });
});

describe('/fireworks/flag', () => {
  it("keeps the species' lower-level pathways and diagrams with interactors, less the pathways", async () => {
    asked = [];
    answer = () => ({
      response: {
        numFound: 2,
        docs: [
          {
            llps: ['R-HSA-141444', 'R-MMU-141444', 'R-HSA-69242'],
            occurrences: [
              'R-HSA-69242:true:#:R-HSA-1',
              'R-HSA-77:false:#:R-HSA-2',
              'R-HSA-88:false:x:#',
            ],
          },
        ],
      },
    });
    const response = await get('fireworks/flag?query=KNTC1');
    expect(await response.json()).toEqual({
      llps: hashSet(
        hashSet(['R-HSA-141444', 'R-MMU-141444', 'R-HSA-69242']).filter((id) =>
          id.startsWith('R-HSA')
        )
      ),
      interactsWith: ['R-HSA-77'],
    });
    expect(asked).toEqual([
      [
        '/fireworks/flagging',
        [
          ['wt', 'json'],
          ['json.nl', 'flat'],
          ['fl', 'llps,occurrences'],
          ['q', 'KNTC1'],
          ['fq', 'fireworksSpecies:("Homo sapiens" OR "Entries without species")'],
          ['rows', '100'],
        ],
      ],
    ]);
  });

  it("is Java's 400 for a species no Species is named, matched exactly", async () => {
    asked = [];
    const response = await get('fireworks/flag?query=PTEN&species=homo%20sapiens');
    expect([response.status, (await response.json()).messages]).toEqual([
      400,
      ["No species found for 'homo sapiens'"],
    ]);
    expect(asked).toHaveLength(0);
  });

  it("is the 404 naming the Species as Java's toString writes it", async () => {
    answer = () => ({ response: { numFound: 1, docs: [{ llps: ['R-HSA-1'] }] } });
    const response = await get('fireworks/flag?query=x&species=Mus%20musculus');
    expect([response.status, (await response.json()).messages]).toEqual([
      404,
      [
        "No entries found for query: 'x' in species 'Species {dbId=48892, displayName='Mus musculus'}'",
      ],
    ]);
  });

  it("is Java's failure, not a guess, when two Species share the name", async () => {
    asked = [];
    const response = await get('fireworks/flag?query=x&species=Twice');
    expect(response.status).toBe(500);
    expect(asked).toHaveLength(0);
  });
});
