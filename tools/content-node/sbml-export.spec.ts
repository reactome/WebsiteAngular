// @vitest-environment node
//
// /exporter/event/{id}.sbml and /exporter/sbml/{id}.xml (spec 015 T065): node
// writes Java's answer around the SBML service's file. Java's answers measured
// on 26 Oct 2026 from this host's ContentService: the 404 names the id as
// given, a non-event is a 400, and the file is named by the event's stable id
// without its version whatever form was asked for.
import { createServer, type Server, type ServerResponse } from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { sbmlAnswer, type SbmlEvent } from './exporters-endpoints.ts';
import { writeResult } from './server.ts';
import type { Answer, Request } from './endpoint.ts';

/** The graph as these cases need it: one pathway, one object that is no event. */
const find = async (raw: string): Promise<SbmlEvent | null> => {
  const id = raw.split('.')[0];
  if (id === 'R-HSA-1' || id === '1') return { stId: 'R-HSA-1', isEvent: true };
  if (id === '9626065') return { stId: null, isEvent: false };
  return null;
};

const request = (path: string): Request =>
  ({
    originalUrl: `/ContentService/exporter/${path}`,
    protocol: 'http',
    get: () => 'localhost',
  }) as unknown as Request;

const envelope = (answer: Answer) => {
  const body = JSON.parse(String(answer.body)) as { reason: string; messages: string[] };
  return [answer.status, body.reason, body.messages];
};

// The SBML service, as each case needs it to behave.
let behave: (stId: string, response: ServerResponse) => void;
let asked: string[] = [];
let service: Server;
let serviceUrl: string;
const FILE = '<sbml>' + 'x'.repeat(3_000_000) + '</sbml>';

beforeAll(async () => {
  service = createServer((req, res) => {
    const stId = String(req.url).replace('/sbml/', '');
    asked.push(stId);
    behave(stId, res);
  });
  await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', () => resolve()));
  serviceUrl = `http://127.0.0.1:${(service.address() as AddressInfo).port}`;
});
afterAll(() => {
  service.closeAllConnections();
  return new Promise<void>((resolve) => service.close(() => resolve()));
});
afterEach(() => {
  delete process.env['SBML_SERVICE'];
  asked = [];
});

const withService = () => (process.env['SBML_SERVICE'] = serviceUrl);
const answers = (path: string, ext: 'sbml' | 'xml' = 'sbml', headersMs?: number) =>
  sbmlAnswer(request(path), ext, find, headersMs);

/** An answer written by the service's own writer, read back by a client: what a reader gets. */
async function served(answer: Answer) {
  const front = express()
    .get('/', (_req, res) => writeResult(res, answer))
    .listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => front.once('listening', () => resolve()));
  try {
    const response = await fetch(`http://127.0.0.1:${(front.address() as AddressInfo).port}/`);
    return { response, text: await response.text() };
  } finally {
    front.closeAllConnections();
    front.close();
  }
}

describe('what Java answers before any file is made', () => {
  it('names an id nothing has, as given, in a 404', async () => {
    withService();
    expect(envelope(await answers('event/R-HSA-0.3.sbml'))).toEqual([
      404,
      'NOT_FOUND',
      ["Identifier 'R-HSA-0.3' not found"],
    ]);
    expect(asked).toEqual([]);
  });

  it('refuses an object that is no pathway or reaction with a 400', async () => {
    withService();
    expect(envelope(await answers('event/9626065.sbml'))).toEqual([
      400,
      'BAD_REQUEST',
      ["The identifier '9626065' does not correspond to a pathway or reaction"],
    ]);
    expect(asked).toEqual([]);
  });

  it("leaves another extension to Java: Spring's 404 here, never an SBML file", async () => {
    withService();
    expect((await answers('event/R-HSA-1.sbgn')).status).toBe(404);
    expect((await answers('sbml/R-HSA-1.sbml', 'xml')).status).toBe(404);
    expect(asked).toEqual([]);
  });

  it('answers 503 without the service, never another implementation', async () => {
    expect(envelope(await answers('event/R-HSA-1.sbml'))).toEqual([
      503,
      'SERVICE_UNAVAILABLE',
      ['The SBML service is not configured'],
    ]);
  });
});

