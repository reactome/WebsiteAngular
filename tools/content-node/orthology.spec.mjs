// @vitest-environment node
//
// The orthology endpoints and what they rest on, as far as no database is
// needed: Spring's Long path variable, Java's String.split and HashMap order,
// the POST's content type, and the 405 Java answers for a method a mapping
// does not take. Every expected value below was measured against Java's
// /data/orthology and /data/orthologies on 15 Oct 2026.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { app, JavaHashMap, orthologyIds, plainTextProblem, springPathLong } from './service.mjs';
import { JsonMap, mapNodes, VIEW, writeDomain } from './domain.mjs';

let base;
let server;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app().listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('springPathLong, a Long path variable as Spring converts it', () => {
  it('reads what Long.valueOf and Long.decode read', () => {
    // Spaces anywhere are removed first; 0x and # are hex; a '+' sign, leading
    // zeros and another script's digits are accepted.
    for (const text of [
      '48892',
      '0xBEFC',
      '#BEFC',
      ' 48892',
      '488 92',
      '+48892',
      '048892',
      '４８８９２',
    ])
      expect(springPathLong(text, 'speciesId'), text).toEqual({ value: 48892n });
    expect(springPathLong('-0x8000000000000000', 'speciesId')).toEqual({
      value: -9223372036854775808n,
    });
    expect(springPathLong('9223372036854775807', 'speciesId')).toEqual({
      value: 9223372036854775807n,
    });
  });

  it("refuses the rest with Java's 400, naming what it could not parse", () => {
    const refused = (text) =>
      `Failed to convert value of type 'java.lang.String' to required type 'java.lang.Long'; ` +
      `nested exception is java.lang.NumberFormatException: For input string: "${text}"`;
    for (const [given, named] of [
      ['abc', 'abc'],
      ['99999999999999999999', '99999999999999999999'],
      ['0x8000000000000000', '8000000000000000'],
      ['0x', ''],
      ['1.5', '1.5'],
      ['48892.0', '48892.0'],
    ])
      expect(springPathLong(given, 'speciesId'), given).toEqual({
        status: 400,
        error: refused(named),
      });
  });

  it("reads a blank one as null, which for a path variable is Java's 500", () => {
    expect(springPathLong(' ', 'speciesId')).toEqual({
      status: 500,
      error:
        "Required URI template variable 'speciesId' for method parameter type Long is present but converted to null",
    });
  });
});

describe('JavaHashMap, in the order Java iterates a HashMap', () => {
  const order = (keys) => {
    const map = new JavaHashMap();
    for (const key of keys) map.set(key, key);
    return [...map.keys()];
  };

  it('orders by bucket, as Java answered', () => {
    expect(order(['R-HSA-69620', 'R-HSA-69608', '69620'])).toEqual([
      'R-HSA-69620',
      '69620',
      'R-HSA-69608',
    ]);
    expect(order(['R-HSA-69608', 'R-HSA-69620', 'REACT_1538'])).toEqual([
      'R-HSA-69620',
      'R-HSA-69608',
      'REACT_1538',
    ]);
  });

  it('keeps a key where it was when it is put again', () => {
    const map = new JavaHashMap();
    map.set('Aa', 1);
    map.set('BB', 2); // the same String.hashCode as 'Aa'
    map.set('Aa', 3);
    expect([...map.entries()]).toEqual([
      ['Aa', 3],
      ['BB', 2],
    ]);
  });

  it('splits its buckets in order when it grows past twelve', () => {
    // 16 buckets hold 12; the 13th key doubles the table, and keys that share
    // a bucket at 16 keep their relative order in each half at 32.
    const keys = Array.from({ length: 13 }, (_, at) => `k${at * 16}`);
    const map = new JavaHashMap();
    for (const key of keys) map.set(key, true);
    const hash = (key) => {
      let h = 0;
      for (const unit of key) h = (Math.imul(31, h) + unit.charCodeAt(0)) | 0;
      return (h ^ (h >>> 16)) >>> 0;
    };
    const expected = [...keys].sort(
      (a, b) => (hash(a) & 31) - (hash(b) & 31) || keys.indexOf(a) - keys.indexOf(b)
    );
    expect([...map.keys()]).toEqual(expected);
  });
});

