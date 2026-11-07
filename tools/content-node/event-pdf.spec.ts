// @vitest-environment node
//
// /exporter/document/event/{id}.pdf (spec 006 T100): node writes Java's answer
// around the PDF made by pdf-export's single-event service. Java's answers
// measured on 7 Nov 2026 from this host's ContentService: the 404 and 400 name
// the id as given; the parameters are converted first, `level [0 - 1]` by that
// name (a `level` is not read); the PDF is `application/pdf;charset=UTF-8`,
// its file name the stable id with the extension outside the quotes.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { eventPdfAnswer, type ExportEvent } from './exporters-endpoints.ts';
import { writeResult } from './server.ts';
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
    originalUrl: `/ContentService/exporter/document/event/${path}`,
    protocol: 'http',
    get: () => 'localhost',
  }) as unknown as Request;

const envelope = (answer: Answer) => {
  const body = JSON.parse(String(answer.body)) as { reason: string; messages: string[] };
  return [answer.status, body.reason, body.messages];
};

// The PDF service, as each case needs it to behave.
let behave: (req: IncomingMessage, response: ServerResponse) => void;
let asked: string[] = [];
let service: Server;
let serviceUrl: string;
const PDF = '%PDF-1.7\n' + 'x'.repeat(2_000_000) + '\n%%EOF\n';
const pdf = (_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': String(PDF.length) });
  res.end(PDF);
};
const refuse = (status: number, reason: string) => (_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ reason }));
};

beforeAll(async () => {
  service = createServer((req, res) => {
    asked.push(String(req.url));
    behave(req, res);
  });
  await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', () => resolve()));
  serviceUrl = `http://127.0.0.1:${(service.address() as AddressInfo).port}`;
});
afterAll(() => {
  service.closeAllConnections();
  return new Promise<void>((resolve) => service.close(() => resolve()));
});
afterEach(() => {
  delete process.env['PDF_SERVICE'];
  asked = [];
});

const withService = () => (process.env['PDF_SERVICE'] = serviceUrl);
const answers = (path: string, headersMs?: number) =>
  eventPdfAnswer(request(path), find, headersMs);

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

const INTEGER = (value: string) =>
  `Failed to convert value of type 'java.lang.String' to required type 'java.lang.Integer'; nested exception is java.lang.NumberFormatException: For input string: "${value}"`;

describe('what Java answers before any PDF is made', () => {
  it('names an id nothing has, as given, in a 404', async () => {
    withService();
    expect(envelope(await answers('R-HSA-0.3.pdf'))).toEqual([
      404,
      'NOT_FOUND',
      ["'R-HSA-0.3' does not exist"],
    ]);
    expect(asked).toEqual([]);
  });

  it('refuses an object that is no pathway or reaction with a 400', async () => {
    withService();
    expect(envelope(await answers('9626065.pdf'))).toEqual([
      400,
      'BAD_REQUEST',
      ["'9626065' is not an event"],
    ]);
    expect(asked).toEqual([]);
  });

  it('converts the parameters first, as Spring does, under Java’s own names', async () => {
    withService();
    expect(envelope(await answers('R-HSA-0.pdf?level%20%5B0%20-%201%5D=x'))).toEqual([
      400,
      'BAD_REQUEST',
      [INTEGER('x')],
    ]);
    expect(envelope(await answers('R-HSA-0.pdf?expColumn=x'))).toEqual([
      400,
      'BAD_REQUEST',
      [INTEGER('x')],
    ]);
    expect(envelope(await answers('R-HSA-0.pdf?importableOnly=x'))).toEqual([
      400,
      'BAD_REQUEST',
      [
        "Failed to convert value of type 'java.lang.String' to required type 'java.lang.Boolean'; nested exception is java.lang.IllegalArgumentException: Invalid boolean value [x]",
      ],
    ]);
    // `level` is not Java's name for it: not read, so not refused.
    expect((await answers('R-HSA-0.pdf?level=x')).status).toBe(404);
    // An empty one is the default.
    expect((await answers('R-HSA-0.pdf?level%20%5B0%20-%201%5D=&expColumn=')).status).toBe(404);
    expect(asked).toEqual([]);
  });

  it("leaves another extension to Spring's 404, never a PDF", async () => {
    withService();
    expect((await answers('R-HSA-1.svg')).status).toBe(404);
    expect((await answers('R-HSA-1')).status).toBe(404);
    expect(asked).toEqual([]);
  });

  it('answers 503 without the service, never another implementation', async () => {
    expect(envelope(await answers('R-HSA-1.pdf'))).toEqual([
      503,
      'SERVICE_UNAVAILABLE',
      ['The PDF service is not configured'],
    ]);
  });
});

