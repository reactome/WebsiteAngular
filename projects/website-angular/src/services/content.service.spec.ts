import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { ContentService } from './content.service';

describe('ContentService.getPage', () => {
  let service: ContentService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ContentService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  function request() {
    const page = firstValueFrom(service.getPage('overlays', 'disgenet'));
    return { page, req: httpTesting.expectOne((r) => r.url.endsWith('/overlays/disgenet.json')) };
  }

  it('returns the page when the content file exists', async () => {
    const { page, req } = request();
    req.flush({ title: 'DisGeNET overlay', body: '# hello' });
    await expect(page).resolves.toMatchObject({ title: 'DisGeNET overlay', body: '# hello' });
  });

  it('reports a missing page as null when the server answers 404', async () => {
    const { page, req } = request();
    req.flush('nope', { status: 404, statusText: 'Not Found' });
    await expect(page).resolves.toBeNull();
  });

  // The deployed site answers unknown paths with index.html and status 200
  // rather than 404, so a missing content file arrives as HTML that HttpClient
  // cannot parse as JSON. That has to read as "no such page", not as an error,
  // or every unmigrated URL shows the reader a server fault.
  it('reports a missing page as null when the SPA fallback serves HTML', async () => {
    const { page, req } = request();
    req.flush('<!doctype html><html></html>', {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'text/html' },
    });
    await expect(page).resolves.toBeNull();
  });
});

// A missing article is null, as a missing page is; a failed one is not, or the
// article page shows a reader an article with nothing in it.
describe('ContentService.getArticle', () => {
  let service: ContentService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ContentService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  function request() {
    const article = firstValueFrom(service.getArticle('about/news', '98-version-63-released'));
    return {
      article,
      req: httpTesting.expectOne((r) => r.url.endsWith('/about/news/98-version-63-released.json')),
    };
  }

  it('returns the article when the content file exists', async () => {
    const { article, req } = request();
    req.flush({ title: 'Version 63 Released', date: '2017-12-18', body: 'Out now.' });
    await expect(article).resolves.toMatchObject({
      title: 'Version 63 Released',
      body: 'Out now.',
    });
  });

  it('reports a missing article as null when the server answers 404', async () => {
    const { article, req } = request();
    req.flush('nope', { status: 404, statusText: 'Not Found' });
    await expect(article).resolves.toBeNull();
  });

  it('reports a missing article as null when the SPA fallback serves HTML', async () => {
    const { article, req } = request();
    req.flush('<!doctype html><html></html>', {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'text/html' },
    });
    await expect(article).resolves.toBeNull();
  });

  it('fails when the article could not be loaded, rather than reporting it missing', async () => {
    const { article, req } = request();
    req.flush('down', { status: 500, statusText: 'Server Error' });
    await expect(article).rejects.toMatchObject({ status: 500 });
  });
});

// The FAQ index always ships with the site: without it there is nothing to
// show, so every way of not getting it is a failure the page reports.
describe('ContentService.getFaqIndex', () => {
  let service: ContentService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ContentService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  function request() {
    const index = firstValueFrom(service.getFaqIndex());
    return {
      index,
      req: httpTesting.expectOne((r) => r.url.endsWith('/documentation/faq/index.json')),
    };
  }

  it('returns the index', async () => {
    const { index, req } = request();
    req.flush({ general: { articles: [] } });
    await expect(index).resolves.toEqual({ general: { articles: [] } });
  });

  for (const [name, flush] of [
    ['a server error', (req) => req.flush('down', { status: 500, statusText: 'Server Error' })],
    ['a 404', (req) => req.flush('nope', { status: 404, statusText: 'Not Found' })],
    [
      // HttpClient fails to parse it as JSON: an error with status 200.
      'the HTML the site serves in its place',
      (req) => req.error(new ProgressEvent('error'), { status: 200, statusText: 'OK' }),
    ],
  ] as [string, (req: ReturnType<HttpTestingController['expectOne']>) => void][]) {
    it(`fails on ${name}`, async () => {
      const { index, req } = request();
      flush(req);
      await expect(index).rejects.toBeDefined();
    });
  }
});

describe('ContentService asks the server, not a saved copy', () => {
  // A content file keeps its name when it is edited. Served for a while as
  // cacheable for a year, a rewritten documentation page stayed old in every
  // browser that had seen it -- and a hard reload does not refetch what the
  // page's code asks for after it loads. no-cache has the browser check back
  // (a 304 when nothing changed), whatever the copy it holds says.
  let service: ContentService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ContentService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  const calls: [string, (s: ContentService) => unknown, string][] = [
    ['getPage', (s) => s.getPage('documentation', 'cite'), '/documentation/cite.json'],
    ['getArticle', (s) => s.getArticle('about/news', 'x'), '/about/news/x.json'],
    [
      'getArticleIndexItem',
      (s) => s.getArticleIndexItem('about/news', 'x'),
      '/about/news/index.json',
    ],
    ['getAllArticles', (s) => s.getAllArticles('about/news'), '/about/news/index.json'],
    ['getLatestArticles', (s) => s.getLatestArticles('about/news'), '/about/news/index.json'],
    ['getFaqIndex', (s) => s.getFaqIndex(), '/documentation/faq/index.json'],
  ];

  for (const [name, call, file] of calls) {
    it(`${name} revalidates`, () => {
      const subscription = (call(service) as { subscribe(): { unsubscribe(): void } }).subscribe();
      const req = httpTesting.expectOne((r) => r.url.endsWith(file));
      expect(req.request.cache).toBe('no-cache');
      // An article index is a list; every other content file is an object.
      req.flush(file.endsWith('/index.json') && name !== 'getFaqIndex' ? [] : {});
      subscription.unsubscribe();
    });
  }
});
