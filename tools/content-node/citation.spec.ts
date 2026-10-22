// @vitest-environment node
//
// /citation/pathway/{id}, /citation/static/{id} and /citation/export -- the
// Pathway Browser's "cite this" -- with stand-ins for the graph and Europe
// PMC: content-service's EventCitation and StaticCitation, as Java writes
// them. Java's answers measured 17 Oct 2026. Names here are invented.
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import {
  citationOfEvent,
  formatEventCitation,
  formatStaticCitation,
  staticCitationFrom,
} from './citation.ts';
import type { Citation } from './citation.ts';

const event = (overrides = {}) => ({
  id: 'R-HSA-1',
  title: 'A pathway',
  year: '2019',
  month: 'Jun',
  doi: null,
  urls: ['https://reactome.org/content/detail/R-HSA-1'],
  release: '97',
  authors: [
    { lastName: 'Doe', initials: 'J.A.', firstName: 'Jane' },
    { lastName: 'Roe', initials: 'R.', firstName: 'Richard' },
  ],
  ...overrides,
});

describe('EventCitation', () => {
  it('writes the text citation: authors by initials, year, title, release, urls, date', () => {
    expect(formatEventCitation(event(), 'txt', 'Fri Oct 17 2026')).toBe(
      'Pathway Citation: Doe, J.A. & Roe, R. (2019). A pathway. Reactome, 97, https://reactome.org/content/detail/R-HSA-1 (Fri Oct 17 2026)\n' +
        'Image Citation: Image Citation for A pathway. Reactome, 97, https://reactome.org/content/detail/R-HSA-1 (Fri Oct 17 2026)'
    );
  });

  it('joins three or more authors as Java does, " ," then " & "', () => {
    const three = event({
      authors: [
        { lastName: 'A', initials: 'A.', firstName: 'x' },
        { lastName: 'B', initials: 'B.', firstName: 'y' },
        { lastName: 'C', initials: 'C.', firstName: 'z' },
      ],
    });
    expect(formatEventCitation(three, 'txt', 'd')).toMatch(
      /^Pathway Citation: A, A. ,B, B. & C, C. \(2019\)/
    );
  });

  it('writes BibTeX and RIS, first names over initials, DOI when there is one', () => {
    const withDoi = event({ doi: '10.3180/R-HSA-1', urls: ['https://doi.org/10.3180/R-HSA-1'] });
    expect(formatEventCitation(withDoi, 'bib', 'd')).toBe(
      '@misc{R-HSA-1,\nTitle = {A pathway},\nAuthor = {Doe, Jane and Roe, Richard},\nYear = {2019},\nMonth = {Jun},\n' +
        'DOI = {10.3180/R-HSA-1},\nURL = {https://doi.org/10.3180/R-HSA-1},\nNote = {Provided by Reactome. Citation Accessed on d},\n}'
    );
    expect(formatEventCitation(withDoi, 'ris', 'd')).toBe(
      'Provided by Reactome. Citation Accessed on d\n\nTY  - ELEC\nTI  - A pathway\nAU  - Doe, Jane\nAU  - Roe, Richard\n' +
        'AN  - R-HSA-1\nDO  - 10.3180/R-HSA-1\nUR  - https://doi.org/10.3180/R-HSA-1\nPY  - 2019\nDA  - 2019/Jun//\nER  - \n'
    );
  });

  it('writes a missing name as Java concatenates it, "null"', () => {
    const nameless = event({ authors: [{ lastName: 'Doe', initials: 'J.', firstName: null }] });
    expect(formatEventCitation(nameless, 'bib', 'd')).toMatch(/Author = \{Doe, null\}/);
    const collective = staticCitationFrom({
      resultList: {
        result: [{ ...europePmc, authorList: { author: [{ collectiveName: 'A consortium' }] } }],
      },
    });
    expect(formatStaticCitation(collective, 'ris', 'd')).toMatch(/AU {2}- null, null\n/);
    expect(formatStaticCitation(collective, 'txt', null)).toMatch(/^null\. A paper\./);
  });

  it('is The Reactome Consortium when nobody is named', () => {
    expect(formatEventCitation(event({ authors: null }), 'bib', 'd')).toMatch(
      /Author = \{The Reactome Consortium\}/
    );
  });
});