describe('orthologyIds, the POST body as the controller reads it', () => {
  it('splits on , ; newline and tab, as String.split does, trailing empties dropped', () => {
    expect(orthologyIds(',a ;\tb\r\nc,,')).toEqual(['', 'a', '', 'b', 'c']);
    expect(orthologyIds(',,')).toEqual([]);
    expect(orthologyIds(' ')).toEqual(['']);
    expect(orthologyIds('a,a')).toEqual(['a', 'a']);
  });

  it('keeps the first twenty of more, in a HashSet', () => {
    const ids = Array.from({ length: 22 }, (_, at) => `R-HSA-${at}`);
    const kept = new JavaHashMap();
    for (const id of ids.slice(0, 20)) kept.set(id, true);
    expect(orthologyIds(ids.join(','))).toEqual([...kept.keys()]);
  });
});

describe('plainTextProblem, the POST content type as Spring checks it', () => {
  it('takes text/plain in any case, with or without a charset', () => {
    for (const type of [
      'text/plain',
      'TEXT/PLAIN',
      'text/plain;charset=UTF-8',
      'text/plain; charset=utf-8',
    ])
      expect(plainTextProblem(type), type).toBe(undefined);
  });

  it("refuses anything else with Java's message", () => {
    expect(plainTextProblem(undefined)).toBe("Content type '' not supported");
    expect(plainTextProblem('application/json; charset=utf-8')).toBe(
      "Content type 'application/json;charset=utf-8' not supported"
    );
    expect(plainTextProblem('text/*')).toBe("Content type 'text/*' not supported");
    expect(plainTextProblem('garbage')).toBe('Invalid mime type "garbage": does not contain \'/\'');
    expect(plainTextProblem('text/plain; charset=bogus')).toBe(
      'Invalid mime type "text/plain; charset=bogus": unsupported charset \'bogus\''
    );
  });
});

describe('writeDomain with a map', () => {
  it('writes the keys in the order given', () => {
    const map = new JsonMap([
      ['b', 1],
      ['a', [2]],
    ]);
    expect(writeDomain(map)).toBe('{"b":1,"a":[2]}');
  });

  it('numbers @id across the values, as Jackson does in one write', () => {
    // Java's ?includeRef=true answer for three ids: @id 1, 2 and 3, the same
    // object found twice written twice, each its own instance.
    const node = { id: 7, labels: ['Pathway', 'Event', 'DatabaseObject'], props: { dbId: 7 } };
    const map = new JsonMap([
      ['R-HSA-69620', mapNodes([node])[0]],
      ['69620', mapNodes([node])[0]],
    ]);
    const written = writeDomain(map, VIEW.flatten, { jsog: true });
    expect(written.match(/"@id":"\d+"/g)).toEqual(['"@id":"1"', '"@id":"2"']);
    expect(written).not.toContain('@ref');
  });
});

