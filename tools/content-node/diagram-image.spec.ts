// @vitest-environment node
//
// /exporter/diagram/{identifier}.{ext} through the server (spec 006 T090,
// T091, research D24): the resolution as the render request, Java's answers
// once it is resolved, the figure's headers and its cache label. The graph and
// the render service are stand-ins; the error bodies are Java's, measured on
// 8 Nov 2026, with this server's address for Java's.
import { createServer, request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHEABLE } from './cache-label.ts';

/** What graph-core's DiagramService resolves each id to. */
const RESULTS: Record<string, { diagramStId: string; events: string[] }> = {
  'R-HSA-109606': { diagramStId: 'R-HSA-109606', events: [] },
  'R-HSA-5205685': { diagramStId: 'R-HSA-5205647', events: ['R-HSA-1', 'R-HSA-2'] },
  'R-HSA-6805479': { diagramStId: 'R-HSA-6804756', events: ['R-HSA-6805479'] },
  'R-HSA-1640170': { diagramStId: 'R-HSA-1640170', events: [] },
  'R-HSA-1640171': { diagramStId: 'R-HSA-1640170', events: ['R-HSA-3'] },
};
const ILLUSTRATED = new Set(['R-HSA-1640170']);
vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: { stId?: string } = {}) => {
    const stId = params.stId ?? '';
    if (cypher.includes('hasEHLD')) return [{ ehld: ILLUSTRATED.has(stId) }];
    const found = RESULTS[stId];
    return found ? [{ ...found, width: 1, height: 1, level: 1 }] : [];
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

const drawn: URL[] = [];
const render = createServer((request, response) => {
  drawn.push(new URL(String(request.url), 'http://render'));
  response.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Disposition': 'inline; filename="x.png"',
    'X-Render-Cache': 'hit',
  });
  response.end('FIGURE');
});
await new Promise<void>((resolve) => render.listen(0, '127.0.0.1', () => resolve()));
process.env['RENDER_SERVICE_URL'] = `http://127.0.0.1:${(render.address() as AddressInfo).port}`;

const { app } = await import('./server.ts');

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
  await new Promise<void>((resolve) => render.close(() => resolve()));
});
beforeEach(() => {
  drawn.length = 0;
});

const PATH = (name: string) => `/ContentService/exporter/diagram/${name}`;

function get(path: string) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>(
    (resolve, reject) => {
      const sent = httpRequest(`${base}${path}`, { path }, (response) => {
        let body = '';
        response.setEncoding('latin1');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body })
        );
      });
      sent.on('error', reject);
      sent.end();
    }
  );
}

const javaError = (name: string, code: number, reason: string, message: string) =>
  `{"code":${code},"reason":"${reason}","url":"${base}${PATH(name).split('?')[0]}","messages":[${JSON.stringify(message)}],"targets":null}`;

/** The one render request a figure made: its path and query. */
const asked = () => {
  expect(drawn).toHaveLength(1);
  const [url] = drawn;
  return { path: url?.pathname, query: Object.fromEntries(url?.searchParams ?? []) };
};

describe('/exporter/diagram/{identifier}.{ext}', () => {
  it("draws a diagram with the render service, as Java's type, stored at the edge", async () => {
    const answer = await get(PATH('R-HSA-109606.png'));
    expect([answer.status, answer.body, answer.headers['content-type']]).toEqual([
      200,
      'FIGURE',
      'image/png;charset=UTF-8',
    ]);
    expect(answer.headers['cache-control']).toBe(CACHEABLE);
    expect(answer.headers['content-disposition']).toBeUndefined();
    expect(answer.headers['x-render-cache']).toBeUndefined();
    expect(asked()).toEqual({ path: '/render/R-HSA-109606.png', query: { scale: '1' } });
  });

  it("draws a subpathway's or a reaction's diagram with its events marked, and sel after them", async () => {
    await get(PATH('R-HSA-5205685.svg?sel=R-HSA-9'));
    expect(asked()).toEqual({
      path: '/render/R-HSA-5205647.svg',
      query: { highlight: 'R-HSA-1,R-HSA-2,R-HSA-9' },
    });
    drawn.length = 0;
    await get(PATH('R-HSA-6805479.jpg?quality=7'));
    expect(asked()).toEqual({
      path: '/render/R-HSA-6804756.jpeg',
      query: { highlight: 'R-HSA-6805479', scale: '1.8' },
    });
  });

  it('draws an illustration without the selection, rather than refuse it', async () => {
    const answer = await get(PATH('R-HSA-1640171.svg'));
    expect(answer.status).toBe(200);
    expect(asked()).toEqual({ path: '/render/R-HSA-1640170.svg', query: {} });
  });

  it('draws a GIF, and passes an analysis token on, private', async () => {
    const answer = await get(PATH('R-HSA-109606.gif?token=abc%3D'));
    expect([
      answer.status,
      answer.headers['content-type'],
      answer.headers['cache-control'],
    ]).toEqual([200, 'image/gif;charset=UTF-8', 'private, no-store']);
    expect(asked().query).toEqual({ scale: '1', token: 'abc=' });
  });

  it('answers, and never stores, a URL naming a parameter it does not draw', async () => {
    const answer = await get(PATH('R-HSA-109606.png?title=false&flg=TP53'));
    expect([answer.status, answer.headers['cache-control']]).toEqual([200, 'no-store']);
    expect(asked().query).toEqual({ scale: '1' });
    // sel is drawn, but any text is a figure: never stored either.
    expect((await get(PATH('R-HSA-109606.png?sel=R-HSA-1'))).headers['cache-control']).toBe(
      'no-store'
    );
  });

  it("is Java's 400 for an id that resolves to no diagram, before anything else is checked", async () => {
    expect((await get(PATH('R-HSA-0000.xyz?quality=0'))).body).toBe(
      javaError('R-HSA-0000.xyz', 400, 'BAD_REQUEST', "'R-HSA-0000' is not an event")
    );
  });

  it("is Java's 500 for a pdf, a blank quality, a quality outside 1-10 and an extension it does not draw", async () => {
    for (const [name, message] of [
      ['R-HSA-109606.pdf', 'Unsupported file extension pdf'],
      [
        'R-HSA-109606.png?quality=%20',
        'Something unexpected happened and the error has been reported.',
      ],
      [
        'R-HSA-109606.png?ehld=%20',
        'Something unexpected happened and the error has been reported.',
      ],
      ['R-HSA-109606.png?quality=0', 'quality must be in the range [1-10]'],
      ['R-HSA-109606.xyz', 'Unsupported file extension xyz'],
    ] as const) {
      const answer = await get(PATH(name));
      expect([
        name,
        answer.status,
        (JSON.parse(answer.body) as { messages: string[] }).messages,
      ]).toEqual([name, 500, [message]]);
    }
    expect(drawn).toEqual([]);
  });
});
