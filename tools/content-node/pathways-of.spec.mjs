// @vitest-environment node
//
// /search/pathways/of/{dbId}, with a stand-in Solr: the entity's document by
// dbId, then its diagrams' documents by stable id, and Spring's reading of
// the parameters. Java's answers measured 16 Oct 2026.
import { URLSearchParams } from 'node:url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { app } from './server.ts';

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

const get = (path) => fetch(`${base}/ContentService/search/pathways/of/${path}`);
const entity = {
  occurrences: ['R-HSA-196849:false:R-HSA-196757:#', 'R-HSA-196757:true:#:#'],
};
const pathways = [
  { dbId: '196849', stId: 'R-HSA-196849', name: 'Metabolism of water-soluble vitamins' },
  { dbId: '196757', stId: 'R-HSA-196757', name: 'Metabolism of folate', hasEHLD: false },
];
const solr = (url) =>
  url.endsWith('/get')
    ? { response: { numFound: 1, docs: [entity] } }
    : { response: { numFound: pathways.length, docs: pathways } };

describe('/pathways/of/{dbId}', () => {
  it('reads the occurrences by dbId, then the diagrams by stable id, with the fields asked', async () => {
    asked = [];
    answer = solr;
    const response = await get(
      '0227785?fields=%20DB_ID&fields=ST_ID&fields=NAME&fields=HAS_EHLD&species=Homo%20sapiens'
    );
    expect(await response.text()).toBe(
      '[{"dbId":"196849","stId":"R-HSA-196849","id":"R-HSA-196849","name":"Metabolism of water-soluble vitamins"},' +
        '{"dbId":"196757","stId":"R-HSA-196757","id":"R-HSA-196757","name":"Metabolism of folate","hasEHLD":false}]'
    );
    expect(asked).toEqual([
      [
        '/get',
        [
          ['wt', 'json'],
          ['json.nl', 'flat'],
          ['fl', 'occurrences'],
          ['ids', '227785'],
        ],
      ],
      [
        '/select',
        [
          ['wt', 'json'],
          ['json.nl', 'flat'],
          ['q', '{!terms f=stId}r-hsa-196849,r-hsa-196757'],
          ['rows', '2'],
          ['fq', 'species:Homo sapiens'],
          ['fl', 'dbId,stId,name,hasEHLD'],
        ],
      ],
    ]);
  });

  it('keeps only the diagrams it is directly in, through interactors when asked', async () => {
    asked = [];
    answer = (url) =>
      url.endsWith('/get')
        ? { response: { numFound: 1, docs: [{ occurrencesWithInteractor: entity.occurrences }] } }
        : { response: { numFound: 1, docs: [pathways[1]] } };
    await get('227785?directlyInDiagram=true&includeInteractors=true');
    expect(asked[0][1].find(([name]) => name === 'fl')).toEqual([
      'fl',
      'occurrencesWithInteractor',
    ]);
    expect(asked[1][1]).toEqual([
      ['wt', 'json'],
      ['json.nl', 'flat'],
      ['q', '{!terms f=stId}r-hsa-196757'],
      ['rows', '1'],
    ]);
  });

  it('is the 404 when the entity has no document, or no diagrams to show', async () => {
    for (const docs of [[], [{}]]) {
      answer = (url) =>
        url.endsWith('/get')
          ? { response: { numFound: docs.length, docs } }
          : { response: { numFound: 0, docs: [] } };
      const response = await get('1');
      expect([response.status, (await response.json()).messages]).toEqual([
        404,
        ['No pathways found for dbId: 1'],
      ]);
    }
  });

  it("is Spring's 400 for a field that is no Field, naming it as sent", async () => {
    const message = (type, sent, name) =>
      `Failed to convert value of type '${type}' to required type 'java.util.List'; nested exception is ` +
      'org.springframework.core.convert.ConversionFailedException: Failed to convert from type [java.lang.String] ' +
      'to type [@io.swagger.v3.oas.annotations.Parameter @org.springframework.web.bind.annotation.RequestParam ' +
      `org.reactome.server.search.solr.SolrConverter$Field] for value '${sent}'; nested exception is ` +
      `java.lang.IllegalArgumentException: No enum constant org.reactome.server.search.solr.SolrConverter.Field.${name}`;
    asked = [];
    for (const [query, type] of [
      ['fields=%20stId', 'java.lang.String'],
      ['fields=%20stId&fields=ST_ID', 'java.lang.String[]'],
    ]) {
      const response = await get(`227785?${query}`);
      expect([query, response.status, (await response.json()).messages]).toEqual([
        query,
        400,
        [message(type, ' stId', 'stId')],
      ]);
    }
    expect(asked).toHaveLength(0);
  });

  it("is Spring's 400 for a dbId that is no Long, and Java's 500 for an empty field among several", async () => {
    const bad = await get('abc');
    expect((await bad.json()).messages).toEqual([
      `Failed to convert value of type 'java.lang.String' to required type 'java.lang.Long'; nested exception is java.lang.NumberFormatException: For input string: "abc"`,
    ]);
    // Only once the entity's document is found does Java name the fields.
    answer = solr;
    const empty = await get('227785?fields=&fields=ST_ID');
    expect([empty.status, (await empty.json()).messages]).toEqual([
      500,
      ['Something unexpected happened and the error has been reported.'],
    ]);
  });

  it('fails each blank value where Java does: before Solr, after the document, or only with one', async () => {
    const unexpected = ['Something unexpected happened and the error has been reported.'];
    // includeInteractors is unboxed before Solr is asked.
    asked = [];
    answer = solr;
    const interactors = await get('227785?includeInteractors=%20');
    expect([interactors.status, (await interactors.json()).messages, asked.length]).toEqual([
      500,
      unexpected,
      0,
    ]);
    // directlyInDiagram and a blank field only once the document is found.
    for (const query of ['directlyInDiagram=%20', 'fields=%20,ST_ID', 'fields=%20&fields=ST_ID']) {
      asked = [];
      answer = solr;
      const found = await get(`227785?${query}`);
      expect([query, found.status, (await found.json()).messages, asked.length]).toEqual([
        query,
        500,
        unexpected,
        1,
      ]);
      answer = () => ({ response: { numFound: 0, docs: [] } });
      const missing = await get(`227785?${query}`);
      expect([query, missing.status]).toEqual([query, 404]);
    }
  });
});