describe('the file', () => {
  it('passes the service’s file on, named by the stable id, from any form of the id', async () => {
    withService();
    behave = (_stId, res) => {
      res.writeHead(200, { 'Content-Type': 'application/sbml+xml;charset=UTF-8' });
      res.end(FILE);
    };
    for (const path of ['event/R-HSA-1.sbml', 'event/R-HSA-1.4.sbml', 'event/1.sbml']) {
      const answer = await answers(path);
      expect(answer.status).toBe(200);
      expect(answer.type).toBe('application/sbml+xml;charset=UTF-8');
      expect(answer.headers).toEqual({
        'Content-Disposition': 'attachment; filename="R-HSA-1.sbml"',
      });
      const { response, text } = await served(answer);
      expect(response.headers.get('content-type')).toBe('application/sbml+xml;charset=UTF-8');
      expect(text).toBe(FILE);
    }
    const xml = await answers('sbml/R-HSA-1.xml', 'xml');
    expect(xml.headers).toEqual({ 'Content-Disposition': 'attachment; filename="R-HSA-1.sbml"' });
    expect((await served(xml)).text).toBe(FILE);
    expect(asked).toEqual(['R-HSA-1', 'R-HSA-1', 'R-HSA-1', 'R-HSA-1']);
  });

  it('ends the connection when the file fails part way, so a cut-off file is never taken for a whole one', async () => {
    withService();
    behave = (_stId, res) => {
      res.writeHead(200, { 'Content-Length': String(FILE.length) });
      res.write(FILE.slice(0, 1000), () => res.destroy());
    };
    // More times than the share holds: each failure gives its place back, or
    // the third would be refused and SBML would stay refused until a restart.
    for (let time = 0; time < 3; time += 1) {
      const answer = await answers('event/R-HSA-1.sbml');
      expect(answer.status).toBe(200);
      await expect(served(answer)).rejects.toThrow();
    }
  });
});

describe('when the service cannot answer', () => {
  it('a missing diagram (its 503) is a 503 to try again, without the service’s own reason', async () => {
    withService();
    behave = (_stId, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end('{"error":"Cannot fetch /cache/diagram/97/R-HSA-1.json"}');
    };
    const answer = await answers('event/R-HSA-1.sbml');
    expect(envelope(answer)).toEqual([
      503,
      'SERVICE_UNAVAILABLE',
      ["The pathway's diagram cannot be had just now; try again shortly"],
    ]);
    expect(answer.headers).toEqual({ 'Retry-After': '30' });
    expect(String(answer.body)).not.toContain('/cache');
  });

  it('a failure (its 500) is a 500, without the service’s own reason', async () => {
    withService();
    behave = (_stId, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":"R-HSA-1 cannot be converted: /cache/tmp/abc"}');
    };
    const answer = await answers('event/R-HSA-1.sbml');
    expect(envelope(answer)).toEqual([
      500,
      'INTERNAL_SERVER_ERROR',
      ['The SBML of R-HSA-1 cannot be made'],
    ]);
    expect(String(answer.body)).not.toContain('/cache');
  });

  it('a service that cannot be reached is a 503', async () => {
    process.env['SBML_SERVICE'] = 'http://127.0.0.1:9';
    expect(envelope(await answers('event/R-HSA-1.sbml'))).toEqual([
      503,
      'SERVICE_UNAVAILABLE',
      ['The SBML service cannot be reached'],
    ]);
  });

  it('a service that sends no headers in time is a 503', async () => {
    withService();
    behave = () => undefined; // never answers
    expect(envelope(await answers('event/R-HSA-1.sbml', 'sbml', 200))).toEqual([
      503,
      'SERVICE_UNAVAILABLE',
      ['The SBML file took too long to make'],
    ]);
  });
});

describe('SBML’s own share of two', () => {
  it('refuses a third file at once, and takes the next when one is done', async () => {
    withService();
    const held: Array<() => void> = [];
    behave = (_stId, res) => {
      res.writeHead(200, { 'Content-Type': 'application/sbml+xml;charset=UTF-8' });
      res.write('<sbml>');
      held.push(() => res.end('</sbml>'));
    };
    const first = await answers('event/R-HSA-1.sbml');
    const second = await answers('event/R-HSA-1.sbml');
    const third = await answers('event/R-HSA-1.sbml');
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(envelope(third)).toEqual([
      503,
      'SERVICE_UNAVAILABLE',
      ['Too many SBML files are being made; try again shortly'],
    ]);
    expect(third.headers).toEqual({ 'Retry-After': '5' });

    // One file passed on to its reader frees its place.
    const reading = served(first);
    held.shift()?.();
    expect((await reading).text).toBe('<sbml></sbml>');
    const fourth = await answers('event/R-HSA-1.sbml');
    expect(fourth.status).toBe(200);

    held.forEach((end) => end());
    await served(second);
    await served(fourth);
  });
});
