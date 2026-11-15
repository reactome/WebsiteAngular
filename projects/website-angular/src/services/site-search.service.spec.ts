import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import type { SiteSearchIndexItem } from '../types/site-search';
import { SiteSearchService } from './site-search.service';

const ITEMS: SiteSearchIndexItem[] = [
  {
    id: 1,
    title: 'Placeholder page',
    category: 'About',
    url: '/about/placeholder',
    body: 'A placeholder body about pathways.',
    excerpt: 'A placeholder excerpt.',
    date: '2026-01-02',
  },
  {
    id: 2,
    title: 'Another pathways page',
    category: 'Documentation',
    url: '/documentation/another',
    body: '',
    excerpt: 'Another excerpt.',
  },
];

describe('SiteSearchService.search', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it("gives each hit its page's fields and score, a missing body as empty text", async () => {
    TestBed.configureTestingModule({
      providers: [SiteSearchService, provideHttpClient(), provideHttpClientTesting()],
    });
    const service = TestBed.inject(SiteSearchService);
    const answer = firstValueFrom(service.search('pathways'));
    // the second page's body left out, as a page with no text can be
    const { body: _none, ...bodiless } = ITEMS[1] ?? ITEMS[0];
    TestBed.inject(HttpTestingController)
      .expectOne('/site-search-index.json')
      .flush([ITEMS[0], bodiless]);
    const hits = await answer;
    expect(hits.map(({ score, ...page }) => ({ page, scored: score > 0 }))).toEqual(
      expect.arrayContaining([
        { page: ITEMS[0], scored: true },
        { page: { ...ITEMS[1], date: undefined }, scored: true },
      ])
    );
    expect(hits).toHaveLength(2);
  });
});
