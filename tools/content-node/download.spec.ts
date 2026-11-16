// @vitest-environment node
//
// POST /download/{filename} -- DownloadController, interactors written out
// as a CSV -- through the service, as Java answers it: the mapping's checks
// (consumes, the Content-Type header condition, produces) before `content`
// is bound, File.createTempFile's failures, "#NL#" as line breaks, and the
// Resource's headers. Measured against Java on 12 Nov 2026.
import { request as send } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './server.ts';
import { tempFileProblem } from './interactors-endpoints.ts';

let port: number;
let server: Server;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app().listen(0, '127.0.0.1', () => resolve());
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

interface Sent {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A request as sent, path and headers untouched, and the answer's bytes as Latin-1. */
function post(
  path: string,
  body: string | undefined,
  headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' },
  method = 'POST'
): Promise<Sent> {
  return new Promise((resolve, reject) => {
    const sent = send(
      { host: '127.0.0.1', port, path: `/ContentService${path}`, method, headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('latin1'),
          })
        );
      }
    );
    sent.on('error', reject);
    if (body !== undefined) sent.write(body);
    sent.end();
  });
}

const message = (sent: Sent) => (JSON.parse(sent.body) as { messages: string[] }).messages[0];

describe('POST /download/{filename}', () => {
  it('writes `content` a line at a time, "#NL#" a line break, as a text/csv Resource', async () => {
    const sent = await post('/download/result.csv', 'content=P04637,TP53%23NL%23Q00987,MDM2');
    expect([
      sent.status,
      sent.headers['content-type'],
      sent.headers['accept-ranges'],
      sent.headers['content-disposition'],
      sent.body,
    ]).toEqual([200, 'text/csv;charset=UTF-8', 'bytes', undefined, 'P04637,TP53\nQ00987,MDM2\n']);
  });

  it('splits as String.split does, and joins several values with commas', async () => {
    const cases: [string, string][] = [
      ['content=', '\n'],
      ['content', '\n'],
      ['content=%23NL%23', ''],
      ['content=x%23NL%23%23NL%23', 'x\n'],
      ['content=%23NL%23x', '\nx\n'],
      ['content=a&content=b', 'a,b\n'],
      ['content=a+b%0Dc', 'a b\rc\n'],
      ['content=%C3%A9%E9', 'Ã©ï¿½\n'],
    ];
    for (const [body, written] of cases)
      expect([body, (await post('/download/result.csv', body)).body]).toEqual([body, written]);
    // The query's values first; a text/plain body is not a form.
    expect((await post('/download/result.csv?content=q', 'content=a')).body).toBe('q,a\n');
    expect(
      (await post('/download/result.csv?content=q', 'content=a', { 'Content-Type': 'text/plain' }))
        .body
    ).toBe('q\n');
  });

  it("is Spring's 400 without `content`", async () => {
    for (const [body, type] of [
      ['other=a', 'application/x-www-form-urlencoded'],
      ['', 'application/x-www-form-urlencoded'],
      ['content=%', 'application/x-www-form-urlencoded'],
      ['content=a', 'text/plain'],
      ['content=a', 'APPLICATION/X-WWW-FORM-URLENCODED'],
    ] as const) {
      const sent = await post('/download/result.csv', body, { 'Content-Type': type });
      expect([body, type, sent.status, message(sent)]).toEqual([
        body,
        type,
        400,
        "Required request parameter 'content' for method parameter type String is not present",
      ]);
    }
  });

  it("is Spring's 415 for a body that is neither a form nor text, before anything else", async () => {
    const cases: [string | undefined, string][] = [
      [undefined, "Content type '' not supported"],
      ['application/json', "Content type 'application/json' not supported"],
      ['text/*', "Content type 'text/*' not supported"],
      [
        'multipart/form-data; boundary=x',
        "Content type 'multipart/form-data;boundary=x' not supported",
      ],
      ['garbage', 'Invalid mime type "garbage": does not contain \'/\''],
    ];
    for (const [type, why] of cases) {
      const sent = await post(
        '/download/ab',
        'content=a',
        type === undefined ? {} : { 'Content-Type': type, Accept: 'application/json' }
      );
      expect([type, sent.status, message(sent)]).toEqual([type, 415, why]);
    }
  });

  it("is Spring's 406 for an Accept without text/csv, before `content` is bound", async () => {
    const sent = await post('/download/ab', '', {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/plain',
    });
    expect([sent.status, message(sent)]).toEqual([406, 'Could not find acceptable representation']);
    // Accept's parameters go into the type written.
    const chosen = await post('/download/result.csv', 'content=a', {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/csv;charset=latin1;x=y',
    });
    expect(chosen.headers['content-type']).toBe('text/csv;x=y;charset=latin1');
  });

  it("is GlobalExceptionHandler's 500 for a name File.createTempFile refuses", async () => {
    const cases: [string, string][] = [
      ['ab', 'Prefix string "ab" too short: length must be at least 3'],
      ['%C3%A9%C3%A9', 'Prefix string "éé" too short: length must be at least 3'],
      ['%F0%9F%98%80', 'Prefix string "😀" too short: length must be at least 3'],
      ['%C3%A9'.repeat(200), 'File name too long'],
    ];
    for (const [name, why] of cases) {
      const sent = await post(`/download/${name}`, 'content=a');
      expect([
        name.slice(0, 20),
        sent.status,
        (JSON.parse(Buffer.from(sent.body, 'latin1').toString('utf8')) as { messages: string[] })
          .messages[0],
      ]).toEqual([name.slice(0, 20), 500, why]);
    }
    // A long ASCII name is cut to fit; a slash after it is Spring's.
    for (const name of ['a'.repeat(300), 'abc', '%F0%9F%98%80a', 'result.csv/'])
      expect([name.slice(0, 20), (await post(`/download/${name}`, 'content=a')).status]).toEqual([
        name.slice(0, 20),
        200,
      ]);
  });

  it("is Java's 500 for a quality it cannot copy, but only once `content` is bound", async () => {
    const accept = (body: string, path = '/download/result.csv') =>
      post(path, body, {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/csv;Q=7',
      });
    expect([
      (await accept('x=1')).status,
      (await accept('content=a', '/download/ab')).status,
    ]).toEqual([400, 500]);
    expect(message(await accept('content=a', '/download/ab'))).toMatch(/^Prefix string/);
    const failed = await accept('content=a');
    expect([failed.status, message(failed)]).toEqual([
      500,
      'Invalid quality value "7": should be between 0.0 and 1.0',
    ]);
    // One that fails while Spring sorts the Accept fails before `content` is bound.
    const sorting = await post('/download/result.csv', 'x=1', {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/csv;Q=abc, application/json',
    });
    expect([sorting.status, message(sorting)]).toEqual([500, 'For input string: "abc"']);
  });

  it('honours a Range, as Spring does for any Resource', async () => {
    const sent = await post('/download/result.csv', 'content=abcdef%23NL%23ghij', {
      'Content-Type': 'application/x-www-form-urlencoded',
      Range: 'bytes=-3',
    });
    expect([sent.status, sent.headers['content-range'], sent.body]).toEqual([
      206,
      'bytes 9-11/12',
      'ij\n',
    ]);
  });

  it("is Java's 405 for any other method, and Spring's 404 below the name", async () => {
    const get = await post('/download/result.csv?content=a', undefined, {}, 'GET');
    expect([get.status, message(get)]).toEqual([405, "Request method 'GET' not supported"]);
    expect((await post('/download/result.csv/x', 'content=a')).status).toBe(404);
  });
});

