import { linkPath, linkQueryParams } from './link';

describe('linkPath', () => {
  it('strips the query string', () => {
    expect(linkPath('/PathwayBrowser?analysisTab=species')).toBe('/PathwayBrowser');
  });

  it('adds a leading slash when missing', () => {
    expect(linkPath('about')).toBe('/about');
  });

  it('leaves an already-absolute path unchanged', () => {
    expect(linkPath('/about')).toBe('/about');
  });

  it('handles a bare path with no query string', () => {
    expect(linkPath('/PathwayBrowser')).toBe('/PathwayBrowser');
  });
});

describe('linkQueryParams', () => {
  it('parses a single param', () => {
    expect(linkQueryParams('/PathwayBrowser?analysisTab=species')).toEqual({ analysisTab: 'species' });
  });

  it('parses multiple params', () => {
    expect(linkQueryParams('/PathwayBrowser?analysisTab=species&tab=info')).toEqual({
      analysisTab: 'species',
      tab: 'info',
    });
  });

  it('returns an empty object when there is no query string', () => {
    expect(linkQueryParams('/PathwayBrowser')).toEqual({});
  });

  it('decodes URL-encoded values', () => {
    expect(linkQueryParams('/x?label=a%20b')).toEqual({ label: 'a b' });
  });
});
