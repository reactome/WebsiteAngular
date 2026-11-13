// @vitest-environment node
//
// Media types as Spring 5.3 and Tomcat 9 read and write them, for the
// content service's consumes, produces and Resource answers: MimeTypeUtils'
// parser and MediaType's quality check (body.ts), Accept negotiated as
// ProducesRequestCondition and AbstractMessageConverterMethodProcessor do it,
// the Content-Type Tomcat then writes, Range over a Resource, and the
// servlet's parameters from a query and a form body (spring.ts). Every
// expected value was measured against Java's /download/{filename},
// /citation/download, /interactors/static/molecules/summary and
// /data/query/ids on 12 Nov 2026.
import { describe, expect, it } from 'vitest';
import { consumesProblem, encodeText, mediaType, plainText, unreadableCharset } from './body.ts';
import type { MediaType } from './body.ts';
import { javaParseDouble } from './java-text.ts';
import {
  negotiate,
  resourceAnswer,
  servletRequestParameters,
  stringContentType,
  tomcatContentType,
} from './spring.ts';
import type { Request } from './endpoint.ts';
import type { Negotiation } from './spring.ts';

const FORM: [string, string][] = [
  ['application', 'x-www-form-urlencoded'],
  ['text', 'plain'],
];

describe('mediaType and consumesProblem, a Content-Type as Spring reads it', () => {
  it("refuses what MimeTypeUtils refuses, with Spring's messages", () => {
    const cases: [string, string][] = [
      ['garbage', "does not contain '/'"],
      ['text/', "does not contain subtype after '/'"],
      ['/plain', "'type' must not be empty"],
      ['*/plain', "wildcard type is legal only in '*/*' (all mime types)"],
      ['text/pl@in', 'Invalid token character \'@\' in token "pl@in"'],
      ['te xt/plain', 'Invalid token character \' \' in token "te xt"'],
      ['text/pl=ain', 'Invalid token character \'=\' in token "pl=ain"'],
      ['text/plain;a=b@c', 'Invalid token character \'@\' in token "b@c"'],
      ['text/plain;q=', "'value' must not be empty"],
      ['text/plain;=x', "'parameter' must not be empty"],
      ['text/plain;charset=b@d', 'b@d'],
      ['text/plain;charset=', "'value' must not be empty"],
      ['text/plain;charset=bogus', "unsupported charset 'bogus'"],
    ];
    for (const [type, why] of cases)
      expect(consumesProblem(type, FORM), type).toBe(`Invalid mime type "${type}": ${why}`);
  });

  it('refuses a quality MediaType refuses, as an invalid media type', () => {
    const cases: [string, string][] = [
      ['text/plain;q=2', 'Invalid quality value "2": should be between 0.0 and 1.0'],
      ['text/plain;q=NaN', 'Invalid quality value "NaN": should be between 0.0 and 1.0'],
      ['text/plain;q=Infinity', 'Invalid quality value "Infinity": should be between 0.0 and 1.0'],
      ['text/plain;q=abc', 'For input string: "abc"'],
      ['application/x-www-form-urlencoded;q=abc', 'For input string: "abc"'],
    ];
    for (const [type, why] of cases)
      expect(consumesProblem(type, FORM), type).toBe(`Invalid media type "${type}": ${why}`);
  });

  it('takes what Spring takes: quoted values, Java doubles, `Q` and `Charset` unread', () => {
    for (const type of [
      'text/plain;a="b@c"',
      'text/plain; a = "x;y"',
      'text/plain;q="0.5"',
      'text/plain;q=0.5d',
      'text/plain;q=1e0',
      'text/plain;q=0x0p0',
      'text/plain;q=-0',
      'text/plain;q=.5',
      'text/plain;Q=5',
      'text/plain;Charset=bogus',
      'text/plain;charset="utf-8"',
      'TEXT/Plain;X=Y',
      'application/x-www-form-urlencoded ; q=1',
      'APPLICATION/X-WWW-FORM-URLENCODED',
    ])
      expect(consumesProblem(type, FORM), type).toBe(undefined);
  });

  it('names a type it does not take as MediaType.toString writes it', () => {
    const cases: [string | undefined, string][] = [
      [undefined, ''],
      ['', ''],
      ['application/json', 'application/json'],
      ['text/*', 'text/*'],
      ['*/*', '*/*'],
      ['*', '*/*'],
      ['multipart/form-data; boundary=x', 'multipart/form-data;boundary=x'],
      // A name given again in another case moves to the end, under its last spelling.
      ['application/json; A = 1 ;a=2', 'application/json;a=2'],
      ['application/json;a=1;b=2;a=3', 'application/json;a=3;b=2'],
      ['application/json;a="x;y";b', 'application/json;a="x;y"'],
      ['Application/JSON;Charset=UTF-8', 'application/json;Charset=UTF-8'],
    ];
    for (const [type, written] of cases)
      expect(consumesProblem(type, FORM), type).toBe(`Content type '${written}' not supported`);
  });

  it('reads a type with its parameters, in their order', () => {
    expect(mediaType('Text/CSV; b=1;a="x"')).toEqual({
      type: 'text',
      subtype: 'csv',
      parameters: [
        ['b', '1'],
        ['a', '"x"'],
      ],
    });
  });
});

