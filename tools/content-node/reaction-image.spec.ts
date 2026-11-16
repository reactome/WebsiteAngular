// @vitest-environment node
//
// /exporter/reaction/{identifier}.{ext} (spec 006 T092, research D24): a
// reaction's image, answered by node and drawn by the render service's
// reaction view, never by Java's exporter. Java's errors are kept, in Java's
// order; each of Java's parameters is mapped onto the render service's
// equivalent or accepted and not drawn, as D24 lists. The graph, the layout
// and the render service are stand-ins; every error body below is Java's,
// measured against the deployed service on 7 Nov 2026, with this server's
// address for Java's.
import { createServer, request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHEABLE } from './cache-label.ts';

const REACTION = ['DatabaseObject', 'Event', 'ReactionLikeEvent', 'Reaction'];
/** The objects the stand-in graph holds, by how resolveId asks for them. */
const OBJECTS: Record<string, { labels: string[]; stId: string }> = {
  'R-HSA-6805479': { labels: REACTION, stId: 'R-HSA-6805479' },
  '6805479': { labels: REACTION, stId: 'R-HSA-6805479' },
  'R-HSA-109581': { labels: ['DatabaseObject', 'Event', 'Pathway'], stId: 'R-HSA-109581' },
};
vi.mock('./graph.ts', () => ({
  read: async (_cypher: string, params: { id?: string } = {}) => {
    const found = params.id === undefined ? undefined : OBJECTS[params.id];
    return found ? [found] : [];
  },
  configured: () => true,
  close: async () => {},
  envSetting: () => '',
}));

/** What the stand-in layout does next: answer, or throw. */
let layout: (stId: string) => unknown;
const laidOut: string[] = [];
vi.mock('./reaction-layout/answer.ts', () => ({
  reactionAnswer: async (stId: string) => {
    laidOut.push(stId);
    return layout(stId);
  },
}));

/** The stand-in render service: what it was asked, and what it answers. */
const drawn: URL[] = [];
let renderAnswer: { status: number; body: string; headers?: Record<string, string> };
const render = createServer((request, response) => {
  drawn.push(new URL(String(request.url), 'http://render'));
  response.writeHead(renderAnswer.status, {
    'Content-Type': renderAnswer.status === 200 ? 'image/png' : 'application/json',
    // What the render service sends with a figure, none of which is Java's.
    'Content-Disposition': 'inline; filename="R-HSA-6805479.png"',
    'X-Render-Cache': 'miss',
    ...renderAnswer.headers,
  });
  response.end(renderAnswer.body);
});
await new Promise<void>((resolve) => render.listen(0, '127.0.0.1', () => resolve()));
process.env['RENDER_SERVICE_URL'] = `http://127.0.0.1:${(render.address() as AddressInfo).port}`;

const { app } = await import('./server.ts');
const { JavaNullPointerException, JavaRuntimeException } =
  await import('./reaction-layout/model.ts');

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
  laidOut.length = 0;
  drawn.length = 0;
  layout = () => ({ answer: { status: 200, type: 'application/json', serialised: '{}' } });
  renderAnswer = { status: 200, body: 'PNG BYTES' };
});

/** A GET of the path exactly as written: fetch would resolve dot segments. */
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

const PATH = (name: string) => `/ContentService/exporter/reaction/${name}`;

/** Java's error envelope for this path, as its GlobalExceptionHandler writes it. */
const javaError = (name: string, code: number, reason: string, message: string | null) =>
  `{"code":${code},"reason":"${reason}","url":"${base}${PATH(name).split('?')[0]}","messages":[${
    message === null ? 'null' : JSON.stringify(message)
  }],"targets":null}`;

/** The one render request a figure made: its path and query. */
const asked = () => {
  expect(drawn).toHaveLength(1);
  const [url] = drawn;
  return { path: url?.pathname, query: Object.fromEntries(url?.searchParams ?? []) };
};