describe('the PDF', () => {
  it('passes the service’s PDF on, with Java’s type and file name, from any form of the id', async () => {
    withService();
    behave = pdf;
    for (const path of ['R-HSA-1.pdf', 'R-HSA-1.4.pdf', '1.pdf']) {
      const answer = await answers(path);
      expect(answer.status).toBe(200);
      expect(answer.type).toBe('application/pdf;charset=UTF-8');
      expect(answer.headers).toEqual({
        'Content-Disposition': 'attachment; filename="R-HSA-1".pdf',
      });
      const { response, text } = await served(answer);
      expect(response.headers.get('content-type')).toBe('application/pdf;charset=UTF-8');
      expect(response.headers.get('content-disposition')).toBe(
        'attachment; filename="R-HSA-1".pdf'
      );
      expect(text).toBe(PDF);
    }
    expect(asked).toEqual([
      '/event/R-HSA-1.pdf?depth=1',
      '/event/R-HSA-1.pdf?depth=1',
      '/event/R-HSA-1.pdf?depth=1',
    ]);
  });

  it('asks for the depth Java’s level gives: below 0 is 0, above 1 is 1, a blank one the default', async () => {
    withService();
    behave = pdf;
    const level = (value: string) => `R-HSA-1.pdf?level%20%5B0%20-%201%5D=${value}`;
    for (const path of [level('0'), level('-3'), level('1'), level('5'), level('%20'), level('')]) {
      const answer = await answers(path);
      expect(answer.status).toBe(200);
      await served(answer);
    }
    expect(asked.map((url) => new URL(url, 'http://x').searchParams.get('depth'))).toEqual([
      '0',
      '0',
      '1',
      '1',
      '1',
      '1',
    ]);
  });

  it('passes the token on as it was sent, encoded once, and nothing else of the analysis', async () => {
    withService();
    behave = pdf;
    const answer = await answers(
      'R-HSA-1.pdf?token=MjAyNjExMDcxNjE3MzZfNA%3D%3D&resource=UNIPROT&analysisProfile=Copper'
    );
    expect(answer.status).toBe(200);
    await served(answer);
    expect(asked).toEqual(['/event/R-HSA-1.pdf?depth=1&token=MjAyNjExMDcxNjE3MzZfNA%3D%3D']);
  });

  it('ends the connection when the PDF fails part way, so a cut-off PDF is never taken for a whole one', async () => {
    withService();
    behave = (_req, res) => {
      res.writeHead(200, { 'Content-Length': String(PDF.length) });
      res.write(PDF.slice(0, 1000), () => res.destroy());
    };
    // More times than the share holds: each failure gives its place back.
    for (let time = 0; time < 3; time += 1) {
      const answer = await answers('R-HSA-1.pdf');
      expect(answer.status).toBe(200);
      await expect(served(answer)).rejects.toThrow();
    }
  });
});

describe('the service’s refusals, in Java’s envelope', () => {
  const NOT_HELD = 'The analysis result for the token is no longer held; run the analysis again';
  const UNKNOWN = 'No analysis result is known for the token; run the analysis again';
  const BUSY = 'The PDF cannot be made just now; try again shortly';
  const cases: [string, number, string, [number, string, string[]], string | undefined][] = [
    ['an unknown token', 404, 'unknown-token', [404, 'NOT_FOUND', [UNKNOWN]], undefined],
    ['a token whose result has gone', 410, 'gone-token', [410, 'GONE', [NOT_HELD]], undefined],
    [
      'the service unable to answer',
      503,
      'unavailable',
      [503, 'SERVICE_UNAVAILABLE', [BUSY]],
      '30',
    ],
    // The event was found here: the service not finding it is the service out of step.
    ['no-event from the service', 404, 'no-event', [503, 'SERVICE_UNAVAILABLE', [BUSY]], '30'],
    [
      'not-an-event from the service',
      400,
      'not-an-event',
      [503, 'SERVICE_UNAVAILABLE', [BUSY]],
      '30',
    ],
    [
      'a depth refused',
      400,
      'bad-depth',
      [500, 'INTERNAL_SERVER_ERROR', ['The PDF of R-HSA-1 cannot be made']],
      undefined,
    ],
    [
      'a failure of its own',
      500,
      'whatever',
      [500, 'INTERNAL_SERVER_ERROR', ['The PDF of R-HSA-1 cannot be made']],
      undefined,
    ],
  ];
  for (const [what, status, reason, expected, retry] of cases)
    it(`answers ${what} (${status} ${reason})`, async () => {
      withService();
      behave = refuse(status, reason);
      const answer = await answers('R-HSA-1.pdf?token=MjAyNjExMDcxNjE3MzZfNA%3D%3D');
      expect(envelope(answer)).toEqual(expected);
      expect(answer.headers?.['Retry-After']).toBe(retry);
    });

  it('a 404 that is no answer of the service’s is the service out of step, not an unknown token', async () => {
    withService();
    behave = (_req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    };
    expect(envelope(await answers('R-HSA-1.pdf'))).toEqual([
      500,
      'INTERNAL_SERVER_ERROR',
      ['The PDF of R-HSA-1 cannot be made'],
    ]);
  });

  it('a service that cannot be reached is a 503', async () => {
    process.env['PDF_SERVICE'] = 'http://127.0.0.1:9';
    expect(envelope(await answers('R-HSA-1.pdf'))).toEqual([
      503,
      'SERVICE_UNAVAILABLE',
      ['The PDF service cannot be reached'],
    ]);
  });

  it('a service that sends no headers in time is a 503, and gives its place back', async () => {
    withService();
    behave = () => undefined; // never answers
    for (let time = 0; time < 3; time += 1)
      expect(envelope(await answers('R-HSA-1.pdf', 200))).toEqual([
        503,
        'SERVICE_UNAVAILABLE',
        ['The PDF took too long to make'],
      ]);
  });
});

describe('the PDF’s own share of two', () => {
  it('refuses a third PDF at once, and takes the next when one is done', async () => {
    withService();
    const held: Array<() => void> = [];
    behave = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.write('%PDF');
      held.push(() => res.end('-1.7'));
    };
    const first = await answers('R-HSA-1.pdf');
    const second = await answers('R-HSA-1.pdf');
    const third = await answers('R-HSA-1.pdf');
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(envelope(third)).toEqual([
      503,
      'SERVICE_UNAVAILABLE',
      ['Too many PDFs are being made; try again shortly'],
    ]);
    expect(third.headers).toEqual({ 'Retry-After': '5' });

    // One PDF passed on to its reader frees its place.
    const reading = served(first);
    held.shift()?.();
    expect((await reading).text).toBe('%PDF-1.7');
    const fourth = await answers('R-HSA-1.pdf');
    expect(fourth.status).toBe(200);

    held.forEach((end) => end());
    await served(second);
    await served(fourth);
  });
});
