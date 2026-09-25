import { describe, expect, it } from 'vitest';
import {
  allNonImages,
  brokenLinks,
  nonImages,
  internalPath,
  linksInContent,
  linksInTemplate,
  resolves,
  routePatterns,
} from './check-links';

const pages = new Set(['/about/what-is-reactome', '/documentation/userguide']);
const routes = [/^\/content\/detail\/[^/]+$/];
const noFiles = () => false;

describe('which links are internal', () => {
  it('treats reactome.org as this site, as the page renderer does', () => {
    expect(internalPath('https://reactome.org/what-is-reactome')).toBe('/what-is-reactome');
    expect(internalPath('https://www.reactome.org/')).toBe('/');
  });

  it('resolves a path without a leading slash from the root', () => {
    expect(internalPath('about/license')).toBe('/about/license');
  });

  it('ignores other hosts, anchors, mail links and query strings', () => {
    expect(internalPath('https://download.reactome.org/97/x.tgz')).toBeNull();
    expect(internalPath('#top')).toBeNull();
    expect(internalPath('mailto:help@reactome.org')).toBeNull();
    expect(internalPath('/documentation/userguide?x=1#y')).toBe('/documentation/userguide');
  });
});

describe('whether a link leads somewhere', () => {
  it('accepts a content page, a router path and a service path', () => {
    expect(resolves('/about/what-is-reactome', pages, routes, noFiles)).toBe(true);
    expect(resolves('/content/detail/R-HSA-109581', pages, routes, noFiles)).toBe(true);
    expect(resolves('/PathwayBrowser/R-HSA-109581', pages, routes, noFiles)).toBe(true);
    expect(resolves('/ContentService/data/database/version', pages, routes, noFiles)).toBe(true);
  });

  it('rejects the old paths that answered 200 with the not-found page', () => {
    expect(resolves('/what-is-reactome', pages, routes, noFiles)).toBe(false);
    expect(resolves('/community/training', pages, routes, noFiles)).toBe(false);
  });

  it('accepts a static file only if it is there', () => {
    expect(resolves('/uploads/x.png', pages, routes, (p) => p === '/uploads/x.png')).toBe(true);
    expect(resolves('/uploads/y.png', pages, routes, (p) => p === '/uploads/x.png')).toBe(false);
  });
});

describe('finding links', () => {
  it('reads markdown links in both spellings, and HTML attributes', () => {
    const text = 'a [one](</x>) b [two](/y)\n<a href="/z">three</a> <img src="/w.png">';
    expect(linksInContent('f.mdx', text).map((l) => [l.url, l.line])).toEqual([
      ['/x', 1],
      ['/y', 1],
      ['/z', 2],
      ['/w.png', 2],
    ]);
  });

  it('reads literal template links and skips bound ones', () => {
    const html =
      '<a href="/a">x</a> <a [href]="b">y</a> <a routerLink="/c">z</a> <a href="{{ d }}">w</a>';
    expect(linksInTemplate('t.html', html).map((l) => l.url)).toEqual(['/a', '/c']);
  });
});

describe('image sources', () => {
  it('flags an image whose source is a web page', () => {
    // As imported: the preprint's page, beside the figure that belongs there.
    const text =
      '![](https://www.biorxiv.org/content/10.64898/2025.12.12.693752v1)' +
      '![F1](/uploads/a/F1.large.jpg)\n<img src="https://example.org/logo.png?v=2">';
    expect(nonImages('f.mdx', text).map((i) => i.url)).toEqual([
      'https://www.biorxiv.org/content/10.64898/2025.12.12.693752v1',
    ]);
  });
});

describe('the site as it stands', () => {
  it('has no image source that is not an image', () => {
    expect(allNonImages().map((i) => `${i.file}:${i.line} ${i.url}`)).toEqual([]);
  });

  it('parses the real router', () => {
    expect(routePatterns().length).toBeGreaterThan(20);
  });

  it('has no broken internal link beyond those listed as waiting', async () => {
    const { KNOWN_BROKEN } = await import('./check-links');
    const unexplained = brokenLinks().filter((b) => !(b.path in KNOWN_BROKEN));
    expect(unexplained.map((b) => `${b.file}:${b.line} ${b.url}`)).toEqual([]);
  });
});
