// @vitest-environment node
//
// The request's Accept, negotiated as Spring negotiates it (#953): before a
// mapping's handler runs, against the one type the mapping produces, the
// next mapping of the path tried when it is refused, and Spring's 406 when
// none takes it. And Spring's own 404 in the form Accept chooses. Each
// expectation through the service was measured on Java on 27 Nov 2026.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { acceptance, answer, app, javaContentType } from './server.ts';
import { endpoints } from './registry.ts';
import { errorPage } from './spring.ts';
import type { Endpoint, Request } from './endpoint.ts';

let base: string;
let server: Server;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app().listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** A request as acceptance reads it: its headers, by name in any case. */
const requestWith = (headers: Record<string, string>) =>
  ({
    get: (name: string) => headers[name.toLowerCase()],
    originalUrl: '/ContentService/x',
    protocol: 'http',
  }) as unknown as Request;

const endpoint = (path: string) => {
  const found = endpoints.find((each) => each.path === `/ContentService${path}`);
  if (!found) throw new Error(`no endpoint ${path}`);
  return found;
};

/** What Java's mapping produces, by its node route: from content-service's controllers. */
const TEXT = [
  '/data/database/version',
  '/data/database/name',
  '/data/diseases/doid',
  '/data/query/{id}/{attribute}',
  '/data/query/{id}/stId',
  '/data/query/{id}/normalPathway',
  // A GET here is /query/{id}/{attributeName}, for an object called "ids".
  '/data/query/ids/map',
  '/data/query/abridged/{id}/{attribute}',
  '/data/pathway/{id}/containedEvents/{attribute}',
  '/data/person/{id}/{attribute}',
  '/data/referenceMolecules/identifiers',
  '/data/referenceSequences/identifiers',
  '/citation/static/{id}',
  '/citation/download',
];
/**
 * No produces: CitationController.export and ContactController name none;
 * the exporters' figures, files and PDF are not negotiated here (declared);
 * the description and the expression data are no routes of Java's.
 */
const NONE = [
  '/citation/export',
  '/contact',
  '/openapi.json',
  '/expression/{id}',
  '/exporter/diagram/{id}',
  '/exporter/reaction/{id}',
  '/exporter/event/{id}',
  '/exporter/document/event/{id}',
  '/exporter/sbml/{id}',
  '/exporter/voronoi/{id}',
  '/exporter/fireworks/{id}',
];

describe("each route's produced type", () => {
  it("is Java's mapping's: text, text/csv, none, and application/json for the rest", () => {
    const table = Object.fromEntries(
      endpoints.map((each) => [
        `${each.method ?? 'get'} ${each.path.replace('/ContentService', '')}`,
        each.produces === undefined ? 'application/json' : (each.produces?.join('/') ?? 'none'),
      ])
    );
    const expected: Record<string, string> = {};
    for (const each of endpoints) {
      const path = each.path.replace('/ContentService', '');
      const key = `${each.method ?? 'get'} ${path}`;
      expected[key] = 'application/json';
      if (TEXT.includes(path) && each.method === undefined) expected[key] = 'text/plain';
      if (NONE.includes(path)) expected[key] = 'none';
    }
    expected['post /download/{filename}'] = 'text/csv';
    expect(table).toEqual(expected);
  });

  it("names the bodies each POST consumes, as Java's mapping does", () => {
    const consumed = Object.fromEntries(
      endpoints
        .filter((each) => each.method === 'post')
        .map((each) => [each.path, each.consumes?.map((type) => type.join('/')) ?? null])
    );
    expect(consumed).toEqual({
      '/ContentService/data/query/ids': ['text/plain'],
      '/ContentService/data/query/ids/map': ['text/plain'],
      '/ContentService/references/mapping/xrefs': ['text/plain'],
      '/ContentService/data/orthologies/ids/species/{speciesId}': ['text/plain'],
      '/ContentService/interactors/static/molecules/summary': ['text/plain'],
      '/ContentService/interactors/static/molecules/details': ['text/plain'],
      '/ContentService/download/{filename}': ['application/x-www-form-urlencoded', 'text/plain'],
      '/ContentService/contact': null,
    });
  });
});

