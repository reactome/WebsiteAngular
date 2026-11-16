// @vitest-environment node
//
// /exporter/diagram/{identifier}.pptx and /exporter/reaction/{identifier}.pptx
// (spec 006 T109, research D24): PptxExporterController's answers, the
// PowerPoint drawn by the render service. The graph, the layout and the
// render service are stand-ins; the headers and error bodies are Java's,
// measured on 8 Nov 2026, with this server's address for Java's.
import { createServer, request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHEABLE } from './cache-label.ts';

const REACTION = ['DatabaseObject', 'Event', 'ReactionLikeEvent', 'Reaction'];
/** The objects findById finds, by how resolveId asks for them. */
const OBJECTS: Record<string, { labels: string[]; stId: string }> = {
  'R-HSA-6805479': { labels: REACTION, stId: 'R-HSA-6805479' },
  'R-HSA-109606': { labels: ['DatabaseObject', 'Event', 'Pathway'], stId: 'R-HSA-109606' },
};
/** What graph-core's DiagramService resolves each id to. */
const RESULTS: Record<string, { diagramStId: string; events: string[] }> = {
  'R-HSA-109606': { diagramStId: 'R-HSA-109606', events: [] },
  'R-HSA-5205685': { diagramStId: 'R-HSA-5205647', events: ['R-HSA-1'] },
  'R-HSA-6805479': { diagramStId: 'R-HSA-6804756', events: ['R-HSA-6805479'] },
};
const NAMES: Record<string, string> = {
  'R-HSA-109606': 'Intrinsic Pathway for Apoptosis',
  'R-HSA-5205647': 'Mitophagy',
  'R-HSA-6805479': 'TP53RK phosphorylates TP53',
};
vi.mock('./graph.ts', () => ({
  read: async (cypher: string, params: { id?: string; stId?: string } = {}) => {
    const stId = params.stId ?? '';
    if (cypher.includes('displayName')) return NAMES[stId] ? [{ name: NAMES[stId] }] : [];
    if (cypher.includes('hasEHLD')) return [{ ehld: false }];
    if (cypher.includes('hasDiagram')) {
      const found = RESULTS[stId];
      return found ? [{ ...found, width: 1, height: 1, level: 1 }] : [];
    }
    const found = params.id === undefined ? undefined : OBJECTS[params.id];
    return found ? [found] : [];
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));
const laidOut: string[] = [];
vi.mock('./reaction-layout/answer.ts', () => ({
  reactionAnswer: async (stId: string) => {
    laidOut.push(stId);
    return { answer: { status: 200, type: 'application/json', serialised: '{}' } };
  },
}));

const drawn: URL[] = [];
const render = createServer((request, response) => {
  drawn.push(new URL(String(request.url), 'http://render'));
  response.writeHead(200, { 'Content-Disposition': 'attachment; filename="x.pptx"' });
  response.end('PPTX');
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
  laidOut.length = 0;
});

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

const PPTX =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation;charset=UTF-8';
const javaError = (path: string, code: number, reason: string, message: string) =>
  `{"code":${code},"reason":"${reason}","url":"${base}${path.split('?')[0]}","messages":[${JSON.stringify(message)}],"targets":null}`;
const UNEXPECTED = 'Something unexpected happened and the error has been reported.';

/** The one render request a PowerPoint made: its path and query. */
const asked = () => {
  expect(drawn).toHaveLength(1);
  const [url] = drawn;
  return { path: url?.pathname, query: Object.fromEntries(url?.searchParams ?? []) };
};

describe('/exporter/diagram/{identifier}.pptx', () => {
  it("is the render service's PowerPoint of the diagram, under Java's type and download name", async () => {
    const answer = await get('/ContentService/exporter/diagram/R-HSA-109606.pptx');
    expect([
      answer.status,
      answer.body,
      answer.headers['content-type'],
      answer.headers['content-disposition'],
      answer.headers['cache-control'],
    ]).toEqual([
      200,
      'PPTX',
      PPTX,
      'attachment; filename="[R-HSA-109606] Intrinsic Pathway for Apoptosis.pptx"',
      CACHEABLE,
    ]);
    expect(asked()).toEqual({ path: '/render/R-HSA-109606.pptx', query: {} });
  });

  it("names a subpathway's file by the diagram that holds it, its events and sel marked", async () => {
    const answer = await get('/ContentService/exporter/diagram/R-HSA-5205685.pptx?sel=R-HSA-9');
    expect(answer.headers['content-disposition']).toBe(
      'attachment; filename="[R-HSA-5205647] Mitophagy.pptx"'
    );
    expect(asked()).toEqual({
      path: '/render/R-HSA-5205647.pptx',
      query: { highlight: 'R-HSA-1,R-HSA-9' },
    });
  });

  it("is Java's generic 500 for an id that resolves to no diagram, with no download guard", async () => {
    const path = '/ContentService/exporter/diagram/R-HSA-0000.pptx';
    const answer = await get(path);
    expect([answer.status, answer.body, answer.headers['content-disposition']]).toEqual([
      500,
      javaError(path, 500, 'INTERNAL_SERVER_ERROR', UNEXPECTED),
      undefined,
    ]);
    expect(drawn).toEqual([]);
  });

  it('accepts the profile and the flags, and never stores a URL naming them', async () => {
    const answer = await get(
      '/ContentService/exporter/diagram/R-HSA-109606.pptx?diagramProfile=Standard&flg=TP53'
    );
    expect([answer.status, answer.headers['cache-control']]).toEqual([200, 'no-store']);
    expect(asked().query).toEqual({});
  });

  it('leaves .PPTX, in another case, to the image exporter, as Spring does', async () => {
    const path = '/ContentService/exporter/diagram/R-HSA-109606.PPTX';
    expect((await get(path)).body).toBe(
      javaError(path, 500, 'INTERNAL_SERVER_ERROR', 'Unsupported file extension pptx')
    );
  });
});

describe('/exporter/reaction/{identifier}.pptx', () => {
  it("is the render service's PowerPoint of the reaction's own layout, Java's name", async () => {
    const answer = await get('/ContentService/exporter/reaction/R-HSA-6805479.pptx');
    expect([
      answer.status,
      answer.headers['content-type'],
      answer.headers['content-disposition'],
    ]).toEqual([
      200,
      PPTX,
      'attachment; filename="[R-HSA-6805479] TP53RK phosphorylates TP53.pptx"',
    ]);
    expect(asked()).toEqual({ path: '/render/R-HSA-6805479.pptx', query: { layout: 'reaction' } });
    expect(laidOut).toEqual(['R-HSA-6805479']);
  });

  it("is Java's 404 and 400 for an id that finds nothing or no reaction", async () => {
    const missing = '/ContentService/exporter/reaction/R-HSA-0000.pptx';
    expect((await get(missing)).body).toBe(
      javaError(missing, 404, 'NOT_FOUND', "Identifier 'R-HSA-0000' not found")
    );
    const pathway = '/ContentService/exporter/reaction/R-HSA-109606.pptx';
    expect((await get(pathway)).body).toBe(
      javaError(
        pathway,
        400,
        'BAD_REQUEST',
        "The identifier 'R-HSA-109606' does not correspond to a 'ReactionLikeEvent'"
      )
    );
    expect(drawn).toEqual([]);
  });

  it("is Java's generic 500 for a flag on an id that resolves to no diagram, before the id's own answer", async () => {
    const path = '/ContentService/exporter/reaction/R-HSA-0000.pptx?flg=TP53';
    expect((await get(path)).body).toBe(javaError(path, 500, 'INTERNAL_SERVER_ERROR', UNEXPECTED));
  });
});