describe('plainText, a text/plain body in the charset Spring finds', () => {
  const body = Buffer.from('52c3a9', 'hex');
  it('reads `charset` by that exact name, unquoted either way', () => {
    expect(plainText(body, "text/plain;charset='latin1'")).toBe('RÃ©');
    expect(plainText(body, 'text/plain;charset="latin1"')).toBe('RÃ©');
    // Java's getCharset finds none under `Charset`: UTF-8.
    expect(plainText(body, 'text/plain;Charset=ISO-8859-1')).toBe('Ré');
  });
});

describe('javaParseDouble', () => {
  it('reads what Double.parseDouble reads, and nothing else', () => {
    const cases: [string, number | undefined][] = [
      ['0.5', 0.5],
      [' 1 ', 1],
      ['1.', 1],
      ['.5', 0.5],
      ['+1', 1],
      ['-0', -0],
      ['1e0', 1],
      ['0.5d', 0.5],
      ['1F', 1],
      ['0x1p-1', 0.5],
      ['0X.8P0', 0.5],
      ['NaN', NaN],
      ['-Infinity', -Infinity],
      ['abc', undefined],
      ['', undefined],
      ['0x1', undefined],
      ['0x.p1', undefined],
      ['1e', undefined],
      ['NaNd', undefined],
      ['١', undefined],
    ];
    for (const [text, value] of cases) expect([text, javaParseDouble(text)]).toEqual([text, value]);
  });
});

const CSV: [string, string] = ['text', 'csv'];
const PLAIN: [string, string] = ['text', 'plain'];
/** The Content-Type Tomcat sends for what negotiate chose, or what it did instead. */
const text = (negotiation: Negotiation) => {
  if (negotiation.kind !== 'chosen')
    return negotiation.kind === 'not-acceptable'
      ? 406
      : `${negotiation.kind}: ${negotiation.message}`;
  const media = negotiation.media;
  return tomcatContentType(
    `${media.type}/${media.subtype}${media.parameters.map(([n, v]) => `;${n}=${v}`).join('')}`
  );
};