const europePmc = {
  id: '12345',
  title: 'A paper.',
  pageInfo: '1-9',
  pmid: '12345',
  journalInfo: {
    issue: '3',
    volume: '7',
    yearOfPublication: 2020,
    monthOfPublication: 11,
    journal: { title: 'A Journal', issn: '1234-5678' },
  },
  doi: '10.1/x',
  authorList: { author: [{ fullName: 'Doe J', lastName: 'Doe', initials: 'J' }] },
};

/** An edit (InstanceEdit) as mapResult gives it: its authors by initial. */
interface Edit {
  fields: { author: { properties: { surname: string; initial: unknown; firstname: string } }[] };
}

/** What a test changes of an event: its date, its DOI, its edits. */
interface EventParts {
  releaseDate?: string | null;
  doi?: string;
  authored?: Edit[];
  created?: Edit;
  reviewed?: Edit[];
}

/** An event as mapResult gives it, with people by initial. */
const mapped = ({ releaseDate = '2019-06-14', doi, ...fields }: EventParts = {}) => ({
  properties: {
    displayName: 'A pathway' as string | null,
    releaseDate,
    ...(doi === undefined ? {} : { doi }),
  },
  fields,
});
const edit = (...initials: unknown[]): Edit => ({
  fields: {
    author: initials.map((initial, i) => ({
      properties: { surname: `S${i}`, initial, firstname: `F${i}` },
    })),
  },
});

describe('citationOfEvent', () => {
  it('takes the year, the month from the wrong character of the date, the page, the release', () => {
    // 2019-06-14: Java's substring(6, 7) is "6", June -- and 2019-11-01's is "1".
    expect(citationOfEvent(mapped(), 'R-HSA-1', '97', false)).toEqual({
      id: 'R-HSA-1',
      title: 'A pathway',
      year: '2019',
      month: 'Jun',
      doi: null,
      urls: ['https://reactome.org/content/detail/R-HSA-1'],
      authors: null,
      release: '97',
    });
    expect(citationOfEvent(mapped({ releaseDate: '2019-11-01' }), 'x', '97', false).month).toBe(
      'Jan'
    );
    expect(citationOfEvent(mapped({ releaseDate: '2019-10-01' }), 'x', '97', false).month).toBe(
      null
    );
  });

  it("links a pathway's DOI, not a reaction's, nor an empty one", () => {
    const withDoi = mapped({ doi: '10.1/p' });
    expect(citationOfEvent(withDoi, 'x', '97', true)).toMatchObject({
      doi: '10.1/p',
      urls: ['https://doi.org/10.1/p'],
    });
    expect(citationOfEvent(withDoi, 'x', '97', false)).toMatchObject({
      doi: null,
      urls: ['https://reactome.org/content/detail/x'],
    });
    expect(citationOfEvent(mapped({ doi: '' }), 'x', '97', true).doi).toBe(null);
  });

  it('names the authors, else the creator, else the reviewers; initials dotted', () => {
    const names = (fields: EventParts) =>
      citationOfEvent(mapped(fields), 'x', '97', false).authors?.map((a) => a.initials);
    const all = { authored: [edit('JA')], created: edit('C'), reviewed: [edit('R')] };
    expect(names(all)).toEqual(['J.A.']);
    expect(names({ ...all, authored: [] })).toEqual(['C.']);
    expect(names({ reviewed: [edit('R', 'QZ')] })).toEqual(['R.', 'Q.Z.']);
    expect(names({ authored: [], reviewed: [] })).toBe(undefined);
    expect(citationOfEvent(mapped({ authored: [edit('A')] }), 'x', '97', false).authors).toEqual([
      { lastName: 'S0', initials: 'A.', firstName: 'F0' },
    ]);
  });

  it("throws as Java's NullPointerException does: no release date, a person with no initial", () => {
    for (const fields of [{ releaseDate: null }, { authored: [edit(null)] }])
      expect(() => citationOfEvent(mapped(fields), 'x', '97', false)).toThrow(
        expect.objectContaining({ unexpected: true })
      );
  });

  it("throws Java's own message for a short or non-numeric date, or no name", () => {
    const failure = (event: ReturnType<typeof mapped>) => {
      try {
        citationOfEvent(event, 'x', '97', false);
      } catch (thrown) {
        const { unexpected, javaMessage } = thrown as {
          unexpected?: boolean;
          javaMessage?: string;
        };
        return [unexpected, javaMessage];
      }
      return undefined;
    };
    expect(failure(mapped({ releaseDate: '2019-0' }))).toEqual([
      undefined,
      'begin 6, end 7, length 6',
    ]);
    expect(failure(mapped({ releaseDate: '201' }))).toEqual([
      undefined,
      'begin 0, end 4, length 3',
    ]);
    expect(failure(mapped({ releaseDate: '2019-0x-01' }))).toEqual([
      undefined,
      'For input string: "x"',
    ]);
    const unnamed = mapped();
    unnamed.properties.displayName = null;
    expect(failure(unnamed)).toEqual([undefined, 'Title or id can not be null']);
  });
});

