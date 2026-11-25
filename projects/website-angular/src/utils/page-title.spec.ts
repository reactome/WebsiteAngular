import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, TitleStrategy } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';
import { pageTitle, ReactomeTitleStrategy } from './page-title';

// Every page was titled "Reactome": every tab, bookmark and search result read the same.
describe("a page's title", () => {
  it('names what is on show, most specific first, then the site', () => {
    expect(pageTitle('Apoptosis (R-HSA-109581)')).toBe('Apoptosis (R-HSA-109581) · Reactome');
    expect(pageTitle('TP53', 'Search')).toBe('TP53 · Search · Reactome');
  });

  it('leaves out what is missing or blank, and is the site alone with nothing', () => {
    expect(pageTitle('', 'Search')).toBe('Search · Reactome');
    expect(pageTitle(undefined, null, '  ')).toBe('Reactome');
    expect(pageTitle('  News  ')).toBe('News · Reactome');
  });
});

// The route's title is set at each navigation; a page that names itself once
// its data arrives (a search, a pathway) keeps its name when the router reuses
// it for a new query or a selection, which is also a navigation. Overwritten,
// a second search read "Search · Reactome" from then on (review of 25 Nov).
describe('the title strategy', () => {
  @Component({ template: '' })
  class Page {}

  async function harness() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'search', title: 'Search', component: Page },
          { path: 'news', title: 'News', component: Page },
        ]),
        { provide: TitleStrategy, useClass: ReactomeTitleStrategy },
      ],
    });
    return { router: await RouterTestingHarness.create(), title: TestBed.inject(Title) };
  }

  it("sets the route's title on arriving at a page", async () => {
    const { router, title } = await harness();
    await router.navigateByUrl('/news');
    expect(title.getTitle()).toBe('News · Reactome');
    await router.navigateByUrl('/search?q=TP53');
    expect(title.getTitle()).toBe('Search · Reactome');
  });

  it('keeps the title a reused page gave itself, when only its query changes', async () => {
    const { router, title } = await harness();
    await router.navigateByUrl('/search?q=TP53');
    title.setTitle(pageTitle('TP53', 'Search'));
    await router.navigateByUrl('/search?q=BRCA1');
    title.setTitle(pageTitle('BRCA1', 'Search'));
    await router.navigateByUrl('/search?q=BRCA1&page=2');
    expect(title.getTitle()).toBe('BRCA1 · Search · Reactome');
    await router.navigateByUrl('/news');
    expect(title.getTitle()).toBe('News · Reactome');
  });
});
