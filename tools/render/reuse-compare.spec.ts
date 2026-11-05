// @vitest-environment node
//
// The reuse comparison (spec 018 T002, research R5): its runs, what it sets
// aside per format, what it requires of a service, and that it fails on a
// planted difference, naming the request and the request drawn before it.
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  canonical,
  compare,
  draw,
  healthProblem,
  heldProblem,
  normalise,
  opposites,
  orders,
  pairRuns,
  parseSample,
} from './reuse-compare.ts';
import type { Drawn } from './reuse-compare.ts';

const drawn = (
  path: string,
  text: string,
  previous?: string,
  status = 200,
  cache = 'miss'
): Drawn => ({
  path,
  previous,
  status,
  cache,
  bytes: Buffer.from(text),
});

describe('the sample', () => {
  it('is one request per line, each once, comments and blank lines left out', () => {
    expect(
      parseSample(
        '# reactions\n/render/R-HSA-1.svg\n\n/render/R-HSA-2.png # light\n/render/R-HSA-1.svg\n'
      )
    ).toEqual(['/render/R-HSA-1.svg', '/render/R-HSA-2.png']);
  });
});

describe('the opposites', () => {
  it('are dark for light and light for dark', () => {
    expect(opposites('/render/R-HSA-1.svg', [], undefined)).toEqual([
      '/render/R-HSA-1.svg?dark=true',
    ]);
    expect(opposites('/render/R-HSA-1.svg?dark=true', [], undefined)).toEqual([
      '/render/R-HSA-1.svg',
    ]);
  });

  it("are none for a token, and the sample's token for none", () => {
    expect(opposites('/render/R-HSA-1.svg?token=T', [], 'T')).toContain('/render/R-HSA-1.svg');
    expect(opposites('/render/R-HSA-1.svg', [], 'T')).toContain('/render/R-HSA-1.svg?token=T');
  });

  it("are none for a selection, and the sample's selections on the same diagram for none", () => {
    const sample = [
      '/render/R-HSA-1.svg',
      '/render/R-HSA-1.svg?select=R-HSA-2',
      '/render/R-HSA-3.svg?select=R-HSA-4',
    ];
    expect(opposites('/render/R-HSA-1.svg?select=R-HSA-2', sample, undefined)).toContain(
      '/render/R-HSA-1.svg'
    );
    const forNone = opposites('/render/R-HSA-1.svg', sample, undefined);
    expect(forNone).toContain('/render/R-HSA-1.svg?select=R-HSA-2');
    expect(forNone).not.toContain('/render/R-HSA-3.svg?select=R-HSA-4');
  });

  it("are none for a highlight or subpathways off, and the sample's own on the same figure for none", () => {
    const sample = [
      '/render/R-HSA-1.svg',
      '/render/R-HSA-1.svg?highlight=R-HSA-2',
      '/render/R-HSA-1.svg?subpathways=false',
      '/render/R-HSA-3.svg?highlight=R-HSA-4',
    ];
    expect(opposites('/render/R-HSA-1.svg?highlight=R-HSA-2', sample, undefined)).toContain(
      '/render/R-HSA-1.svg'
    );
    expect(opposites('/render/R-HSA-1.svg?subpathways=false', sample, undefined)).toContain(
      '/render/R-HSA-1.svg'
    );
    const forNone = opposites('/render/R-HSA-1.svg', sample, undefined);
    expect(forNone).toContain('/render/R-HSA-1.svg?highlight=R-HSA-2');
    expect(forNone).toContain('/render/R-HSA-1.svg?subpathways=false');
    expect(forNone).not.toContain('/render/R-HSA-3.svg?highlight=R-HSA-4');
  });

  it("are the sample's other tokens for a token, so one token's colours cannot stay for the next", () => {
    const sample = ['/render/R-HSA-1.svg?token=A', '/render/R-HSA-5.svg?token=B'];
    expect(opposites('/render/R-HSA-1.svg?token=A', sample, 'A')).toContain(
      '/render/R-HSA-1.svg?token=B'
    );
  });

  it("are the sample's species overviews before a figure that is not an overview", () => {
    const sample = ['/render/R-HSA-1.svg', '/render/genome-wide.svg?species=10090'];
    expect(opposites('/render/R-HSA-1.svg', sample, undefined)).toContain(
      '/render/genome-wide.svg?species=10090'
    );
  });

  it('never pair a request with itself', () => {
    const sample = ['/render/R-HSA-1.svg', '/render/R-HSA-1.svg?highlight=R-HSA-2'];
    for (const request of sample)
      expect(opposites(request, sample, undefined).map(canonical)).not.toContain(
        canonical(request)
      );
  });

  it("are another species' overview", () => {
    expect(opposites('/render/genome-wide.svg', [], undefined)).toContain(
      '/render/genome-wide.svg?species=10090'
    );
    expect(opposites('/render/genome-wide.svg?species=10090', [], undefined)).toContain(
      '/render/genome-wide.svg'
    );
  });
});