describe('the orthology endpoints, before any query', () => {
  const get = (path, init) => fetch(`${base}/ContentService/data${path}`, init);
  const envelope = async (response) => {
    const body = await response.json();
    return [response.status, body.reason, body.messages];
  };

  it('converts the species first', async () => {
    expect(await envelope(await get('/orthology/R-HSA-69620/species/abc'))).toEqual([
      400,
      'BAD_REQUEST',
      [
        "Failed to convert value of type 'java.lang.String' to required type 'java.lang.Long'; nested exception is java.lang.NumberFormatException: For input string: \"abc\"",
      ],
    ]);
    expect((await get('/orthology/R-HSA-69620/species/%20')).status).toBe(500);
  });

  it('is a 404 naming id and species for an id that is no id', async () => {
    expect(await envelope(await get('/orthology/xyz/species/0xBEFC'))).toEqual([
      404,
      'NOT_FOUND',
      ["No orthology found for 'xyz' in species '48892'"],
    ]);
  });

  it("is Java's 500 for a dbId past a long", async () => {
    expect(await envelope(await get('/orthology/99999999999999999999/species/48892'))).toEqual([
      500,
      'INTERNAL_SERVER_ERROR',
      ['For input string: "99999999999999999999"'],
    ]);
  });

  const post = (species, body, type = 'text/plain') =>
    get(`/orthologies/ids/species/${species}`, {
      method: 'POST',
      headers: type ? { 'Content-Type': type } : {},
      body,
    });

  it('checks the content type, then the species, then the body', async () => {
    expect(await envelope(await post('abc', 'x', 'application/json'))).toEqual([
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      ["Content type 'application/json' not supported"],
    ]);
    expect((await post('abc', undefined)).status).toBe(400);
    const [status, reason, [message]] = await envelope(await post('48892', undefined));
    expect([status, reason]).toEqual([422, 'UNPROCESSABLE_ENTITY']);
    expect(message).toBe(
      'Required request body is missing: public java.util.Map<java.lang.Object, org.reactome.server.graph.domain.model.DatabaseObject> org.reactome.server.service.controller.graph.OrthologyController.getOrthologies(java.lang.Long,java.lang.String)'
    );
  });

  it('is a 404 when no id is an id', async () => {
    expect(await envelope(await post('48892', ',,'))).toEqual([
      404,
      'NOT_FOUND',
      ['No orthologies found'],
    ]);
    expect(await envelope(await post('48892', 'xyz, .'))).toEqual([
      404,
      'NOT_FOUND',
      ['No orthologies found'],
    ]);
  });

  it("is Java's 500 for a dbId past a long anywhere in the list", async () => {
    expect(await envelope(await post('48892', 'xyz,99999999999999999999'))).toEqual([
      500,
      'INTERNAL_SERVER_ERROR',
      ['For input string: "99999999999999999999"'],
    ]);
  });
});

describe('a method a mapping does not take', () => {
  it("is Java's 405, on every ported endpoint", async () => {
    // nginx sends every method on these paths to node; Express's own answer was
    // an HTML 404.
    const answers = await Promise.all([
      fetch(`${base}/ContentService/data/query/enhanced/v2/R-HSA-69620`, { method: 'POST' }),
      fetch(`${base}/ContentService/data/orthology/R-HSA-69620/species/48892`, { method: 'PUT' }),
      fetch(`${base}/ContentService/data/orthologies/ids/species/48892`),
    ]);
    const bodies = await Promise.all(answers.map((response) => response.json()));
    expect(answers.map((response) => response.status)).toEqual([405, 405, 405]);
    expect(bodies.map((body) => body.messages[0])).toEqual([
      "Request method 'POST' not supported",
      "Request method 'PUT' not supported",
      "Request method 'GET' not supported",
    ]);
    expect(bodies[0].reason).toBe('METHOD_NOT_ALLOWED');
  });
});

describe("Spring's guard against a download named by the URL", () => {
  // AbstractMessageConverterMethodProcessor.addContentDispositionHeader: a body
  // written for a path whose last segment -- or a matrix parameter on it --
  // ends in an extension Spring does not trust is sent as an attachment-proof
  // inline f.txt. Each case measured against Java on 15 Oct 2026, on the
  // species segment, which fails before any query.
  const disposition = async (last) => {
    const response = await fetch(`${base}/ContentService/data/orthology/xyz/species/${last}`);
    await response.arrayBuffer();
    return response.headers.get('content-disposition');
  };
  const guarded = 'inline;filename=f.txt';

  for (const last of [
    '48892.pdf',
    '48892.exe',
    '48892.html',
    '48892.sub',
    '48892;a.exe',
    '48892%2Epdf',
    '48892.wasm',
    '48892.jsonp',
    '48892.5',
  ])
    it(`marks ${last}`, async () => {
      expect(await disposition(last)).toBe(guarded);
    });

  for (const last of [
    '48892',
    '48892.svg',
    '48892.xhtml',
    '48892.mp4',
    '48892.SVG',
    '48892;a.svg',
    '48892.',
    '48892.svg;x',
    '48892.json',
  ])
    it(`leaves ${last} alone`, async () => {
      expect(await disposition(last)).toBe(null);
    });

  it('applies to every ported endpoint, as to the versioned id the site may send', async () => {
    const response = await fetch(`${base}/ContentService/data/query/R-HSA-69620.5`);
    await response.arrayBuffer();
    expect(response.headers.get('content-disposition')).toBe(guarded);
  });
});