describe('StaticCitation', () => {
  it("reads Europe PMC's first result as Java does, and writes text, BibTeX and RIS", () => {
    const citation = staticCitationFrom({ resultList: { result: [europePmc] } });
    expect(formatStaticCitation(citation, 'txt', null)).toBe(
      'Doe J. A paper. A Journal. 2020 Nov;7(3) 1-9. doi: 10.1/x. PubMed PMID: 12345. '
    );
    expect(formatStaticCitation(citation, 'bib', 'd')).toBe(
      '@article{12345,\nTitle = {A paper.},\nAuthor = {Doe, J},\nJournal = {A Journal},\nNumber = {3},\nVolume = {7},\n' +
        'ISSN = {1234-5678},\nPages = {1-9},\nYear = {2020},\nMonth = {Nov},\nDOI = {10.1/x},\nURL = {https://doi.org/10.1/x},\n' +
        'Note = {Provided by Reactome. Citation Accessed on d},\n}'
    );
    expect(formatStaticCitation(citation, 'ris', 'd')).toMatch(
      /TY {2}- JOUR\n[\s\S]*JO {2}- A Journal\nIS {2}- 3\nVL {2}- 7\nSN {2}- 1234-5678\nSP {2}- 1-9\nER {2}- \n$/
    );
  });

  it('reads a map and a list as Java prints them, and treats what Java cannot read as no citation', () => {
    const one = (changes) =>
      staticCitationFrom({ resultList: { result: [{ ...europePmc, ...changes }] } });
    expect(one({ pageInfo: { a: 1, b: [2, null] } }).pages).toBe('{a=1, b=[2, null]}');
    expect(one({ journalInfo: null }).year).toBe(undefined);
    expect(one({ authorList: { author: null } }).authors).toBe(null);
    for (const changes of [
      { pmcid: null },
      { journalInfo: 'x' },
      { journalInfo: { journal: [1] } },
      { journalInfo: { monthOfPublication: 2147483648 } },
      { authorList: null },
      { authorList: { author: 'x' } },
    ])
      expect(() => one(changes)).toThrow();
    expect(one({ journalInfo: { monthOfPublication: 2147483647 } }).month).toBe(null);
  });

  it("casts the authors as Java's formatters do, outside its try", () => {
    const failure = (authors: unknown, ext: string) => {
      try {
        // Unchecked, as staticCitationFrom leaves them.
        formatStaticCitation(
          { ...event(), authors: authors as NonNullable<Citation['authors']> },
          ext,
          'd'
        );
      } catch (thrown) {
        const { unexpected, javaMessage } = thrown as {
          unexpected?: boolean;
          javaMessage?: string;
        };
        return unexpected ? 'NPE' : javaMessage;
      }
      return undefined;
    };
    const cce = (from, to) =>
      `class ${from} cannot be cast to class ${to} (${from} and ${to} are in module java.base of loader 'bootstrap')`;
    expect(failure(['x'], 'txt')).toBe(cce('java.lang.String', 'java.util.Map'));
    expect(failure([[1]], 'bib')).toBe(cce('java.util.ArrayList', 'java.util.Map'));
    expect(failure([null], 'ris')).toBe('NPE');
    expect(failure([{ lastName: 5 }], 'bib')).toBe(cce('java.lang.Integer', 'java.lang.String'));
    expect(failure([{ lastName: 'a', firstName: true }], 'ris')).toBe(
      cce('java.lang.Boolean', 'java.lang.String')
    );
    // By full name too, to String, one author at a time: the first misfit wins.
    expect(failure([{ fullName: 2 ** 40 }, null], 'txt')).toBe(
      cce('java.lang.Long', 'java.lang.String')
    );
    expect(failure([null, { fullName: 5 }], 'txt')).toBe('NPE');
    expect(failure([{ fullName: 5 }, 'x'], 'txt')).toBe(
      cce('java.lang.Integer', 'java.lang.String')
    );
    // Only the names a format reads are cast.
    expect(failure([{ fullName: 'A B', lastName: 5 }], 'txt')).toBe(undefined);
    expect(failure([{ lastName: 'a', initials: 'b', fullName: 5 }], 'bib')).toBe(undefined);
  });
});

