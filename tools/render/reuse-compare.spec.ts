// @vitest-environment node
//
// The reuse comparison (spec 018 T002, research R5): its orders, what it sets
// aside per format, and that it fails on a planted difference, naming the
// request and the request drawn before it.
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { compare, draw, normalise, opposites, orders, parseSample } from './reuse-compare.ts';
import type { Drawn } from './reuse-compare.ts';

const drawn = (path: string, text: string, previous?: string, status = 200): Drawn => ({
  path,
  previous,
  status,
  bytes: Buffer.from(text),
});

describe('the sample', () => {
  it('is one request per line, comments and blank lines left out', () => {
    expect(
      parseSample('# reactions\n/render/R-HSA-1.svg\n\n/render/R-HSA-2.png # light\n')
    ).toEqual(['/render/R-HSA-1.svg', '/render/R-HSA-2.png']);
  });
});

describe('the orders', () => {
  const sample = [
    '/render/R-HSA-1.svg',
    '/render/R-HSA-2.svg?dark=true',
    '/render/R-HSA-3.svg?token=T',
  ];

  it('are as listed, reversed, and each request after its opposites', () => {
    const { listed, reversed, opposites: paired } = orders(sample);
    expect(listed).toEqual(sample);
    expect(reversed).toEqual([...sample].reverse());
    // Every request is there, each straight after the requests opposite it.
    for (const request of sample) {
      const at = paired.indexOf(request);
      const before = opposites(request, 'T');
      expect(paired.slice(at - before.length, at)).toEqual(before);
    }
  });

  it('puts dark after light and light after dark', () => {
    expect(opposites('/render/R-HSA-1.svg', undefined)).toEqual(['/render/R-HSA-1.svg?dark=true']);
    expect(opposites('/render/R-HSA-1.svg?dark=true', undefined)).toEqual(['/render/R-HSA-1.svg']);
  });

  it("puts a token after none, and none after the sample's token", () => {
    expect(opposites('/render/R-HSA-1.svg?token=T', 'T')).toContain('/render/R-HSA-1.svg');
    expect(opposites('/render/R-HSA-1.svg', 'T')).toContain('/render/R-HSA-1.svg?token=T');
  });

  it('puts a selection after none, and a species after another', () => {
    expect(opposites('/render/R-HSA-1.svg?select=R-HSA-2', undefined)).toContain(
      '/render/R-HSA-1.svg'
    );
    expect(opposites('/render/genome-wide.svg', undefined)).toContain(
      '/render/genome-wide.svg?species=10090'
    );
    expect(opposites('/render/genome-wide.svg?species=10090', undefined)).toContain(
      '/render/genome-wide.svg'
    );
  });
});

describe('what varies by itself', () => {
  it('is nothing for SVG and the rasters: one byte is a difference', () => {
    expect(
      normalise('svg', Buffer.from('<svg a/>')).equals(normalise('svg', Buffer.from('<svg b/>')))
    ).toBe(false);
    expect(
      normalise('png', Buffer.from([1, 2])).equals(normalise('png', Buffer.from([1, 3])))
    ).toBe(false);
  });

  it("is a PDF's dates and id, and nothing else in it", () => {
    const pdf = (date: string, id: string, body: string) =>
      Buffer.from(
        `<< /CreationDate (D:${date}) /ModDate (D:${date}) >> /ID [<${id}> <${id}>] ${body}`,
        'latin1'
      );
    expect(
      normalise('pdf', pdf('20261105', 'AB', 'x')).equals(
        normalise('pdf', pdf('20261106', 'CD', 'x'))
      )
    ).toBe(true);
    expect(
      normalise('pdf', pdf('20261105', 'AB', 'x')).equals(
        normalise('pdf', pdf('20261105', 'AB', 'y'))
      )
    ).toBe(false);
  });

  it("is a PowerPoint's zip times, and nothing in its parts", () => {
    const pptx = (time: Date, text: string) =>
      Buffer.from(zipSync({ 'ppt/slide1.xml': [strToU8(text), { mtime: time }] }));
    const early = new Date('2026-11-05T01:00:00Z');
    const late = new Date('2026-11-05T02:00:00Z');
    expect(pptx(early, 'a').equals(pptx(late, 'a'))).toBe(false);
    expect(normalise('pptx', pptx(early, 'a')).equals(normalise('pptx', pptx(late, 'a')))).toBe(
      true
    );
    expect(normalise('pptx', pptx(early, 'a')).equals(normalise('pptx', pptx(early, 'b')))).toBe(
      false
    );
  });
});

describe('the comparison', () => {
  const reference = new Map(
    [drawn('/render/A.svg', 'a'), drawn('/render/B.svg', 'b')].map((item) => [item.path, item])
  );

  it('passes what matches the reference', () => {
    expect(
      compare('listed', reference, [
        drawn('/render/A.svg', 'a'),
        drawn('/render/B.svg', 'b', '/render/A.svg'),
      ])
    ).toEqual([]);
  });

  it('fails on a planted difference, naming the request and the one drawn before it', () => {
    expect(
      compare('reversed', reference, [
        drawn('/render/B.svg', 'b'),
        drawn('/render/A.svg', 'A!', '/render/B.svg'),
      ])
    ).toEqual([
      { run: 'reversed', path: '/render/A.svg', previous: '/render/B.svg', why: 'svg differs' },
    ]);
  });

  it('fails on a status the reference did not have', () => {
    expect(compare('listed', reference, [drawn('/render/A.svg', '', undefined, 500)])).toEqual([
      {
        run: 'listed',
        path: '/render/A.svg',
        previous: undefined,
        why: "status 500, the reference's 200",
      },
    ]);
  });

  it('does not compare an opposite drawn only to come first, unless it failed', () => {
    expect(compare('opposites', reference, [drawn('/render/A.svg?dark=true', 'x')])).toEqual([]);
    expect(
      compare('opposites', reference, [drawn('/render/A.svg?dark=true', '', undefined, 503)])
    ).toEqual([
      { run: 'opposites', path: '/render/A.svg?dark=true', previous: undefined, why: 'status 503' },
    ]);
  });
});

describe('drawing', () => {
  it('asks one request at a time, in order, each with the one before it', async () => {
    const asked: string[] = [];
    const result = await draw('http://service', ['/render/A.svg', '/render/B.svg'], async (url) => {
      asked.push(url);
      return { status: 200, bytes: Buffer.from(url) };
    });
    expect(asked).toEqual(['http://service/render/A.svg', 'http://service/render/B.svg']);
    expect(result.map((item) => item.previous)).toEqual([undefined, '/render/A.svg']);
  });
});
