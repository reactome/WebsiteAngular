// @vitest-environment node
//
// /citation/pathway/{id}, /citation/static/{id} and /citation/export -- the
// Pathway Browser's "cite this" -- with stand-ins for the graph and Europe
// PMC: content-service's EventCitation and StaticCitation, as Java writes
// them. Java's answers measured 17 Oct 2026. Names here are invented.
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { formatEventCitation, formatStaticCitation, staticCitationFrom } from './citation.mjs';

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
});

vi.mock('./graph.mjs', async () => ({
  read: async (cypher, params) => {
    if (cypher.includes('DBInfo')) return [{ version: 97 }];
    globalThis.graphAsked = params;
    return globalThis.graphRows ?? [];
  },
  configured: () => true,
  close: async () => {},
  envSetting: (key, fallback = '') => process.env[key] || fallback,
}));

describe('the citation endpoints', () => {
  let base;
  let server;
  let pmc;
  let pmcAsked;

  beforeAll(async () => {
    const { createServer } = await import('node:http');
    pmc = createServer((request, response) => {
      pmcAsked.push(request.url);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ resultList: { result: [europePmc] } }));
    });
    await new Promise((resolve) => pmc.listen(0, '127.0.0.1', resolve));
    process.env.EUROPE_PMC_URL = `http://127.0.0.1:${pmc.address().port}/search`;
    const { app } = await import('./service.mjs');
    await new Promise((resolve) => {
      server = app().listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    delete process.env.EUROPE_PMC_URL;
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
    globalThis.graphRows = [];
    const pathway = await fetch(`${base}/ContentService/citation/pathway/R-HSA-9?dateAccessed=d`);
    expect([pathway.status, await pathway.text()]).toEqual([200, '{}']);
    // The id from the path, not the path's own words.
    expect(globalThis.graphAsked).toEqual({ id: 'R-HSA-9' });
    const exported = await fetch(
      `${base}/ContentService/citation/export?isPathway=true&id=xyz&ext=bib&dateAccessed=d`
    );
    expect([exported.status, await exported.text(), exported.headers.get('content-type')]).toEqual([
      200,
      '',
      null,
    ]);
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