vi.mock('./graph.ts', async () => ({
  read: async (cypher, params) => {
    // The release as the service reads it: releaseNumber, not another property.
    if (cypher === 'MATCH (n:DBInfo) RETURN n.releaseNumber AS version LIMIT 1')
      return [{ version: 97 }];
    const shared = globalThis as { graphAsked?: unknown; graphRows?: unknown[] };
    shared.graphAsked = params;
    return shared.graphRows ?? [];
  },
  configured: () => true,
  close: async () => {},
  envSetting: (key, fallback = '') => process.env[key] || fallback,
}));

/** What the stand-in graph answers, and what it was last asked. */
const graph = globalThis as { graphAsked?: unknown; graphRows?: unknown[] };

describe('the citation endpoints', () => {
  let base: string;
  let server: Server;
  let pmc: Server;
  let pmcAsked: (string | undefined)[] = [];

  beforeAll(async () => {
    const { createServer } = await import('node:http');
    pmc = createServer((request, response) => {
      pmcAsked.push(request.url);
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify(
          (globalThis as { pmcAnswer?: unknown }).pmcAnswer ?? {
            resultList: { result: [europePmc] },
          }
        )
      );
    });
    await new Promise<void>((resolve) => pmc.listen(0, '127.0.0.1', resolve));
    process.env['EUROPE_PMC_URL'] =
      `http://127.0.0.1:${(pmc.address() as AddressInfo).port}/search`;
    const { app } = await import('./server.ts');
    await new Promise<void>((resolve) => {
      server = app().listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    delete process.env['EUROPE_PMC_URL'];
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => pmc.close(resolve));
  });

  it('/static/{id} asks Europe PMC for the PubMed id, and writes the text', async () => {
    pmcAsked = [];
    const response = await fetch(`${base}/ContentService/citation/static/12345`);
    expect([response.status, response.headers.get('content-type')]).toEqual([
      200,
      'text/plain; charset=utf-8',
    ]);
    expect(await response.text()).toMatch(/^Doe J\. A paper\./);
    expect(pmcAsked).toEqual([
      '/search?query=src%3Amed+ext_id%3A12345&format=json&resultType=core',
    ]);
  });

  it('/pathway/{id} is {} for an id that is no event, and export an empty 200', async () => {
    graph.graphRows = [];
    const pathway = await fetch(`${base}/ContentService/citation/pathway/R-HSA-9?dateAccessed=d`);
    expect([pathway.status, await pathway.text()]).toEqual([200, '{}']);
    // The id from the path, not the path's own words.
    expect(graph.graphAsked).toEqual({ id: 'R-HSA-9' });
    const exported = await fetch(
      `${base}/ContentService/citation/export?isPathway=true&id=xyz&ext=bib&dateAccessed=d`
    );
    expect([exported.status, await exported.text(), exported.headers.get('content-type')]).toEqual([
      200,
      '',
      null,
    ]);
  });

  // An event as graph-core's enhanced query loads it, with nothing related.
  const eventRow = (schemaClass: string, labels: string[]) => ({
    root: {
      id: 1,
      labels: ['DatabaseObject', 'Event', ...labels],
      props: {
        dbId: 9,
        stId: 'R-HSA-9',
        displayName: 'An event',
        releaseDate: '2020-06-15',
        doi: '10.3180/R-HSA-9.1',
        schemaClass,
      },
    },
    order: [],
    nodes: [],
    relationships: [],
  });

  it("/pathway/{id} cites the event by the id as given; only a pathway's by its DOI", async () => {
    try {
      graph.graphRows = [eventRow('Pathway', ['Pathway'])];
      const pathway = await (
        await fetch(`${base}/ContentService/citation/pathway/9?dateAccessed=d`)
      ).json();
      // Asked by a versioned stable id, neither its stId nor its dbId: the
      // link names the id as given.
      graph.graphRows = [eventRow('Reaction', ['ReactionLikeEvent', 'Reaction'])];
      const reaction = await (
        await fetch(`${base}/ContentService/citation/pathway/R-HSA-9.1?dateAccessed=d`)
      ).json();
      expect([pathway, reaction]).toEqual([
        {
          imageCitation:
            'Image Citation for An event. Reactome, 97, https://doi.org/10.3180/R-HSA-9.1 (d)',
          pathwayCitation:
            'The Reactome Consortium (2020). An event. Reactome, 97, https://doi.org/10.3180/R-HSA-9.1 (d)',
        },
        {
          imageCitation:
            'Image Citation for An event. Reactome, 97, https://reactome.org/content/detail/R-HSA-9.1 (d)',
          pathwayCitation:
            'The Reactome Consortium (2020). An event. Reactome, 97, https://reactome.org/content/detail/R-HSA-9.1 (d)',
        },
      ]);
    } finally {
      graph.graphRows = [];
    }
  });

  it('export writes each format as its own type and extension', async () => {
    for (const [ext, type, extension] of [
      ['bib', 'application/x-bibtex; charset=utf-8', 'bib'],
      ['ris', 'application/x-research-info-systems; charset=utf-8', 'ris'],
      ['txt', 'text/plain; charset=utf-8', 'txt'],
    ]) {
      const response = await fetch(
        `${base}/ContentService/citation/export?isPathway=false&id=12345&ext=${ext}&dateAccessed=d`
      );
      expect([
        ext,
        response.status,
        response.headers.get('content-type'),
        response.headers.get('content-disposition'),
      ]).toEqual([ext, 200, type, `attachment; filename="reactome_citation_12345.${extension}"`]);
    }
  });

  it('/static/{id} is "unable to fetch" for an answer Java cannot read', async () => {
    globalThis.pmcAnswer = { resultList: { result: [{ ...europePmc, journalInfo: [] }] } };
    try {
      const response = await fetch(`${base}/ContentService/citation/static/12345`);
      expect([response.status, await response.text()]).toEqual([
        500,
        'Unable to fetch static citation',
      ]);
    } finally {
      delete globalThis.pmcAnswer;
    }
  });

  it('export writes the file name as Tomcat writes a header, é as its Latin-1 byte', async () => {
    const url = `${base}/ContentService/citation/export?isPathway=false&id=12345.%E2%82%AC%0D%0Ax%09%7F%C3%A9&ext=bib&dateAccessed=d`;
    // fetch reads a header's bytes as Latin-1, so é here is the byte 0xE9.
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(url, { method });
      expect([method, response.headers.get('content-disposition')]).toEqual([
        method,
        'attachment; filename="reactome_citation_12345.?  x\t é.bib"',
      ]);
    }
    // A 304 -- Express's, for a matching ETag -- ends with no bytes, so Node
    // does not re-read the header. By node:http: fetch adds Cache-Control:
    // no-cache to a conditional request, which Express then never answers 304.
    const etag = (await fetch(url)).headers.get('etag');
    const { get } = await import('node:http');
    const notModified = await new Promise<IncomingMessage>((resolve, reject) =>
      get(url, { headers: { 'If-None-Match': etag ?? '' } }, (response) => {
        response.resume();
        resolve(response);
      }).on('error', reject)
    );
    expect([
      notModified.statusCode,
      notModified.rawHeaders.includes(
        'attachment; filename="reactome_citation_12345.?  x\t é.bib"'
      ),
    ]).toEqual([304, true]);
  });

  it("writes a Latin-1 file name whatever bytes end the response: a HEAD's Buffer, an empty one", async () => {
    const { writeResult } = await import('./server.ts');
    const { default: express } = await import('express');
    const site = express();
    site.all('/:kind', (request, response) => {
      const answer = {
        status: 200,
        type: 'application/octet-stream',
        headers: { 'Content-Disposition': 'attachment; filename="é"' },
        body: request.params.kind === 'empty' ? Buffer.alloc(0) : Buffer.from('x'),
      };
      if (request.params.kind !== 'twice') return writeResult(response, answer);
      // A first answer that fails to serialise, then the error answer, as
      // the service's catch gives it: the header is converted once.
      try {
        writeResult(response, { ...answer, body: { a: 1n } });
      } catch {
        writeResult(response, { status: 500, body: 'failed' });
      }
    });
    const listening = await new Promise<Server>((resolve) => {
      const started = site.listen(0, '127.0.0.1', () => resolve(started));
    });
    try {
      for (const [method, kind] of [
        ['HEAD', 'bytes'],
        ['GET', 'bytes'],
        ['GET', 'empty'],
        ['GET', 'twice'],
      ] as [string, string][]) {
        const response = await fetch(
          `http://127.0.0.1:${(listening.address() as AddressInfo).port}/${kind}`,
          {
            method,
          }
        );
        expect([method, kind, response.headers.get('content-disposition')]).toEqual([
          method,
          kind,
          'attachment; filename="é"',
        ]);
      }
    } finally {
      await new Promise((resolve) => listening.close(resolve));
    }
  });

  it("/static/{id} is GlobalExceptionHandler's 500 for an author Java cannot cast", async () => {
    globalThis.pmcAnswer = {
      resultList: { result: [{ ...europePmc, authorList: { author: ['x'] } }] },
    };
    try {
      const response = await fetch(`${base}/ContentService/citation/static/12345`);
      expect([response.status, (await response.json()).messages]).toEqual([
        500,
        [
          "class java.lang.String cannot be cast to class java.util.Map (java.lang.String and java.util.Map are in module java.base of loader 'bootstrap')",
        ],
      ]);
    } finally {
      delete globalThis.pmcAnswer;
    }
  });

  it("/pathway/{id}'s two citations are in Java's HashMap order, image first", async () => {
    const { pathwayCitations } = await import('./citation-endpoints.ts');
    expect(Object.keys(pathwayCitations(event(), 'd'))).toEqual([
      'imageCitation',
      'pathwayCitation',
    ]);
  });

  it("/pathway/{id} is Java's 500 for an event it cannot cite", async () => {
    // A reaction with no release date: Java's getReleaseDate().substring NPEs.
    graph.graphRows = [
      {
        root: {
          id: 1,
          labels: ['DatabaseObject', 'Event', 'ReactionLikeEvent', 'Reaction'],
          props: { dbId: 9, stId: 'R-HSA-9', displayName: 'A reaction', schemaClass: 'Reaction' },
        },
        nodes: [],
        relationships: [],
      },
    ];
    try {
      const response = await fetch(
        `${base}/ContentService/citation/pathway/R-HSA-9?dateAccessed=d`
      );
      expect([response.status, (await response.json()).messages]).toEqual([
        500,
        ['Something unexpected happened and the error has been reported.'],
      ]);
    } finally {
      graph.graphRows = [];
    }
  });

  it("is Spring's 400 for a missing parameter", async () => {
    const response = await fetch(
      `${base}/ContentService/citation/export?id=x&ext=bib&dateAccessed=d`
    );
    expect((await response.json()).messages).toEqual([
      "Required request parameter 'isPathway' for method parameter type Boolean is not present",
    ]);
  });
});
