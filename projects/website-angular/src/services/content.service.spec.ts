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