describe('acceptance, before the handler', () => {
  const json: Pick<Endpoint, 'produces'> = {};
  const text: Pick<Endpoint, 'produces'> = { produces: ['text', 'plain'] };
  const of = (route: Pick<Endpoint, 'produces' | 'consumes'>, headers: Record<string, string>) =>
    acceptance(route, requestWith(headers)).kind;

  it('runs a JSON route for any Accept that takes application/json', () => {
    for (const accept of [
      '',
      '*/*',
      'application/json',
      'application/*',
      'APPLICATION/JSON',
      'text/html;q=0.9,application/json;q=0.8',
      'text/plain, application/json',
    ])
      expect([accept, of(json, accept ? { accept } : {})]).toEqual([accept, 'run']);
  });

  it('refuses a JSON route for one that does not, or that Spring cannot read', () => {
    for (const accept of ['text/plain', 'application/xml', 'text/html', 'text/*', 'garbage'])
      expect([accept, of(json, { accept })]).toEqual([accept, 'refused']);
  });

  it('runs a text route for text, and refuses it for JSON', () => {
    expect(of(text, { accept: 'text/*' })).toBe('run');
    expect(of(text, { accept: 'text/plain' })).toBe('run');
    expect(of(text, { accept: 'application/json' })).toBe('refused');
    expect(of(text, { accept: 'application/*' })).toBe('refused');
  });

  it('runs a route that produces nothing in particular whatever is asked', () => {
    expect(of({ produces: null }, { accept: 'image/png' })).toBe('run');
  });

  it('runs a POST whose body its mapping does not consume, for the 415 Spring answers first', () => {
    const post: Pick<Endpoint, 'produces' | 'consumes'> = { consumes: [['text', 'plain']] };
    expect(of(post, { accept: 'text/plain', 'content-type': 'application/xml' })).toBe('run');
    expect(of(post, { accept: 'text/plain', 'content-type': 'text/plain' })).toBe('refused');
  });

  it("answers Spring's 500 for a quality it cannot read while sorting the types", () => {
    const answer = acceptance(json, requestWith({ accept: 'text/plain, application/json;Q=x' }));
    expect(answer).toMatchObject({ kind: 'answer', answer: { status: 500 } });
  });

  // The edge keys by URL alone, so an answer whose type may carry the
  // Accept's parameters (a charset it is written in) is never stored there.
  it("says when the type chosen carries the Accept's parameters, its quality aside", () => {
    expect(acceptance(json, requestWith({ accept: 'application/json;charset=UTF-16' }))).toEqual({
      kind: 'run',
      parameters: true,
    });
    expect(acceptance(json, requestWith({ accept: '*/*;x=y' }))).toEqual({ kind: 'run' });
    expect(acceptance(json, requestWith({ accept: 'application/json;q=0.5' }))).toEqual({
      kind: 'run',
    });
    expect(acceptance(json, requestWith({ accept: 'application/json' }))).toEqual({ kind: 'run' });
  });

  it('runs the handler, but fails what it writes, for a quality Spring checks only then', () => {
    expect(acceptance(json, requestWith({ accept: 'application/json;Q=x' }))).toEqual({
      kind: 'run',
      afterwards: 'For input string: "x"',
    });
  });

  // What the site and the services beside it send: Angular's HttpClient,
  // fetch's default, the release check's, and the MCP server's (JSON for
  // JSON routes, text/plain for text ones, as written against Java).
  it('never refuses what the site and its services send', () => {
    for (const each of endpoints) {
      for (const accept of [undefined, '*/*', 'application/json, text/plain, */*']) {
        const headers: Record<string, string> = accept === undefined ? {} : { accept };
        expect([each.path, accept, of(each, headers)]).toEqual([each.path, accept, 'run']);
      }
      if (each.method === undefined && each.produces !== null)
        expect([each.path, of(each, { accept: 'application/json, text/plain' })]).toEqual([
          each.path,
          'run',
        ]);
    }
    for (const path of [
      '/data/database/version',
      '/data/database/name',
      '/data/query/{id}/{attribute}',
    ])
      expect(of(endpoint(path), { accept: 'text/plain' })).toBe('run');
    for (const path of ['/data/species/main', '/data/query/{id}', '/search/query'])
      expect(of(endpoint(path), { accept: 'application/json' })).toBe('run');
  });
});

