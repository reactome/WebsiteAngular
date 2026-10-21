// @vitest-environment node
//
// /search/icon/{identifier} and /search/icon/query, without a Solr: the
// Entry search-core builds from a Solr document, what is asked of Solr, and
// Spring's reading of the parameters. Java's answers measured 16 Oct 2026.
import { URLSearchParams } from 'node:url';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { app } from './server.ts';
import { searchEntry } from './search-core.ts';
import { javaJson } from './answers.ts';

const icon = {
  dbId: '013428',
  stId: 'R-ICO-013428',
  name: 'TCR',
  type: 'Icon',
  exactType: 'Icon',
  species: ['Homo sapiens'],
  summation: 'Simplified graphic representation of a T-cell receptor',
  hasReferenceEntity: false,
  hasEHLD: false,
  iconName: 'TCR',
  iconCategories: ['receptor'],
  iconCuratorName: 'A curator',
  iconReferences: ['0042101', 'GO:0042101'],
  iconPhysicalEntities: [
    'R-HSA-2#ReferenceGeneProduct#beta#plasma membrane',
    'uniprot:Q1#ReferenceGeneProduct#ALCAM#null',
    'R-HSA-1#ReferenceGeneProduct#ALCAM#plasma membrane',
    'R-HSA-3#ReferenceGeneProduct#alcam#plasma membrane',
  ],
  iconEhlds: ['R-HSA-1280218'],
};

describe('searchEntry, as SolrConverter.buildEntry builds an Entry', () => {
  it("writes Jackson's order -- fields as declared, then icon -- and NON_EMPTY", () => {
    const entry = searchEntry(icon, {});
    expect(Object.keys(entry)).toEqual([
      'dbId',
      'stId',
      'id',
      'name',
      'type',
      'exactType',
      'species',
      'summation',
      'hasReferenceEntity',
      'hasEHLD',
      'iconName',
      'iconCategories',
      'iconCuratorName',
      'iconReferences',
      'iconPhysicalEntities',
      'iconEhlds',
      'icon',
    ]);
    expect(entry.icon).toBe(true);
    expect(entry.hasEHLD).toBe(false);
  });

  it("orders the icon's entities as a TreeSet by display name, ignoring case, dropping equals", () => {
    expect(searchEntry(icon, {}).iconPhysicalEntities).toEqual([
      {
        stId: 'uniprot:Q1',
        type: 'ReferenceGeneProduct',
        name: 'ALCAM',
        compartments: 'null',
        displayName: 'ALCAM [null]',
      },
      {
        stId: 'R-HSA-1',
        type: 'ReferenceGeneProduct',
        name: 'ALCAM',
        compartments: 'plasma membrane',
        displayName: 'ALCAM [plasma membrane]',
      },
      {
        stId: 'R-HSA-2',
        type: 'ReferenceGeneProduct',
        name: 'beta',
        compartments: 'plasma membrane',
        displayName: 'beta [plasma membrane]',
      },
    ]);
  });

  it('fails, as Java does, on an entity with fewer than four parts', () => {
    // Its ArrayIndexOutOfBoundsException: read [0] to [3], three parts fail at 3.
    expect(() => searchEntry({ ...icon, iconPhysicalEntities: ['a#b#c#'] }, {})).toThrow(
      expect.objectContaining({ javaMessage: 'Index 3 out of bounds for length 3' })
    );
  });

  it('id is the stId when there is one, else the dbId', () => {
    expect(searchEntry({ dbId: '5' }, {}).id).toBe('5');
    expect(searchEntry({ dbId: '5', stId: 'R-ICO-5' }, {}).id).toBe('R-ICO-5');
  });

  it('is an icon whenever it has an icon name, even an empty one NON_EMPTY leaves out', () => {
    expect(searchEntry({ dbId: '1', iconName: '' }, {})).toEqual({
      dbId: '1',
      id: '1',
      icon: true,
    });
  });

  it("leaves out an icon entity's empty parts, as NON_EMPTY does in nested beans", () => {
    expect(
      searchEntry({ dbId: '1', iconPhysicalEntities: ['##n#c'] }, {}).iconPhysicalEntities
    ).toEqual([{ name: 'n', compartments: 'c', displayName: 'n [c]' }]);
  });

  it('reads replacement dbIds as Long.parseLong does, any script, written exactly', () => {
    const ids = (values) =>
      javaJson(searchEntry({ dbId: '1', replacementDbIds: values }, {}).replacementDbIds);
    expect(ids(['+7', '-8', '٣٤', '１', '9007199254740993'])).toBe('[7,-8,34,1,9007199254740993]');
  });

  it('fails as Java does on a dbId Long.parseLong refuses, or one that is not a String', () => {
    for (const bad of ['', ' 5', '1e3', '0x10', '9223372036854775808', 7])
      expect(() => searchEntry({ dbId: '1', replacementDbIds: [bad] }, {}), String(bad)).toThrow(
        expect.objectContaining({ unexpected: true })
      );
  });

  it('orders by display name even when one is empty, and leaves it out', () => {
    const entities = searchEntry(
      { dbId: '1', iconPhysicalEntities: ['s#t## ', 's2#t#n#c'] },
      {}
    ).iconPhysicalEntities;
    expect(entities).toEqual([
      { stId: 's', type: 't', compartments: ' ' },
      { stId: 's2', type: 't', name: 'n', compartments: 'c', displayName: 'n [c]' },
    ]);
  });

  it('without highlighting, the summation is the summation even when absent', () => {
    const doc = { dbId: '1', name: 'n', inferredSummation: 'inferred' };
    expect(searchEntry(doc, {}).summation).toBe(undefined);
    expect(searchEntry({ ...doc, summation: 's' }, {}).summation).toBe('s');
  });

  it('highlighted, only snippets set the name; the inferred summation stays', () => {
    const doc = {
      dbId: '1',
      name: 'plain',
      inferredSummation: 'inferred',
      referenceIdentifiers: ['A:1', 'B'],
    };
    expect(searchEntry(doc, { 1: {} })).toEqual({
      dbId: '1',
      id: '1',
      summation: 'inferred',
      referenceIdentifier: 'B',
    });
    const hit = searchEntry(doc, {
      1: {
        name: ['<span class="highlighting" >plain</span>'],
        referenceIdentifiers: ['x', 'y highlighting'],
      },
    });
    expect(hit.name).toBe('<span class="highlighting" >plain</span>');
    expect(hit.referenceIdentifier).toBe('y highlighting');
  });

  it('writes isDisease where declared and disease after the fields; a deleted entry with its date', () => {
    const entry = searchEntry(
      {
        dbId: '1',
        isDisease: false,
        deleted: true,
        date: '2020-01-02T00:00:00Z',
        replacementDbIds: ['7'],
      },
      {}
    );
    expect(Object.keys(entry)).toEqual([
      'dbId',
      'id',
      'isDisease',
      'deleted',
      'date',
      'replacementDbIds',
      'disease',
    ]);
    expect(entry.date).toBe(Date.UTC(2020, 0, 2));
    expect(javaJson(entry.replacementDbIds)).toBe('[7]');
  });
});

