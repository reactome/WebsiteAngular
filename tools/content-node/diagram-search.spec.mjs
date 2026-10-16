// @vitest-environment node
//
// /search/diagram/{diagram}, its occurrences and its summary, with stand-ins
// for the graph and Solr: Java's identifier checks, what search-core asks
// Solr, and the answers it writes. Java's answers measured 16 Oct 2026.
import { URLSearchParams } from 'node:url';
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';

const objects = {
  'R-HSA-8848021': { labels: ['Pathway', 'Event', 'DatabaseObject'], hasDiagram: true },
  'R-HSA-68886': { labels: ['Pathway', 'Event', 'DatabaseObject'], hasDiagram: true },
  'R-HSA-1': { labels: ['Pathway', 'Event', 'DatabaseObject'], hasDiagram: false },
  'R-HSA-141433': { labels: ['EntityWithAccessionedSequence', 'DatabaseObject'], hasDiagram: null },
};

vi.mock('./graph.mjs', () => ({
  read: async (_cypher, params) => (objects[params.id] ? [objects[params.id]] : []),
  configured: () => true,
  close: async () => {},
  envSetting: (key, fallback = '') => process.env[key] || fallback,
}));

const { app } = await import('./service.mjs');

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
      response.end(JSON.stringify(answer(request.url, sent)));
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
const fqs = (sent) => sent.filter(([name]) => name === 'fq').map(([, value]) => value);
const mad = {
  dbId: '141400',
  stId: 'R-HSA-141400',
  name: 'MAD2L1',
  type: 'Protein',
  exactType: 'ReferenceGeneProduct',
};

describe("Java's identifier checks, after Spring's parameters", () => {
  it('names an id the graph does not have, a non-pathway, and a pathway with no diagram', async () => {
    asked = [];
    for (const [path, message] of [
      ['diagram/xyz?query=MAD', "'xyz' cannot be found"],
      ['diagram/%20?query=MAD', "' ' cannot be found"],
      ['diagram/R-HSA-141433?query=MAD', "'R-HSA-141433' does not belong to a pathway"],
      ['diagram/R-HSA-1?query=MAD', "'R-HSA-1' the pathway does not have diagram"],
      ['diagram/xyz/occurrences/abc', "'abc' cannot be found and 'xyz' cannot be found"],
    ]) {
      const response = await get(path);
      expect([path, response.status, (await response.json()).messages]).toEqual([
        path,
        400,
        [message],
      ]);
    }
    expect(asked).toHaveLength(0);
  });

  it("is Spring's 400 for a missing query before any identifier is read", async () => {
    const response = await get('diagram/xyz');
    expect((await response.json()).messages).toEqual([
      "Required request parameter 'query' for method parameter type String is not present",
    ]);
  });
});

describe('/diagram/{diagram}', () => {
  it('asks /diagrams in the diagram, writing entries, the type facets and the count', async () => {
    asked = [];
    answer = () => ({
      response: { numFound: 9, docs: [mad] },
      facet_counts: { facet_fields: { type_facet: ['Protein', 9], species_facet: ['x', 1] } },
      highlighting: { 141400: { name: ['<b>MAD2L1</b>'] } },
    });
    const response = await get('diagram/R-HSA-8848021?query=MAD&types=Protein&start=1&rows=2');
    expect(await response.text()).toBe(
      '{"entries":[{"dbId":"141400","stId":"R-HSA-141400","id":"R-HSA-141400","name":"MAD2L1","type":"Protein","exactType":"ReferenceGeneProduct"}],' +
        '"facets":[{"name":"Protein","count":9}],"found":9}'
    );
    expect(asked).toEqual([
      [
        '/diagrams',
        [
          ['wt', 'json'],
          ['json.nl', 'flat'],
          ['fq', '-isReferenceSummary:true'],
          ['fq', '{!tag=tf}type_facet:("Protein")'],
          ['fq', 'diagrams:R-HSA-8848021'],
          ['start', '1'],
          ['rows', '2'],
          ['q', 'MAD'],
        ],
      ],
    ]);
  });

  it('asks again in every scope when nothing is found, then is the 404', async () => {
    asked = [];
    answer = () => ({ response: { numFound: 0, docs: [] } });
    const response = await get('diagram/R-HSA-8848021.1?query=zzz&includeInteractors=true');
    expect([response.status, (await response.json()).messages]).toEqual([
      404,
      ["No entries found for 'zzz' in diagram 'R-HSA-8848021.1'"],
    ]);
    expect(asked.map(([, sent]) => fqs(sent))).toEqual([
      ['-isReferenceSummary:true', 'diagramsWithInteractor:R-HSA-8848021.1'],
      ['diagramsWithInteractor:R-HSA-8848021.1'],
    ]);
  });

  it("is Java's 500 for a blank scope or includeInteractors, once the ids are checked", async () => {
    for (const blank of ['scope=%20', 'includeInteractors=%20']) {
      const response = await get(`diagram/R-HSA-8848021?query=MAD&${blank}`);
      expect([blank, response.status]).toEqual([blank, 500]);
    }
  });
});