describe('a quality Spring checks only when it writes', () => {
  it("fails the handler's value, but not its error, nor an answer with no body", async () => {
    const route = (status: number, body?: unknown): Endpoint => ({
      path: '/ContentService/x',
      handler: () => ({ status, type: 'application/json', body }),
    });
    const service = express();
    const afterwards = 'For input string: "x"';
    service.get('/value', (q, r) => answer(route(200, [1]), q, r, { afterwards }));
    service.get('/error', (q, r) => answer(route(404, '{}'), q, r, { afterwards }));
    service.get('/nothing', (q, r) => answer(route(200), q, r, { afterwards }));
    const listening = await new Promise<Server>((resolve) => {
      const started: Server = service.listen(0, '127.0.0.1', () => resolve(started));
    });
    const at = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
    try {
      const value = await fetch(`${at}/value`);
      expect([value.status, JSON.parse(await value.text())]).toMatchObject([
        500,
        { code: 500, messages: [afterwards] },
      ]);
      expect((await fetch(`${at}/error`)).status).toBe(404);
      expect((await fetch(`${at}/nothing`)).status).toBe(200);
    } finally {
      listening.close();
    }
  });
});

describe("errorPage, Spring's own 404 by Accept", () => {
  it('is the JSON, the Whitelabel page, nothing, or a 500, as measured', () => {
    const rows: [string | undefined, string][] = [
      [undefined, 'json'],
      ['*/*', 'json'],
      ['application/json', 'json'],
      ['application/*', 'json'],
      ['application/json, text/plain, */*', 'json'],
      ['text/plain', 'none'],
      // Any of the types, not only the first, may be JSON.
      ['text/plain, application/json', 'json'],
      ['application/xml', 'none'],
      ['text/html', 'html'],
      ['text/*', 'html'],
      ['text/html;q=0.9,application/json;q=0.8', 'html'],
      ['text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'html'],
      ['garbage', 'failed'],
    ];
    for (const [accept, kind] of rows)
      expect([accept, errorPage(accept).kind]).toEqual([accept, kind]);
  });
});

describe('javaContentType', () => {
  it('adds the charset Spring adds, and keeps one given', () => {
    expect(javaContentType('application/json')).toBe('application/json;charset=UTF-8');
    expect(javaContentType('text/plain;charset=ISO-8859-1')).toBe('text/plain;charset=ISO-8859-1');
  });
});

/** One request, as the service answers it. */
async function ask(
  path: string,
  headers: Record<string, string> = {},
  method = 'GET',
  body?: string
) {
  const response = await fetch(`${base}/ContentService${path}`, {
    method,
    headers,
    body: body ?? null,
  });
  const text = await response.text();
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    rule: response.headers.get('x-cache-rule'),
    etag: response.headers.get('etag'),
    text,
    messages: text.startsWith('{"code"')
      ? (JSON.parse(text) as { messages: string[] }).messages
      : undefined,
  };
}

const NOT_ACCEPTABLE = {
  status: 406,
  type: 'application/json;charset=UTF-8',
  messages: ['Could not find acceptable representation'],
};