describe('/exporter/reaction/{identifier}.{ext}', () => {
  it("draws the reaction's own layout with the render service, as Java's type, stored at the edge", async () => {
    const answer = await get(PATH('R-HSA-6805479.png'));
    expect([answer.status, answer.body, answer.headers['content-type']]).toEqual([
      200,
      'PNG BYTES',
      'image/png;charset=UTF-8',
    ]);
    expect(answer.headers['cache-control']).toBe(CACHEABLE);
    // Java sends no Content-Disposition with a figure, and nothing of the
    // render service's reaches the caller.
    expect(answer.headers['content-disposition']).toBeUndefined();
    expect(answer.headers['x-render-cache']).toBeUndefined();
    expect(asked()).toEqual({
      path: '/render/R-HSA-6805479.png',
      query: { layout: 'reaction', scale: '1' },
    });
    expect(laidOut).toEqual(['R-HSA-6805479']);
  });

  it("names each format's type as Java does, jpg as jpg, whatever the case", async () => {
    for (const [name, type, format] of [
      ['R-HSA-6805479.jpg', 'image/jpg;charset=UTF-8', 'jpeg'],
      ['R-HSA-6805479.jpeg', 'image/jpeg;charset=UTF-8', 'jpeg'],
      ['R-HSA-6805479.svg', 'image/svg+xml;charset=UTF-8', 'svg'],
      ['R-HSA-6805479.gif', 'image/gif;charset=UTF-8', 'gif'],
      ['R-HSA-6805479.PNG', 'image/png;charset=UTF-8', 'png'],
      ['R-HSA-6805479.3.SVG', 'image/svg+xml;charset=UTF-8', 'svg'],
      ['6805479.png', 'image/png;charset=UTF-8', 'png'],
    ]) {
      drawn.length = 0;
      const answer = await get(PATH(name as string));
      expect([name, answer.status, answer.headers['content-type']]).toEqual([name, 200, type]);
      // By the stable id it found, whatever the id asked by.
      expect([name, asked().path]).toEqual([name, `/render/R-HSA-6805479.${format}`]);
    }
  });

  it("asks for Java's quality as the render service's scale: Java's factor of the layout's size, within the render service's bounds", async () => {
    // RasterArgs.scale: 1 to 5 is 0.1 to 1, 5 to 10 is 1 to 3. The render
    // service draws 0.25 to 2.
    for (const [quality, scale] of [
      ['1', '0.25'],
      ['2', '0.325'],
      ['4', '0.775'],
      ['5', '1'],
      ['6', '1.4'],
      ['7', '1.8'],
      ['8', '2'],
      ['10', '2'],
      // Blank: setQuality(null) keeps the default.
      ['%20', '1'],
      ['', '1'],
    ]) {
      drawn.length = 0;
      const answer = await get(PATH(`R-HSA-6805479.png?quality=${quality}`));
      expect([quality, answer.status, asked().query['scale']]).toEqual([quality, 200, scale]);
    }
    // An SVG has no pixels to scale: one figure whatever the quality.
    drawn.length = 0;
    await get(PATH('R-HSA-6805479.svg?quality=9'));
    expect(asked().query).toEqual({ layout: 'reaction' });
  });

  it('accepts the parameters the render service does not draw, and asks for the same figure without them', async () => {
    // Research D24: no flag, selection, title, margin, profile or analysis is
    // drawn on the reaction view; Java's tolerant values are taken as Java
    // takes them, and the figure is the one asked without them -- not stored
    // at the edge under their URL.
    const answer = await get(
      PATH(
        'R-HSA-6805479.png?flg=TP53&flgInteractors=false&sel=R-HSA-1,R-HSA-2&title=false&margin=3' +
          '&diagramProfile=Standard&token=MjAyNjExMDcxMjAwMDBfMQ%3D%3D&analysisProfile=Copper%20Plus' +
          '&resource=UNIPROT&expColumn=2'
      )
    );
    expect([answer.status, answer.body]).toEqual([200, 'PNG BYTES']);
    expect(asked().query).toEqual({ layout: 'reaction', scale: '1' });
    // The token makes it one person's: private, as any answer with one.
    expect(answer.headers['cache-control']).toBe('private, no-store');
    drawn.length = 0;
    expect((await get(PATH('R-HSA-6805479.png?title=false'))).headers['cache-control']).toBe(
      'no-store'
    );
    expect((await get(PATH('R-HSA-6805479.png?quality=7'))).headers['cache-control']).toBe(
      CACHEABLE
    );
  });

  it("is Spring's 404 for a name without an extension", async () => {
    const answer = await get(PATH('R-HSA-6805479'));
    expect(answer.status).toBe(404);
    expect(JSON.parse(answer.body)).toMatchObject({
      status: 404,
      error: 'Not Found',
      path: PATH('R-HSA-6805479'),
    });
    expect(laidOut).toEqual([]);
  });

  it("converts the parameters first, in reactionImage's order, as Spring does", async () => {
    const answer = await get(PATH('R-HSA-0.png?quality=abc&title=maybe'));
    expect([answer.status, answer.body]).toEqual([
      400,
      javaError(
        'R-HSA-0.png',
        400,
        'BAD_REQUEST',
        "Failed to convert value of type 'java.lang.String' to required type 'java.lang.Integer'; nested exception is java.lang.NumberFormatException: For input string: \"abc\""
      ),
    ]);
    // title before margin, margin before expColumn.
    expect(JSON.parse((await get(PATH('R-HSA-0.png?margin=x&title=maybe'))).body)).toMatchObject({
      messages: [
        "Failed to convert value of type 'java.lang.String' to required type 'java.lang.Boolean'; nested exception is java.lang.IllegalArgumentException: Invalid boolean value [maybe]",
      ],
    });
    expect(drawn).toEqual([]);
  });

  it("is Java's 404 for an id that finds nothing, and its 400 for one that is no reaction", async () => {
    expect((await get(PATH('R-HSA-0000.png'))).body).toBe(
      javaError('R-HSA-0000.png', 404, 'NOT_FOUND', "Identifier 'R-HSA-0000' not found")
    );
    const answer = await get(PATH('R-HSA-109581.png'));
    expect([answer.status, answer.body, answer.headers['cache-control']]).toEqual([
      400,
      javaError(
        'R-HSA-109581.png',
        400,
        'BAD_REQUEST',
        "The identifier 'R-HSA-109581' does not correspond to a 'ReactionLikeEvent'"
      ),
      'no-store',
    ]);
    // Before the extension is looked at, as Java looks the id up first.
    expect((await get(PATH('R-HSA-109581.xyz'))).status).toBe(400);
    expect(laidOut).toEqual([]);
    expect(drawn).toEqual([]);
  });

  it("is Java's 500 for an id of dots and a dbId past a long", async () => {
    expect((await get(PATH('...png'))).body).toBe(
      javaError('...png', 500, 'INTERNAL_SERVER_ERROR', 'Index 0 out of bounds for length 0')
    );
    expect((await get(PATH('99999999999999999999.png'))).body).toBe(
      javaError(
        '99999999999999999999.png',
        500,
        'INTERNAL_SERVER_ERROR',
        'For input string: "99999999999999999999"'
      )
    );
  });

  it("refuses a PDF with Java's own message, before laying the reaction out, marked as Spring marks it", async () => {
    for (const name of ['R-HSA-6805479.pdf', 'R-HSA-6805479.PDF']) {
      const answer = await get(PATH(name));
      expect([name, answer.status, answer.body]).toEqual([
        name,
        500,
        javaError(name, 500, 'INTERNAL_SERVER_ERROR', 'Unsupported file extension pdf'),
      ]);
      expect(answer.headers['content-disposition']).toBe('inline;filename=f.txt');
    }
    expect(laidOut).toEqual([]);
  });

  it("answers the layout's Java exceptions as Java's handler does, before the quality and the extension", async () => {
    for (const [failure, message] of [
      [
        new JavaNullPointerException(),
        'Something unexpected happened and the error has been reported.',
      ],
      [
        new JavaRuntimeException('No Schema class defined for [1:x]'),
        'No Schema class defined for [1:x]',
      ],
      [new JavaRuntimeException(null), null],
    ] as const) {
      layout = () => {
        throw failure;
      };
      expect((await get(PATH('R-HSA-6805479.xyz?quality=11'))).body).toBe(
        javaError('R-HSA-6805479.xyz', 500, 'INTERNAL_SERVER_ERROR', message)
      );
    }
    expect(drawn).toEqual([]);
  });

  it("is Java's 500 for a quality outside 1-10, after the layout and before the extension", async () => {
    for (const name of ['R-HSA-6805479.png?quality=0', 'R-HSA-6805479.xyz?quality=11']) {
      expect([name, (await get(PATH(name))).body]).toEqual([
        name,
        javaError(name, 500, 'INTERNAL_SERVER_ERROR', 'quality must be in the range [1-10]'),
      ]);
    }
    expect(laidOut).toHaveLength(2);
    expect(drawn).toEqual([]);
  });

  it("is Java's 500 for an extension it does not draw, named in lower case", async () => {
    for (const [name, ext] of [
      ['R-HSA-6805479.xyz', 'xyz'],
      ['R-HSA-6805479.BMP', 'bmp'],
      ['R-HSA-6805479.', ''],
    ]) {
      const answer = await get(PATH(name as string));
      expect([name, answer.status, answer.body]).toEqual([
        name,
        500,
        javaError(
          name as string,
          500,
          'INTERNAL_SERVER_ERROR',
          `Unsupported file extension ${ext}`
        ),
      ]);
    }
    // Spring marks an answer to an extension it does not trust (server.ts).
    expect((await get(PATH('R-HSA-6805479.xyz'))).headers['content-disposition']).toBe(
      'inline;filename=f.txt'
    );
    expect((await get(PATH('R-HSA-6805479.'))).headers['content-disposition']).toBeUndefined();
    expect(drawn).toEqual([]);
  });

  it("passes on the render service's full queue as a 503 with Retry-After, and its failure as a 500", async () => {
    renderAnswer = {
      status: 503,
      body: '{"error":"renderer saturated"}',
      headers: { 'Retry-After': '5' },
    };
    const busy = await get(PATH('R-HSA-6805479.png'));
    expect([busy.status, busy.headers['retry-after'], busy.headers['cache-control']]).toEqual([
      503,
      '5',
      'no-store',
    ]);
    renderAnswer = { status: 500, body: '{"error":"nothing drawn for R-HSA-6805479 within 60s"}' };
    expect((await get(PATH('R-HSA-6805479.png'))).body).toBe(
      javaError(
        'R-HSA-6805479.png',
        500,
        'INTERNAL_SERVER_ERROR',
        'nothing drawn for R-HSA-6805479 within 60s'
      )
    );
  });

  it('sends the slashed URL to the unslashed one, as for every endpoint', async () => {
    const answer = await get(`${PATH('R-HSA-6805479.png')}/`);
    expect([answer.status, answer.headers['location']]).toEqual([301, PATH('R-HSA-6805479.png')]);
  });

  it("leaves the reaction's layout to its own endpoint", async () => {
    expect((await get(PATH('R-HSA-6805479/diagram'))).headers['content-type']).toMatch(
      /^application\/json/
    );
    expect(drawn).toEqual([]);
  });
});