describe('/diagram/{diagram}/occurrences/{instance}', () => {
  it('reads the first occurrence in the diagram, its sets in HashSet order', async () => {
    asked = [];
    answer = () => ({
      response: {
        numFound: 1,
        docs: [
          {
            occurrences: [
              'R-HSA-1:true:R-HSA-9:#',
              'R-HSA-68886:false:R-HSA-68877,R-HSA-2555396,R-HSA-68875:#',
            ],
          },
        ],
      },
    });
    const response = await get('diagram/R-HSA-68886/occurrences/R-HSA-141433');
    expect(await response.text()).toBe(
      '{"diagramEntity":"R-HSA-68886","inDiagram":false,"occurrences":["R-HSA-68877","R-HSA-2555396","R-HSA-68875"]}'
    );
    expect(asked).toEqual([
      [
        '/diagrams/occurrences',
        [
          ['wt', 'json'],
          ['json.nl', 'flat'],
          ['fq', 'hasReferenceEntity:false'],
          ['q', 'R-HSA-141433'],
          ['fl', 'occurrences'],
        ],
      ],
    ]);
  });

  it('asks again in every scope, then is the 404', async () => {
    asked = [];
    answer = () => ({ response: { numFound: 0, docs: [] } });
    const response = await get('diagram/R-HSA-68886/occurrences/R-HSA-141433');
    expect([response.status, (await response.json()).messages]).toEqual([
      404,
      ["No occurrences of 'R-HSA-141433' found in 'R-HSA-68886'"],
    ]);
    expect(asked.map(([, sent]) => fqs(sent))).toEqual([['hasReferenceEntity:false'], []]);
  });
});

describe('/diagram/summary', () => {
  it('counts in the diagram and in fireworks, for the species and those without', async () => {
    asked = [];
    answer = (url) => ({
      response: { numFound: url.endsWith('/fireworks') ? 86 : 8, docs: [] },
      facet_counts: { facet_fields: { type_facet: ['Protein', 7] } },
    });
    const response = await get('diagram/summary?query=KIF&diagram=R-HSA-8848021');
    expect(await response.text()).toBe(
      '{"diagramResult":{"facets":[{"name":"Protein","count":7}],"found":8},' +
        '"fireworksResult":{"facets":[{"name":"Protein","count":7}],"found":86}}'
    );
    expect(asked).toEqual([
      [
        '/diagrams',
        [
          ['wt', 'json'],
          ['json.nl', 'flat'],
          ['fq', 'hasReferenceEntity:false'],
          ['fq', 'fireworksSpecies:("Homo sapiens" OR "Entries without species")'],
          ['fq', 'diagrams:R-HSA-8848021'],
          ['start', '0'],
          ['rows', '0'],
          ['q', 'KIF'],
        ],
      ],
      [
        '/fireworks',
        [
          ['wt', 'json'],
          ['json.nl', 'flat'],
          ['fq', 'hasReferenceEntity:false'],
          ['fq', 'fireworksSpecies:("Homo sapiens" OR "Entries without species")'],
          ['start', '0'],
          ['rows', '0'],
          ['q', 'KIF'],
        ],
      ],
    ]);
  });
});