describe('the icon endpoints, against a stand-in Solr', () => {
  let base;
  let server;
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
      request.on('end', () => {
        const sent = [...new URLSearchParams(body)];
        asked.push([request.url, sent]);
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(answer(sent)));
      });
    });
    await new Promise((resolve) => solrServer.listen(0, '127.0.0.1', resolve));
    for (const name of names) saved[name] = process.env[name];
    process.env.SOLR_URL = `http://127.0.0.1:${solrServer.address().port}/solr/reactome`;
    process.env.SOLR_USER = 'reader';
    process.env.SOLR_PASSWORD = 'not-a-secret';
    await new Promise((resolve) => {
      server = app().listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    for (const name of names)
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => solrServer.close(resolve));
  });

  const found =
    (docs, numFound = docs.length) =>
    () => ({ response: { numFound, docs } });

  it('/icon/{id} asks /search for that stId among icons, and writes the first Entry', async () => {
    asked = [];
    // Java ignores the highlighting here: the plain name, not the snippet.
    answer = () => ({
      response: { numFound: 2, docs: [icon, { ...icon, dbId: '2' }] },
      highlighting: { '013428': { name: ['<b>TCR</b>'] } },
    });
    const response = await fetch(`${base}/ContentService/search/icon/R-ICO-013428`);
    expect(response.status).toBe(200);
    const entry = await response.json();
    expect(entry).toEqual(searchEntry(icon, {}));
    expect([entry.id, entry.name]).toEqual(['R-ICO-013428', 'TCR']);
    expect(asked).toEqual([
      [
        '/solr/reactome/search',
        [
          ['wt', 'json'],
          ['json.nl', 'flat'],
          ['q', 'stId:R-ICO-013428'],
          ['fq', 'exactType:Icon'],
          ['mm', '100%'],
        ],
      ],
    ]);
  });

  it("/icon/{id} found but sent no document is Solr's failure, never an empty 200 to cache", async () => {
    answer = found([], 1);
    const response = await fetch(`${base}/ContentService/search/icon/R-ICO-013428`);
    expect([response.status, (await response.json()).messages]).toEqual([
      500,
      ['Solr exception occurred'],
    ]);
  });

  it("/icon/{id} found nowhere is Java's 404, naming the id as given", async () => {
    answer = found([]);
    const response = await fetch(`${base}/ContentService/search/icon/R-ICO-013428.json`);
    expect(response.status).toBe(404);
    expect((await response.json()).messages).toEqual(['Icon not found: R-ICO-013428.json']);
  });

  it('/icon/query pages by name, among icons, with the category before the text', async () => {
    asked = [];
    answer = found([icon], 9);
    const response = await fetch(
      `${base}/ContentService/search/icon/query?query=TCR&query=x&category=Cell%20%09Type&page=3&pageSize=2`
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      JSON.stringify({
        entries: [searchEntry(icon, {})],
        typeName: 'Results',
        entriesCount: 9,
        rowCount: 1,
      })
    );
    expect(asked).toEqual([
      [
        '/solr/reactome/search',
        [
          ['wt', 'json'],
          ['json.nl', 'flat'],
          ['sort', 'iconName_sort asc'],
          ['start', '4'],
          ['rows', '2'],
          ['q', 'iconCategories_facet:cell_type TCR,x'],
          ['fq', '{!term f=type}icon'],
        ],
      ],
    ]);
  });

  it('/icon/query with nothing asks for everything, from the first page of 28', async () => {
    asked = [];
    answer = found([], 0);
    const response = await fetch(`${base}/ContentService/search/icon/query`);
    expect(await response.text()).toBe('{"typeName":"Results","entriesCount":0,"rowCount":0}');
    expect(asked[0][1].filter(([name]) => ['start', 'rows', 'q'].includes(name))).toEqual([
      ['start', '0'],
      ['rows', '28'],
      ['q', '*'],
    ]);
  });

  it("/icon/query uses the results' highlighting", async () => {
    answer = () => ({
      response: { numFound: 1, docs: [icon] },
      highlighting: { '013428': { name: ['<b>TCR</b>'] } },
    });
    const response = await fetch(`${base}/ContentService/search/icon/query?query=TCR`);
    expect((await response.json()).entries[0].name).toBe('<b>TCR</b>');
  });

  it("answers Spring's 400, Java's 500s for blank numbers, and pages in int arithmetic", async () => {
    asked = [];
    const bad = await fetch(`${base}/ContentService/search/icon/query?pageSize=abc`);
    expect([bad.status, (await bad.json()).messages]).toEqual([
      400,
      [
        `Failed to convert value of type 'java.lang.String' to required type 'java.lang.Integer'; nested exception is java.lang.NumberFormatException: For input string: "abc"`,
      ],
    ]);
    for (const blank of ['pageSize=%20', 'page=%20']) {
      const response = await fetch(`${base}/ContentService/search/icon/query?${blank}`);
      expect([blank, response.status, (await response.json()).messages]).toEqual([
        blank,
        500,
        ['Something unexpected happened and the error has been reported.'],
      ]);
    }
    expect(asked).toHaveLength(0);
    answer = found([], 0);
    await fetch(`${base}/ContentService/search/icon/query?page=2147483647&pageSize=2`);
    expect(asked[0][1].find(([name]) => name === 'start')).toEqual(['start', '-4']);
  });

  it('routes a literal segment sent percent-encoded as Java does: decoded first', async () => {
    asked = [];
    answer = found([], 0);
    const query = await fetch(`${base}/ContentService/search/icon/qu%65ry?pageSize=5`);
    expect(query.status).toBe(200);
    expect(asked[0][1].find(([name]) => name === 'rows')).toEqual(['rows', '5']);
    asked = [];
    answer = () => ({
      response: { numFound: 0 },
      facet_counts: { facet_fields: { iconCategories_facet: [] } },
    });
    await fetch(`${base}/ContentService/search/icon/f%61cet`);
    expect(asked[0][0]).toBe('/solr/reactome/icon/facet');
  });

  it('routes by case, as Spring does: a capital, sent plain or escaped, is an id', async () => {
    answer = found([]);
    for (const path of ['icon/QUERY', 'icon/%51uery', 'icon/%46acet']) {
      const response = await fetch(`${base}/ContentService/search/${path}`);
      expect([path, response.status]).toEqual([path, 404]);
    }
    const escaped = await fetch(`${base}/ContentService/search/icon/%51uery`);
    expect((await escaped.json()).messages).toEqual(['Icon not found: Query']);
  });

  it("answers a path no mapping matches with Spring's JSON 404", async () => {
    const response = await fetch(`${base}/ContentService/data/database/VERSION`);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect([body.status, body.error, body.path]).toEqual([
      404,
      'Not Found',
      '/ContentService/data/database/VERSION',
    ]);
  });

  it("routes /query/{id}/{attribute} by the attribute in any case, as Java's getter lookup does", async () => {
    // Without a graph the handler fails, but it is a handler that answers,
    // not the 404 for a path no mapping matches. "ids" is an id here: Java
    // has no GET mapping under /query/ids/.
    for (const path of [
      'R-HSA-70486/stid',
      'R-HSA-70486/STID',
      'R-HSA-70486/NormalPathway',
      'R-HSA-70486/STID/',
      'ids/STID',
    ]) {
      const response = await fetch(`${base}/ContentService/data/query/${path}`);
      const body = await response.text();
      expect([path, body.includes('"error":"Not Found"')]).toEqual([path, false]);
    }
  });
});
