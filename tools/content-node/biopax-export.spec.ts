// @vitest-environment node
//
// /exporter/event/{id}.biopax (spec 015 T070): node writes research R6's
// answer around the library service's BioPAX file (T069). Java has no BioPAX
// URL, so R6 chose the answers: application/rdf+xml, a {stId}.biopax download,
// and SBML's 404 and 400 in the envelope.
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import {
  biopaxAnswer,
  eventExportAnswer,
  exportersEndpoints,
  sbmlAnswer,
  type ExportEvent,
} from './exporters-endpoints.ts';
import type { Answer, Request } from './endpoint.ts';

/** The graph as these cases need it: one pathway, one object that is no event. */
const find = async (raw: string): Promise<ExportEvent | null> => {
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

// The library service, as each case needs it to behave.
let behave: (path: string, response: ServerResponse) => void;
let asked: string[] = [];
let service: Server;
let serviceUrl: string;

beforeAll(async () => {
  service = createServer((req, res) => {
    asked.push(String(req.url));
    behave(String(req.url), res);
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
const answers = (path: string, headersMs?: number) => biopaxAnswer(request(path), find, headersMs);

async function text(answer: Answer) {
  const chunks: Buffer[] = [];
  for await (const chunk of answer.body as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

describe('before any file is made', () => {
  it('names an id nothing has, as given, in a 404', async () => {
    withService();
    expect(envelope(await answers('event/R-HSA-0.3.biopax'))).toEqual([
      404,
      'NOT_FOUND',
      ["Identifier 'R-HSA-0.3' not found"],
    ]);
    expect(asked).toEqual([]);
  });

  it('refuses an object that is no pathway or reaction with a 400', async () => {
    withService();
    expect(envelope(await answers('event/9626065.biopax'))).toEqual([
      400,
      'BAD_REQUEST',
      ["The identifier '9626065' does not correspond to a pathway or reaction"],
    ]);
    expect(asked).toEqual([]);
  });

  it('answers 503 without the service, never another implementation', async () => {
    expect(envelope(await answers('event/R-HSA-1.biopax'))).toEqual([
      503,
      'SERVICE_UNAVAILABLE',
      ['The BioPAX service is not configured'],
    ]);
  });
});

describe('the file', () => {
  it('passes the service’s BioPAX on, as RDF named {stId}.biopax, from any form of the id', async () => {
    withService();
    behave = (_path, res) => {
      res.writeHead(200, { 'Content-Type': 'application/rdf+xml;charset=UTF-8' });
      res.end('<rdf:RDF/>');
    };
    for (const path of ['R-HSA-1.biopax', 'R-HSA-1.4.biopax', '1.biopax', 'R-HSA-1.biopax/']) {
      const answer = await answers(`event/${path}`);
      expect(answer.status).toBe(200);
      expect(answer.type).toBe('application/rdf+xml;charset=UTF-8');
      expect(answer.headers?.['Content-Disposition']).toBe('attachment; filename="R-HSA-1.biopax"');
      expect(await text(answer)).toBe('<rdf:RDF/>');
    }
    // The service is asked for BioPAX, by the bare stable id
    expect(asked).toEqual(Array(4).fill('/biopax/R-HSA-1'));
  });

  it('the service’s 404 is a 404, and its failure a 500 without its own reason', async () => {
    withService();
    behave = (_path, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"No event"}');
    };
    expect((await answers('event/R-HSA-1.biopax')).status).toBe(404);
    behave = (_path, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":"/cache/tmp/biopax/x cannot be written"}');
    };
    expect(envelope(await answers('event/R-HSA-1.biopax'))).toEqual([
      500,
      'INTERNAL_SERVER_ERROR',
      ['The BioPAX of R-HSA-1 cannot be made'],
    ]);
  });

  it('the service’s 503 is a 503 to try again, and a service not there is a 503, in BioPAX’s words', async () => {
    withService();
    behave = (_path, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end('{"error":"/cache busy"}');
    };
    const busy = await answers('event/R-HSA-1.biopax');
    expect(envelope(busy)).toEqual([
      503,
      'SERVICE_UNAVAILABLE',
      ['The BioPAX file cannot be made just now; try again shortly'],
    ]);
    expect(busy.headers?.['Retry-After']).toBe('30');
    process.env['SBML_SERVICE'] = 'http://127.0.0.1:9';
    expect(envelope(await answers('event/R-HSA-1.biopax'))).toEqual([
      503,
      'SERVICE_UNAVAILABLE',
      ['The BioPAX service cannot be reached'],
    ]);
  });

  it('a service that sends no headers in time is a 503', async () => {
    withService();
    behave = () => undefined;
    expect(envelope(await answers('event/R-HSA-1.biopax', 50))).toEqual([
      503,
      'SERVICE_UNAVAILABLE',
      ['The BioPAX file took too long to make'],
    ]);
    service.closeAllConnections();
  });
});

describe('BioPAX’s own share of two', () => {
  it('refuses a third file, and is not taken by SBML’s', async () => {
    withService();
    const held: ServerResponse[] = [];
    behave = (_path, res) => {
      held.push(res);
    };
    const biopax = [answers('event/R-HSA-1.biopax'), answers('event/R-HSA-1.biopax')];
    const sbml = [
      sbmlAnswer(request('event/R-HSA-1.sbml'), 'sbml', find),
      sbmlAnswer(request('event/R-HSA-1.sbml'), 'sbml', find),
    ];
    await expect.poll(() => held.length).toBe(4);
    // SBML's two do not count against BioPAX's share, and BioPAX's own are full
    const third = await answers('event/R-HSA-1.biopax');
    expect(envelope(third)).toEqual([
      503,
      'SERVICE_UNAVAILABLE',
      ['Too many BioPAX files are being made; try again shortly'],
    ]);
    expect(third.headers?.['Retry-After']).toBe('5');
    for (const res of held) {
      res.writeHead(200);
      res.end('x');
    }
    for (const answer of [...(await Promise.all(biopax)), ...(await Promise.all(sbml))])
      await text(answer);
    // A place is given back once a file has been passed on
    behave = (_path, res) => {
      res.writeHead(200);
      res.end('<rdf:RDF/>');
    };
    await expect.poll(async () => (await answers('event/R-HSA-1.biopax')).status).toBe(200);
  });
});

describe('/exporter/event/{id}', () => {
  it('answers .biopax with BioPAX and .sbml with SBML, and leaves .sbgn to Java', async () => {
    withService();
    behave = (_path, res) => {
      res.writeHead(200);
      res.end('x');
    };
    const biopax = await eventExportAnswer(request('event/R-HSA-1.biopax'), find);
    expect(biopax.headers?.['Content-Disposition']).toBe('attachment; filename="R-HSA-1.biopax"');
    await text(biopax);
    const sbml = await eventExportAnswer(request('event/R-HSA-1.sbml'), find);
    expect(sbml.headers?.['Content-Disposition']).toBe('attachment; filename="R-HSA-1.sbml"');
    await text(sbml);
    expect((await eventExportAnswer(request('event/R-HSA-1.sbgn'), find)).status).toBe(404);
    expect(asked).toEqual(['/biopax/R-HSA-1', '/sbml/R-HSA-1']);
  });

  it('is the endpoint’s handler', () => {
    const endpoint = exportersEndpoints.find(
      (candidate) => candidate.path === '/ContentService/exporter/event/{id}'
    );
    expect(String(endpoint?.handler)).toContain('eventExportAnswer');
  });
});

describe('standard form, which decides what is cached per release (spec 011)', () => {
  it('takes .biopax and .sbml on /exporter/event/, and nothing else', async () => {
    const { standardForm } = await import('./parameters.ts');
    const form = (path: string) =>
      standardForm('/ContentService/exporter/event/{id}', `/ContentService/exporter/event/${path}`);
    expect(form('R-HSA-1.biopax')).toEqual({ ok: true });
    expect(form('R-HSA-1.sbml')).toEqual({ ok: true });
    expect(form('R-HSA-1.owl')).toEqual({ ok: false, rule: 'path:id' });
    expect(form('R-HSA-1.biopax.sbml')).toEqual({ ok: false, rule: 'path:id' });
  });
});