describe('tempFileProblem, File.createTempFile as JDK 11 runs it', () => {
  it('refuses a prefix under three UTF-16 units', () => {
    expect(tempFileProblem('ab', '')).toBe(
      'Prefix string "ab" too short: length must be at least 3'
    );
    expect(tempFileProblem('😀', '')).toBe(
      'Prefix string "😀" too short: length must be at least 3'
    );
    expect(tempFileProblem('😀a', '')).toBe(undefined);
  });

  it('cuts a name to 255 units, prefix first, and refuses one past 255 bytes', () => {
    // 117 two-byte characters and 19 digits: 253 bytes; 118, 255; 119, 257.
    expect(tempFileProblem('é'.repeat(117), '')).toBe(undefined);
    expect(tempFileProblem('é'.repeat(118), '')).toBe(undefined);
    expect(tempFileProblem('é'.repeat(118), '', 20)).toBe('File name too long');
    expect(tempFileProblem('é'.repeat(119), '')).toBe('File name too long');
    // In units, so ASCII is cut to fit, and so is a long suffix.
    expect(tempFileProblem('a'.repeat(1000), '')).toBe(undefined);
    expect(tempFileProblem('abc', 'x'.repeat(1000))).toBe(undefined);
    expect(tempFileProblem('abc', 'é'.repeat(200))).toBe('File name too long');
    // A suffix is cut twice by the first excess: 240 units less 7, then 7 more.
    expect(tempFileProblem('abc', `${'x'.repeat(226)}${'é'.repeat(14)}`)).toBe(undefined);
    // The cut prefix: 236 units of three-byte characters, cut to 236 - 19...
    expect(tempFileProblem(`abc${'€'.repeat(300)}`, '')).toBe('File name too long');
    // ...and a pair cut in two leaves a lone surrogate, three bytes to the JDK:
    // 235 + 3 + 19 is past the limit, where 20 digits would cut nothing.
    expect(tempFileProblem(`${'a'.repeat(235)}😀`, '')).toBe('File name too long');
    expect(tempFileProblem(`${'a'.repeat(235)}😀`, '', 20)).toBe(undefined);
  });
});