describe('negotiate, the type Spring writes under, from Accept', () => {
  it("refuses an Accept that takes nothing it produces, or that it cannot read: Java's 406", () => {
    for (const accept of [
      'application/json',
      'text/plain',
      'application/*',
      'garbage',
      '*/csv',
      'text/c@sv',
      'text/csv;q=2',
      'text/csv;q=abc',
      'text/csv;charset=bogus',
      '"text/csv"',
      'text/csv;x=, text/csv',
      'text/csv+x',
      'text/*+x',
      'text/x+csv',
    ])
      expect([accept, text(negotiate(accept, CSV))]).toEqual([accept, 406]);
  });

  it('takes any compatible type, whatever its quality; none at all is every type', () => {
    const cases: [string | undefined, string][] = [
      [undefined, 'text/csv;charset=UTF-8'],
      ['', 'text/csv;charset=UTF-8'],
      [',,', 'text/csv;charset=UTF-8'],
      ['*', 'text/csv;charset=UTF-8'],
      ['*/*;a=b', 'text/csv;charset=UTF-8'],
      ['text/*;foo=bar', 'text/csv;charset=UTF-8'],
      ['text/*+csv', 'text/csv;charset=UTF-8'],
      ['text/csv;q=0', 'text/csv;charset=UTF-8'],
      ['text/csv;q=0.5', 'text/csv;charset=UTF-8'],
      ['TEXT/CSV', 'text/csv;charset=UTF-8'],
      ['text/plain;q=0.5, */*;q=0.1', 'text/csv;charset=UTF-8'],
    ];
    for (const [accept, type] of cases)
      expect([accept, text(negotiate(accept, CSV))]).toEqual([accept, type]);
  });

  it('writes under the accepted type where it names the subtype: its parameters, most first', () => {
    const cases: [string, string][] = [
      ['text/csv;foo=bar', 'text/csv;foo=bar;charset=UTF-8'],
      ['text/csv, text/csv;a=b', 'text/csv;a=b;charset=UTF-8'],
      ['text/csv;a=b, text/csv', 'text/csv;a=b;charset=UTF-8'],
      ['text/*, text/csv;x=y', 'text/csv;x=y;charset=UTF-8'],
      ['text/csv;x=y, text/csv;z=w', 'text/csv;x=y;charset=UTF-8'],
      ['TEXT/CSV;X=Y', 'text/csv;X=Y;charset=UTF-8'],
      ['text/csv;a="b c"', 'text/csv;a="b c";charset=UTF-8'],
      // Quality first, then the number of parameters; `q` itself dropped.
      ['text/csv;level=1;q=0.1, text/csv;q=0.9', 'text/csv;charset=UTF-8'],
      ['text/csv;q=0.1;a=b, text/csv;c=d;q=0.9', 'text/csv;c=d;charset=UTF-8'],
      ['text/csv;x=y;q=0.5, text/csv;a=b;c=d;q=0.5', 'text/csv;a=b;c=d;charset=UTF-8'],
      // Asked for in any case, removed by its exact name.
      ['text/csv;Q=0.5', 'text/csv;Q=0.5;charset=UTF-8'],
      ['*/*;q=0.1, text/csv;q=0.05', 'text/csv;charset=UTF-8'],
    ];
    for (const [accept, type] of cases)
      expect([accept, text(negotiate(accept, CSV))]).toEqual([accept, type]);
  });
});

describe('tomcatContentType, what Tomcat sends for the type Spring sets', () => {
  it('adds the response charset to a type without one, as given', () => {
    expect(tomcatContentType('text/csv;X=1')).toBe('text/csv;X=1;charset=UTF-8');
    expect(tomcatContentType('multipart/byteranges; boundary=b')).toBe(
      'multipart/byteranges; boundary=b;charset=UTF-8'
    );
    // Its own parser gives up on what is no token or quoted string: as given.
    expect(tomcatContentType("text/csv;a='b c';charset=x")).toBe(
      "text/csv;a='b c';charset=x;charset=UTF-8"
    );
  });

  it('rebuilds a type with a charset: names lower-cased, the charset unquoted and last', () => {
    expect(tomcatContentType('text/csv;charset=latin1;x=y')).toBe('text/csv;x=y;charset=latin1');
    expect(tomcatContentType('text/csv;X=1;charset=latin1')).toBe('text/csv;x=1;charset=latin1');
    expect(tomcatContentType('text/csv;x="a;b";charset=latin1')).toBe(
      'text/csv;x="a;b";charset=latin1'
    );
    expect(tomcatContentType('text/csv;charset="latin1"')).toBe('text/csv;charset=latin1');
    expect(tomcatContentType('text/csv;Charset=latin1')).toBe('text/csv;charset=latin1');
  });
});