describe('through the service', () => {
  it("answers Spring's 406 on a JSON route for text, before the handler: before a 404", async () => {
    expect(await ask('/data/species/main', { accept: 'text/plain' })).toMatchObject(NOT_ACCEPTABLE);
    expect(await ask('/data/query/R-HSA-0000000', { accept: 'application/xml' })).toMatchObject(
      NOT_ACCEPTABLE
    );
    expect(await ask('/data/schema/Pathway/min?page=abc', { accept: 'text/html' })).toMatchObject(
      NOT_ACCEPTABLE
    );
  });

  it("answers Spring's 406 on a text route for JSON", async () => {
    expect(await ask('/data/database/version', { accept: 'application/json' })).toMatchObject(
      NOT_ACCEPTABLE
    );
    expect(await ask('/data/query/ids/map', { accept: 'application/json' })).toMatchObject(
      NOT_ACCEPTABLE
    );
    expect(await ask('/data/query/ids/map', { accept: 'text/*' })).toMatchObject({
      status: 404,
      messages: ['Id: ids has not been found in the System'],
    });
  });

  it('tries the next mapping of the path, as Spring does, and never stores what it answers', async () => {
    // /query/enhanced/{id} takes no text; /query/{id}/{attributeName} does,
    // for an object called "enhanced".
    expect(await ask('/data/query/enhanced/R-HSA-1', { accept: 'text/plain' })).toMatchObject({
      status: 404,
      messages: ['Id: enhanced has not been found in the System'],
      rule: 'status',
    });
  });

  // Express sends a path it cannot decode (%FF) to the error handler, which
  // tries the mappings of the path in turn, as the routes do.
  it('tries the next mapping for a path Express cannot decode, too', async () => {
    expect(await ask('/data/query/%FF/more', { accept: 'text/plain' })).toMatchObject({
      status: 404,
      messages: ['Id: \uFFFD has not been found in the System'],
      rule: 'status',
    });
    expect(await ask('/data/query/%FF/more', { accept: 'application/xml' })).toMatchObject(
      NOT_ACCEPTABLE
    );
  });

  it('answers a 415 before a 406, and a 405 before either', async () => {
    const xml = { accept: 'text/plain', 'content-type': 'application/xml' };
    expect(await ask('/data/query/ids', xml, 'POST', 'R-HSA-1')).toMatchObject({ status: 415 });
    expect(await ask('/download/table.csv', { accept: 'application/json' })).toMatchObject({
      status: 405,
    });
  });

  it("answers Spring's own 404 in the form Accept chooses", async () => {
    const json = await ask('/data//nothing');
    expect([json.status, json.type, json.text.startsWith('{"timestamp":')]).toEqual([
      404,
      'application/json;charset=UTF-8',
      true,
    ]);
    const html = await ask('/data//nothing', { accept: 'text/html' });
    expect([html.status, html.type]).toEqual([404, 'text/html;charset=UTF-8']);
    expect(html.text).toMatch(
      /^<html><body><h1>Whitelabel Error Page<\/h1>.*<div id='created'>\w{3} \w{3} \d{2} \d{2}:\d{2}:\d{2} UTC \d{4}<\/div><div>There was an unexpected error \(type=Not Found, status=404\)\.<\/div><\/body><\/html>$/
    );
    // JSON when any type accepted is, not only the first.
    const either = await ask('/data//nothing', { accept: 'text/plain, application/json' });
    expect([either.status, either.type, either.text.startsWith('{"timestamp":')]).toEqual([
      404,
      'application/json;charset=UTF-8',
      true,
    ]);
    expect(await ask('/data//nothing', { accept: 'text/plain' })).toMatchObject({
      status: 404,
      type: null,
      text: '',
    });
    expect(await ask('/data//nothing', { accept: 'garbage' })).toMatchObject({
      status: 500,
      messages: ['Invalid mime type "garbage": does not contain \'/\''],
    });
  });

  it("writes JSON under Java's type, its ETag still taken", async () => {
    const answer = await ask('/data/species/main', { accept: 'text/plain' });
    expect(answer.type).toBe('application/json;charset=UTF-8');
    expect(answer.etag).toMatch(/^W\/"/);
  });
});