describe('the runs', () => {
  // A sample holding requests and their own opposites, as R5's does.
  const sample = [
    '/render/R-HSA-1.svg',
    '/render/R-HSA-1.svg?dark=true',
    '/render/R-HSA-1.svg?select=R-HSA-2',
    '/render/R-HSA-3.svg?token=T',
    '/render/R-HSA-3.svg',
    '/render/genome-wide.svg',
  ];

  it('are as listed and reversed, then pairs', () => {
    const runs = orders(sample);
    expect(runs['listed']).toEqual(sample);
    expect(runs['reversed']).toEqual([...sample].reverse());
    expect(
      Object.keys(runs)
        .slice(2)
        .every((label) => label.startsWith('pairs '))
    ).toBe(true);
  });

  it('put each request straight after each of its opposites, once', () => {
    const pairs = pairRuns(sample).flatMap((run) =>
      run.flatMap((request, at) => (at % 2 ? [`${run[at - 1]} -> ${request}`] : []))
    );
    const expected = sample.flatMap((request) =>
      opposites(request, sample, 'T').map((opposite) => `${opposite} -> ${request}`)
    );
    expect(pairs.sort()).toEqual(expected.sort());
  });

  it('never ask for the same request twice in one run, which the cache would answer', () => {
    for (const requests of Object.values(orders(sample)))
      expect(new Set(requests).size).toBe(requests.length);
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

  it("is a PowerPoint's zip, and nothing in its parts", () => {
    const pptx = (time: Date, parts: Record<string, string>) =>
      Buffer.from(
        zipSync(
          Object.fromEntries(
            Object.entries(parts).map(([name, text]) => [name, [strToU8(text), { mtime: time }]])
          )
        )
      );
    const early = new Date('2026-11-05T01:00:00Z');
    const late = new Date('2026-11-05T02:00:00Z');
    expect(pptx(early, { a: 'x' }).equals(pptx(late, { a: 'x' }))).toBe(false);
    expect(
      normalise('pptx', pptx(early, { a: 'x' })).equals(normalise('pptx', pptx(late, { a: 'x' })))
    ).toBe(true);
    expect(
      normalise('pptx', pptx(early, { a: 'x' })).equals(normalise('pptx', pptx(early, { a: 'y' })))
    ).toBe(false);
    // Lengths keep parts apart: "a" holding "b\n" is not "a\nb" holding nothing.
    expect(
      normalise('pptx', pptx(early, { a: 'b\n1\n' })).equals(
        normalise('pptx', pptx(early, { 'a\nb': '' }))
      )
    ).toBe(false);
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

  it('fails on a figure served from the cache, which was not drawn', () => {
    expect(
      compare('pairs 1', reference, [drawn('/render/A.svg', 'a', undefined, 200, 'hit')])
    ).toEqual([
      {
        run: 'pairs 1',
        path: '/render/A.svg',
        previous: undefined,
        why: 'served from the cache, not drawn',
      },
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
    expect(compare('pairs 1', reference, [drawn('/render/A.svg?dark=true', 'x')])).toEqual([]);
    expect(
      compare('pairs 1', reference, [drawn('/render/A.svg?dark=true', '', undefined, 503)])
    ).toEqual([
      { run: 'pairs 1', path: '/render/A.svg?dark=true', previous: undefined, why: 'status 503' },
    ]);
  });
});

describe('the service a run needs', () => {
  it('reads local files, never the download site', () => {
    expect(healthProblem({ files: 'download site' }, false)).toBe('does not read local files');
    expect(healthProblem(undefined, false)).toBe('never answered /health');
  });

  it('holds pages for a reused run, so a fresh one cannot pass in its place', () => {
    expect(healthProblem({ files: 'local' }, true)).toMatch(/does not hold pages/);
    expect(healthProblem({ files: 'local', reuse: false }, true)).toMatch(/does not hold pages/);
    expect(healthProblem({ files: 'local', reuse: true }, true)).toBeUndefined();
  });

  it('holds none for the fresh reference', () => {
    expect(healthProblem({ files: 'local', reuse: true }, false)).toBe(
      'holds pages, for a fresh run'
    );
    expect(healthProblem({ files: 'local' }, false)).toBeUndefined();
    expect(healthProblem({ files: 'local', reuse: false }, false)).toBeUndefined();
  });
});

describe('drawing', () => {
  it('asks one request at a time, in order, each with the one before it', async () => {
    const asked: string[] = [];
    const result = await draw('http://service', ['/render/A.svg', '/render/B.svg'], async (url) => {
      asked.push(url);
      return { status: 200, cache: 'miss', bytes: Buffer.from(url) };
    });
    expect(asked).toEqual(['http://service/render/A.svg', 'http://service/render/B.svg']);
    expect(result.map((item) => item.previous)).toEqual([undefined, '/render/A.svg']);
  });

  it('keeps going past a request that never answers, as status 0', async () => {
    const result = await draw('http://service', ['/render/A.svg', '/render/B.svg'], async (url) => {
      if (url.endsWith('A.svg')) throw new Error('timed out');
      return { status: 200, cache: 'miss', bytes: Buffer.from('b') };
    });
    expect(result.map((item) => item.status)).toEqual([0, 200]);
  });
});

describe('one figure, however it is written', () => {
  it('is one request: order, encoding and dark=false do not make another', () => {
    expect(canonical('/render/X.svg?token=T&dark=true')).toBe(
      canonical('/render/X.svg?dark=true&token=T')
    );
    expect(canonical('/render/X.svg?highlight=a,b')).toBe(
      canonical('/render/X.svg?highlight=a%2Cb')
    );
    expect(canonical('/render/X.svg?dark=false')).toBe(canonical('/render/X.svg'));
    expect(canonical('/render/X.svg?dark=true')).not.toBe(canonical('/render/X.svg'));
  });

  it('is drawn once from the sample', () => {
    expect(parseSample('/render/X.svg?a=1&b=2\n/render/X.svg?b=2&a=1\n')).toEqual([
      '/render/X.svg?a=1&b=2',
    ]);
  });

  it('is asked at most once in a run, though opposites re-encode it', () => {
    const sample = ['/render/X.svg?highlight=a,b&dark=true', '/render/X.svg?highlight=a,b'];
    for (const requests of Object.values(orders(sample)))
      expect(new Set(requests.map(canonical)).size).toBe(requests.length);
  });
});

describe('a reused run', () => {
  it('drew every figure after the first on a held page', () => {
    expect(heldProblem(9, 10)).toBeUndefined();
  });

  it('is no test when a page was replaced part-way, or reuse was never counted', () => {
    expect(heldProblem(7, 10)).toBe('2 of 10 draws were not on a held page (/health reused 7)');
    expect(heldProblem(undefined, 10)).toMatch(/9 of 10 draws/);
  });
});