describe('stringContentType and encodeText, a String as StringHttpMessageConverter writes it', () => {
  const string = (accept: string) => {
    const negotiation = negotiate(accept, PLAIN);
    if (negotiation.kind !== 'chosen') throw new Error(negotiation.kind);
    const written = stringContentType(negotiation.media);
    if ('failure' in written) throw new Error(written.failure);
    return written;
  };
  it('writes in the charset the type names, by that exact name; else UTF-8, put in last', () => {
    expect(string('text/plain;x=y')).toEqual({
      type: 'text/plain;x=y;charset=UTF-8',
      charset: 'UTF-8',
    });
    expect(string('text/plain;charset="latin1"')).toEqual({
      type: 'text/plain;charset=latin1',
      charset: 'latin1',
    });
    expect(string("text/plain;charset='latin1'").charset).toBe('latin1');
    // `Charset` is no charset to Spring: replaced by UTF-8, under its own name.
    expect(string('text/plain;Charset=latin1')).toEqual({
      type: 'text/plain;charset=UTF-8',
      charset: 'UTF-8',
    });
    // Spring keeps `Q` (removeQualityValue misses it), and Tomcat, rebuilding
    // around the charset, lower-cases it.
    expect(string('text/plain;Q=0.5').type).toBe('text/plain;q=0.5;charset=UTF-8');
  });

  it("encodes as the JDK's encoders do", () => {
    const hex = (charset: string) => encodeText('"N', charset)?.toString('hex');
    expect(hex('utf-16')).toBe('feff0022004e');
    expect(hex('unicode')).toBe('feff0022004e');
    expect(hex('UTF-16BE')).toBe('0022004e');
    expect(hex('x-utf-16le')).toBe('22004e00');
    expect(hex('utf-32')).toBe('000000220000004e');
    expect(hex('UTF-32LE')).toBe('220000004e000000');
    expect(hex('latin1')).toBe('224e');
    // Java's own encoders, measured: EBCDIC, the -BOM variants' marks, MacRoman.
    expect(hex('IBM037')).toBe('7fd5');
    expect(hex('x-UTF-16LE-BOM')).toBe('fffe22004e00');
    expect(hex('X-UTF-32BE-BOM')).toBe('0000feff000000220000004e');
    expect(hex('MacRoman')).toBe('224e');
    // A charset the JVM only reads has no encoder: Java's 500.
    expect(hex('ISO-2022-CN')).toBe(undefined);
  });
});

/** A request as the handlers read it, with these headers and body. */
const request = (headers: Record<string, string>, url = '/x', body?: Buffer): Request =>
  ({
    originalUrl: url,
    body,
    get: (name: string) => headers[name.toLowerCase()],
    rawHeaders: Object.entries(headers).flat(),
  }) as unknown as Request;

describe('resourceAnswer, a Resource with a Range as Spring answers it', () => {
  const bytes = Buffer.from('abcdef\nghij\n');
  const csv: MediaType = { type: 'text', subtype: 'csv', parameters: [] };
  const answer = (range?: string) =>
    resourceAnswer(request(range === undefined ? {} : { range }), bytes, csv);
  const summary = (range?: string) => {
    const { status, headers, body } = answer(range);
    return [status, headers?.['Content-Range'] ?? null, (body as Buffer).toString()];
  };

  it('is the whole file without a Range, accepting ranges', () => {
    expect(answer()).toEqual({
      status: 200,
      type: 'text/csv;charset=UTF-8',
      headers: { 'Accept-Ranges': 'bytes' },
      body: bytes,
    });
  });

  it('answers one range with a 206', () => {
    expect(summary('bytes=0-2')).toEqual([206, 'bytes 0-2/12', 'abc']);
    expect(summary('bytes=-3')).toEqual([206, 'bytes 9-11/12', 'ij\n']);
    expect(summary('bytes=-50')).toEqual([206, 'bytes 0-11/12', bytes.toString()]);
    expect(summary('bytes=11-11')).toEqual([206, 'bytes 11-11/12', '\n']);
    expect(summary('bytes=10-99999')).toEqual([206, 'bytes 10-11/12', 'j\n']);
    expect(summary('bytes= 0-2 ,')).toEqual([206, 'bytes 0-2/12', 'abc']);
    expect(summary('bytes=+1-2')).toEqual([206, 'bytes 1-2/12', 'bc']);
  });

  it('is a 416 with the whole file for a range it cannot read or satisfy', () => {
    for (const range of [
      'garbage',
      'Bytes=0-2',
      'bytes=12-',
      'bytes=50-',
      'bytes=3-2',
      'bytes=-0',
      'bytes=1',
      'bytes=a-b',
      'bytes=-1-2',
      'bytes=0-99999999999999999999',
      // Several adding up to the whole.
      'bytes=0-5,6-11',
    ])
      expect([range, ...summary(range)]).toEqual([range, 416, 'bytes */12', bytes.toString()]);
    // A hundred ranges, but not a hundred and one.
    const ranges = (count: number) => `bytes=${Array<string>(count).fill('0-0').join(',')}`;
    const long = Buffer.alloc(1000);
    expect(resourceAnswer(request({ range: ranges(100) }), long, csv).status).toBe(206);
    expect(resourceAnswer(request({ range: ranges(101) }), long, csv).status).toBe(416);
  });

  it('writes several as multipart/byteranges, each part its type and range', () => {
    const { status, type, body } = answer('bytes=0-1,3-4');
    const boundary = /boundary=([-_0-9A-Za-z]{30,40});charset=UTF-8$/.exec(String(type))?.[1];
    expect([status, Boolean(boundary)]).toEqual([206, true]);
    expect((body as Buffer).toString()).toBe(
      `\r\n--${boundary}\r\nContent-Type: text/csv\r\nContent-Range: bytes 0-1/12\r\n\r\nab` +
        `\r\n--${boundary}\r\nContent-Type: text/csv\r\nContent-Range: bytes 3-4/12\r\n\r\nde` +
        `\r\n--${boundary}--`
    );
    // Only the first Range counts, as HttpHeaders.getFirst has it; Node joins them.
    const twice = resourceAnswer(
      {
        get: () => 'bytes=0-1, bytes=3-4',
        rawHeaders: ['Range', 'bytes=0-1', 'range', 'bytes=3-4'],
      } as unknown as Request,
      bytes,
      csv
    );
    expect([twice.status, twice.headers?.['Content-Range']]).toEqual([206, 'bytes 0-1/12']);
    // An empty Range is no range at all: a multipart of none.
    expect((answer('').body as Buffer).toString()).toMatch(/^\r\n--[-_0-9A-Za-z]{30,40}--$/);
  });
});

