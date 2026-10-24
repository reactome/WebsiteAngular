// @vitest-environment node
//
// /references/mapping/{identifier}, /references/mapping/{identifier}/xrefs and
// POST /references/mapping/xrefs -- the reference entities an identifier
// names, and their cross references and physical entities -- with a stand-in
// graph. ReferenceEntityController's cross-reference query, with the
// identifier and filter passed as parameters where Java writes them into the
// text, and graph-core's ReferenceEntityRepository. The entities here are invented; Java's answers
// were measured 17 Oct 2026.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/** A query's parameters, as the service passes them. */
type Params = { identifier?: unknown; dbFilter?: unknown; [name: string]: unknown };
/** The stand-in graph's rows for a query, or a promise of them. */
let answer: (cypher: string, params: Params) => unknown = () => [];
/** Each query the stand-in graph was asked, with its parameters. */
const asked: [string, Params][] = [];
vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: Params) => {
    asked.push([cypher, params]);
    return answer(cypher, params);
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

const { app } = await import('./server.ts');
const { crossReferenceQuery, pageJson, pageText } = await import('./mapping-species-endpoints.ts');

let base: string;
let server: Server;
beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app().listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const get = (path: string) => fetch(`${base}/ContentService/references/mapping/${path}`);
const post = (query: string, body: string | undefined, type = 'text/plain') =>
  fetch(`${base}/ContentService/references/mapping/xrefs${query}`, {
    method: 'POST',
    headers: type ? { 'content-type': type } : {},
    ...(body === undefined ? {} : { body }),
  });
/** Status and the messages of Java's error envelope. */
const messages = async (response: Response): Promise<[number, string[]]> => [
  response.status,
  ((await response.json()) as { messages: string[] }).messages,
];
/** The last query asked; none at all is the test's failure, not undefined. */
const last = () => {
  const query = asked.at(-1);
  if (!query) throw new Error('the graph was asked nothing');
  return query;
};

describe('crossReferenceQuery', () => {
  it("is the controller's text, the identifier and filter as parameters", () => {
    expect(crossReferenceQuery(undefined)).toBe(
      'MATCH (n{identifier:$identifier})<-[:crossReference]-(re:ReferenceEntity)-[:crossReference]->(xf) OPTIONAL MATCH (re)<-[:referenceEntity]-(pe:PhysicalEntity) RETURN re.identifier as reference, [ x in collect(distinct xf) | {identifier:x.identifier, databaseName:x.databaseName, url:x.url}] as crossReferences, collect(distinct pe.stId) as physicalEntities'
    );
    expect(crossReferenceQuery('Ensembl')).toMatch(
      /\(xf\) WHERE xf\.databaseName=\$dbFilter OPTIONAL MATCH/
    );
  });
});

describe('pageJson', () => {
  it("is Spring's PageImpl as Jackson writes it, the content left out when empty", () => {
    expect(pageText(pageJson([{ a: 1 }], 0, 2, 3))).toBe(
      '{"content":[{"a":1}],"pageable":{"sort":{"empty":true,"sorted":false,"unsorted":true},"offset":0,"pageNumber":0,"pageSize":2,"paged":true,"unpaged":false},"last":false,"totalPages":2,"totalElements":3,"size":2,"number":0,"sort":{"empty":true,"sorted":false,"unsorted":true},"first":true,"numberOfElements":1,"empty":false}'
    );
    // hasNext in int arithmetic: the last possible page is never the last.
    expect(pageJson([], 2147483647, 2, 1).last).toBe(false);
    const empty = pageJson([], 5, 100, 1);
    expect([
      'content' in empty,
      empty.pageable.offset,
      empty.totalPages,
      empty.last,
      empty.first,
    ]).toEqual([false, 500n, 1, true, false]);
  });
});

describe('/references/mapping/{identifier}', () => {
  it("runs graph-core's query and writes each reference entity", async () => {
    answer = () => [
      {
        n: { dbId: 1, identifier: 'P1', schemaClass: 'ReferenceGeneProduct' },
        labels: ['DatabaseObject', 'ReferenceEntity', 'ReferenceSequence', 'ReferenceGeneProduct'],
      },
    ];
    asked.length = 0;
    const response = await get('P1');
    expect(((await response.json()) as { dbId: number }[]).map((e) => e.dbId)).toEqual([1]);
    expect(last()[0].replace(/\s+/g, ' ').trim()).toMatch(
      /^MATCH \(rd:ReferenceDatabase\)<--\(n\{identifier:\$identifier\}\)<-\[:referenceEntity\|referenceSequence\|crossReference\|referenceGene\*\]-\(pe:PhysicalEntity\) WITH DISTINCT pe MATCH \(pe\)-\[:referenceEntity\]->\(n:ReferenceEntity\) ?RETURN DISTINCT n, labels\(n\) AS labels$/
    );
    expect(last()[1]).toEqual({ identifier: 'P1' });
  });

  it('is a 404 naming the identifier for none', async () => {
    answer = () => [];
    expect(await messages(await get('xyz'))).toEqual([
      404,
      ['Identifier: xyz has not been found as a cross reference in any of the annotated entities'],
    ]);
  });
});

const XREF_ROW = {
  reference: 'P1',
  crossReferences: [{ identifier: 'X', databaseName: 'D', url: null }],
  physicalEntities: ['R-HSA-2'],
};

describe('/references/mapping/{identifier}/xrefs', () => {
  it('writes each row as CrossReferenceResult, a null as Java\'s "null"', async () => {
    answer = () => [XREF_ROW];
    asked.length = 0;
    const response = await get('P1/xrefs?dbFilter=D');
    expect(await response.text()).toBe(
      '[{"reference":"P1","physicalEntities":["R-HSA-2"],"crossReferences":[{"identifier":"X","databaseName":"D","url":"null"}]}]'
    );
    expect(last()).toEqual([crossReferenceQuery('D'), { identifier: 'P1', dbFilter: 'D' }]);
  });

  it('leaves out what NON_EMPTY leaves out: no entities, an empty text', async () => {
    answer = () => [
      {
        reference: 'P1',
        physicalEntities: [],
        crossReferences: [{ identifier: 'X', databaseName: '', url: null }],
      },
    ];
    expect(await (await get('P1/xrefs')).text()).toBe(
      '[{"reference":"P1","crossReferences":[{"identifier":"X","url":"null"}]}]'
    );
  });

  it("is Java's 500 for any Neo4j client error, and the driver's for a value that is not text", async () => {
    answer = () => {
      throw Object.assign(new Error('/ by zero'), {
        code: 'Neo.ClientError.Statement.ArithmeticError',
      });
    };
    expect(await messages(await get('P1/xrefs'))).toEqual([
      500,
      [
        "/ by zero; Error code 'Neo.ClientError.Statement.ArithmeticError'; nested exception is org.neo4j.driver.exceptions.ClientException: / by zero",
      ],
    ]);
    answer = () => [{ reference: 65969, physicalEntities: [], crossReferences: [] }];
    expect(await messages(await get('P1/xrefs'))).toEqual([
      500,
      [
        "Cannot coerce INTEGER to Java String; Error code 'N/A'; nested exception is org.neo4j.driver.exceptions.value.Uncoercible: Cannot coerce INTEGER to Java String",
      ],
    ]);
  });

  it('joins a repeated dbFilter as Spring does', async () => {
    answer = () => [];
    asked.length = 0;
    await get('P1/xrefs?dbFilter=A&dbFilter=B');
    expect(last()).toEqual([crossReferenceQuery('A,B'), { identifier: 'P1', dbFilter: 'A,B' }]);
  });

  it('is a 404 when nothing matches', async () => {
    answer = () => [];
    expect(await messages(await get('xyz/xrefs'))).toEqual([
      404,
      ['Identifier: xyz has not been found as a cross reference in any of the annotated entities'],
    ]);
  });

  it('looks up an identifier or filter with a quote in it as written, as a value', async () => {
    // Java writes both into its query, where a quote ends the string (its
    // 500); here each is only ever a parameter, and matches nothing.
    answer = () => [];
    asked.length = 0;
    const response = await get('P36%22897/xrefs?dbFilter=D%22');
    expect(response.status).toBe(404);
    expect(asked).toEqual([[crossReferenceQuery('D"'), { identifier: 'P36"897', dbFilter: 'D"' }]]);
    expect(last()[0]).not.toContain('P36');
  });

  it("is the service's 503 when the database ends the query, as everywhere", async () => {
    answer = () => {
      throw Object.assign(new Error('timed out'), {
        code: 'Neo.ClientError.Transaction.TransactionTimedOut',
      });
    };
    const response = await get('P1/xrefs');
    expect(response.status).toBe(503);
    expect(((await response.json()) as { reason: string }).reason).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('POST /references/mapping/xrefs', () => {
  it('pages the identifiers, each to its results or NO MATCH', async () => {
    answer = (_cypher, params) => (params.identifier === 'P1' ? [XREF_ROW] : []);
    const response = await post('?page=0&pageSize=2', 'P1, xyz;Q2');
    const json = (await response.json()) as {
      content: unknown[];
      totalElements: number;
      totalPages: number;
      numberOfElements: number;
    };
    expect(json.content).toEqual([
      {
        P1: [
          { ...XREF_ROW, crossReferences: [{ identifier: 'X', databaseName: 'D', url: 'null' }] },
        ],
      },
      { xyz: [{ reference: 'NO MATCH' }] },
    ]);
    expect([json.totalElements, json.totalPages, json.numberOfElements]).toEqual([3, 2, 2]);
  });

  it('joins a repeated dbFilter as Spring does', async () => {
    answer = () => [];
    asked.length = 0;
    await post('?dbFilter=A&dbFilter=B', 'P1');
    expect(last()).toEqual([crossReferenceQuery('A,B'), { identifier: 'P1', dbFilter: 'A,B' }]);
  });

  it('splits on newline and tab too, and trims as String.trim does', async () => {
    answer = () => [];
    const json = (await (await post('', 'A\nB\tC\u0001 ')).json()) as {
      content: Record<string, unknown>[];
    };
    expect(json.content.map((entry) => Object.keys(entry)[0])).toEqual(['A', 'B', 'C']);
  });

  it('corrects the total as PageImpl does when the slice runs past it', () => {
    // Offset 4 + size 10 is past 5 identifiers: the total is 4 + what the page holds.
    expect(pageJson([{ a: 1 }], 2, 2, 5).totalElements).toBe(5);
    expect(pageJson([{ a: 1 }], 1, 4, 5).totalElements).toBe(5);
    expect(pageJson([{ a: 1 }], 1, 4, 3).totalElements).toBe(5);
  });

  it('writes a page past 2^53 exactly, as a long', async () => {
    answer = () => [];
    const text = await (await post('?page=2147483647&pageSize=2147483647', 'P1')).text();
    expect(text).toContain('"offset":4611686014132420609,');
    expect(await messages(await post('?page=-2147483647&pageSize=2147483647', 'P1'))).toEqual([
      500,
      ['-4611686014132420609'],
    ]);
    expect(await messages(await post('?pageSize=-5', 'P1'))).toEqual([500, ['-5']]);
  });

  it("is the first failure's answer when one identifier breaks the query", async () => {
    answer = (_cypher, params) => {
      if (params.identifier === 'B')
        throw Object.assign(new Error('bad'), { code: 'Neo.ClientError.Statement.SyntaxError' });
      return [];
    };
    const [status, [message]] = await messages(await post('', 'A,B,C'));
    expect([status, message?.startsWith('bad; Error code')]).toEqual([500, true]);
  });

  it('starts no lookup after one throws', async () => {
    asked.length = 0;
    // The first lookup fails; the others would each take 5ms.
    answer = (_cypher, params) => {
      if (params.identifier === 'I0') throw new Error('the database is gone');
      return new Promise((resolve) => setTimeout(() => resolve([]), 5));
    };
    const ids = Array.from({ length: 50 }, (_, at) => `I${at}`).join(',');
    expect((await post('?pageSize=50', ids)).status).toBe(500);
    await new Promise((resolve) => setTimeout(resolve, 300));
    // The four workers' first lookups, and nothing after.
    expect(asked.length).toBe(4);
  });

  it('starts no lookup once the client has gone', async () => {
    asked.length = 0;
    let started: () => void = () => undefined;
    const first = new Promise<void>((resolve) => (started = resolve));
    answer = () => {
      started();
      return new Promise((resolve) => setTimeout(() => resolve([]), 20));
    };
    const ids = Array.from({ length: 100 }, (_, at) => `I${at}`).join(',');
    const gone = new AbortController();
    const sent = fetch(`${base}/ContentService/references/mapping/xrefs?pageSize=100`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: ids,
      signal: gone.signal,
    }).catch(() => undefined);
    await first;
    gone.abort();
    await sent;
    await new Promise((resolve) => setTimeout(resolve, 300));
    // The lookups under way when the client left, four at a time, and at
    // most one more round as the close arrives; never the hundred.
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.length).toBeLessThanOrEqual(8);
  });

  it('runs two batches at once and answers a third 503, Retry-After', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    answer = () => held.then(() => []);
    const two = [post('', 'A'), post('', 'B')];
    await new Promise((resolve) => setTimeout(resolve, 50));
    const third = await post('', 'C');
    expect([third.status, third.headers.get('retry-after')]).toEqual([503, '5']);
    release();
    expect((await Promise.all(two)).map((response) => response.status)).toEqual([200, 200]);
    // Their places given back.
    expect((await post('', 'D')).status).toBe(200);
  });

  it("answers Java's errors: 415, 422, 400 and the paging 500s", async () => {
    expect(await messages(await post('', 'P1', 'application/json'))).toEqual([
      415,
      ["Content type 'application/json' not supported"],
    ]);
    const missing = await messages(await post('', undefined));
    expect(missing[0]).toBe(422);
    expect(missing[1][0]).toMatch(
      /^Required request body is missing: public org\.springframework\.data\.domain\.Page/
    );
    expect((await messages(await post('?page=x', 'P1')))[0]).toBe(400);
    expect(await messages(await post('?page=-1', 'P1'))).toEqual([500, ['-100']]);
    expect(await messages(await post('?pageSize=0', 'P1'))).toEqual([
      500,
      ['Page size must not be less than one'],
    ]);
  });
});