describe('servletRequestParameters, as Tomcat reads a query and a form', () => {
  const FORM_TYPE = { 'content-type': 'application/x-www-form-urlencoded' };
  const values = (headers: Record<string, string>, url: string, body: string | Buffer) =>
    servletRequestParameters(
      request(headers, url, Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'))
    )('content');

  it("takes the query's values, then a form body's", () => {
    expect(values(FORM_TYPE, '/x?content=q', 'content=a&content=b')).toEqual(['q', 'a', 'b']);
    expect(
      values({ 'content-type': 'application/x-www-form-urlencoded ; q=1' }, '/x', 'content=a')
    ).toEqual(['a']);
  });

  it('reads a body only of exactly the form type, by case', () => {
    expect(
      values({ 'content-type': 'APPLICATION/X-WWW-FORM-URLENCODED' }, '/x', 'content=a')
    ).toEqual([]);
    expect(values({ 'content-type': 'text/plain' }, '/x?content=q', 'content=a')).toEqual(['q']);
    expect(values({}, '/x', 'content=a')).toEqual([]);
  });

  it('decodes the bytes as UTF-8, a raw byte and an escaped one together', () => {
    expect(
      values(FORM_TYPE, '/x', Buffer.from('636f6e74656e743dc3%A9'.replace('%A9', ''), 'hex'))
    ).toEqual(['�']);
    expect(
      values(
        FORM_TYPE,
        '/x',
        Buffer.concat([Buffer.from('content=\xc3', 'latin1'), Buffer.from('%A9')])
      )
    ).toEqual(['é']);
    expect(values(FORM_TYPE, '/x', 'content=%E9')).toEqual(['�']);
  });

  it('reads no body past maxPostSize, and no parameter past maxParameterCount', () => {
    const big = `content=${'a'.repeat(2 * 1024 * 1024 - 8)}`;
    expect(values(FORM_TYPE, '/x', big)).toHaveLength(1);
    expect(values(FORM_TYPE, '/x?content=q', `${big}a`)).toEqual(['q']);
    const many = (count: number) =>
      [...Array.from({ length: count }, (_, i) => `p${i}=1`), 'content=z'].join('&');
    expect(values(FORM_TYPE, '/x', many(9999))).toEqual(['z']);
    expect(values(FORM_TYPE, '/x', many(10_000))).toEqual([]);
    // What Tomcat skips -- no name, a malformed escape -- is not counted.
    expect(values(FORM_TYPE, '/x', `=1&%zz=1&${many(9999)}`)).toEqual(['z']);
    expect(values(FORM_TYPE, '/x?a=1', many(9999))).toEqual([]);
  });
});

describe("Java's charsets, by Java's names (charset-snapshot.json)", () => {
  it('takes the names Java knows, and refuses the ones only TextDecoder knows', () => {
    for (const name of [
      'cp437',
      'IBM037',
      'x-UTF-16LE-BOM',
      'X-UTF-32BE-BOM',
      'MacRoman',
      'x-MacRoman',
      'csiso2022kr',
      '"ibm-37"',
    ])
      expect([name, consumesProblem(`text/plain;charset=${name}`, FORM)]).toEqual([
        name,
        undefined,
      ]);
    for (const name of [
      'x-user-defined',
      'x-mac-cyrillic',
      'csunicode',
      'ucs-2',
      'iso-8859-8-i',
      'unicodefeff',
      'unicodefffe',
    ])
      expect(consumesProblem(`text/plain;charset=${name}`, FORM)).toBe(
        `Invalid mime type "text/plain;charset=${name}": unsupported charset '${name}'`
      );
  });

  it('reads a body as Java does, where it can: tables, ASCII, the UTF family', () => {
    const read = (charset: string, hex: string) =>
      plainText(Buffer.from(hex, 'hex'), `text/plain;charset=${charset}`);
    expect(read('cp437', '52802d')).toBe('RÇ-');
    expect(read('IBM037', 'd9c1')).toBe('RA');
    // A double-byte EBCDIC page by its single-byte table, before any shift-out.
    expect(read('x-IBM930', 'd9c1')).toBe('RA');
    // A Japanese IBM page reads `\` and `~` as its own characters.
    expect(read('x-IBM942', '5c7e41')).toBe('¥‾A');
    expect(read('Shift_JIS', '522d41')).toBe('R-A');
    // x-UTF-16LE-BOM: little-endian without a mark, as the mark says with one.
    expect(read('x-UTF-16LE-BOM', '52002d00')).toBe('R-');
    expect(read('x-UTF-16LE-BOM', 'feff0052002d')).toBe('R-');
    expect(read('X-UTF-32BE-BOM', '0000feff00000052')).toBe('R');
  });

  it('reads nothing it cannot read as Java does: undefined, which the endpoints refuse', () => {
    const read = (charset: string, hex: string) =>
      plainText(Buffer.from(hex, 'hex'), `text/plain;charset=${charset}`);
    // A pure double-byte page, ASCII or not; a shift-out; bytes past ASCII
    // in a charset TextDecoder does not know.
    expect(read('x-IBM834', '522d41')).toBe(undefined);
    expect(read('x-IBM930', '0e4141')).toBe(undefined);
    expect(read('x-IBM33722', '52e9')).toBe(undefined);
    expect(unreadableCharset('text/plain;charset=ibm834')).toBe(
      'This service cannot read a body in x-IBM834'
    );
  });
});

describe('negotiate when a quality fails, as Java fails', () => {
  it('fails while sorting, before the controller, comparing pairs as Java does', () => {
    const cases: [string, string | number][] = [
      ['text/csv;Q=abc, application/json', 'failed: For input string: "abc"'],
      ['application/json, text/csv;Q=abc', 'failed: For input string: "abc"'],
      // Java's insertion sort compares the second with the first, reading the second's first.
      ['text/csv;Q=a, text/csv;Q=b, text/csv;Q=c', 'failed: For input string: "b"'],
      // A one-type Accept is not sorted, and an incompatible one never copied.
      ['application/json;Q=abc', 406],
    ];
    for (const [accept, outcome] of cases)
      expect([accept, text(negotiate(accept, CSV))]).toEqual([accept, outcome]);
  });

  it('fails once the controller has answered, copying the quality onto the produced type', () => {
    const cases: [string, string][] = [
      ['text/csv;Q=abc', 'write-failed: For input string: "abc"'],
      ['*/*;Q=x', 'write-failed: For input string: "x"'],
      ['text/csv;Q=" "', 'write-failed: empty String'],
      ['text/csv;Q=7', 'write-failed: Invalid quality value "7": should be between 0.0 and 1.0'],
      [
        'text/csv;Q=7, text/*',
        'write-failed: Invalid quality value "7": should be between 0.0 and 1.0',
      ],
      // Sorted without reading either quality (a wildcard subtype decides), so
      // the one copied first fails: the specific type's.
      ['text/*;Q=abc, text/csv;Q=def', 'write-failed: For input string: "def"'],
    ];
    for (const [accept, outcome] of cases)
      expect([accept, text(negotiate(accept, CSV))]).toEqual([accept, outcome]);
  });

  it("is Spring's 500 for a type that does not read back once the charset is added", () => {
    const negotiation = negotiate('text/plain;x="a\\"b"', PLAIN);
    if (negotiation.kind !== 'chosen') throw new Error(negotiation.kind);
    expect(stringContentType(negotiation.media)).toEqual({
      failure:
        'Invalid mime type "text/plain;x="a\\"b";charset=UTF-8": Invalid token character \'"\' in token ""a\\"b";charset=UTF-8"',
    });
  });
});
