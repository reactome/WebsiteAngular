import { describe, expect, it } from 'vitest';
import {
  ChangeDetectorRef,
  EnvironmentInjector,
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { HomeLatestNewsComponent } from './home-latest-news.component';
import { NavOptionsService } from '../../../services/nav-options.service';
import { ContentService } from '../../../services/content.service';
import articleExcerpt, { EXCERPT_WORDS } from '../../../utils/articleExcerpt';

function component(): HomeLatestNewsComponent {
  const injector = createEnvironmentInjector(
    [
      { provide: NavOptionsService, useValue: { navOptions: signal({}) } },
      { provide: ContentService, useValue: {} },
      { provide: ChangeDetectorRef, useValue: { markForCheck: () => undefined } },
    ],
    null as unknown as EnvironmentInjector
  );
  return runInInjectionContext(injector, () => new HomeLatestNewsComponent());
}

describe('HomeLatestNewsComponent.summaryOf', () => {
  it('prints no tag, even one whose closing bracket it would strip as markdown', () => {
    const summary = component().summaryOf({
      title: 'V98 Released',
      date: new Date(0),
      slug: 'v98',
      tags: [],
      excerpt:
        '## V98 Released\n\nTopics with new or revised pathways in this release include several ...</https>',
    });
    expect(summary).toBe('Topics with new or revised pathways in this release include several ...');
  });

  const summary = (excerpt: string) =>
    component().summaryOf({ title: 'A title', date: new Date(0), slug: 'a', tags: [], excerpt });

  it('shows an address written in angle brackets as the address', () => {
    // As the deprecated RESTful API announcement reads
    expect(
      summary(
        'It is available from our website at <https://reactome.org/ContentService/> and is designed'
      )
    ).toBe(
      'It is available from our website at https://reactome.org/ContentService/ and is designed'
    );
  });

  it('keeps prose with a less-than and a greater-than', () => {
    expect(summary('Pathways enriched at p < 0.05 and q > 1 here')).toBe(
      'Pathways enriched at p < 0.05 and q 1 here'
    );
  });

  it('prints no half of a link the excerpt was cut through', () => {
    // As V77's and V96's excerpts end
    expect(
      summary(
        'Updated pathways include [Maturation of nucleoprotein](</PathwayBrowser/#R-HSA-1>...'
      )
    ).toBe('Updated pathways include Maturation of nucleoprotein ...');
    expect(summary('Updated pathways include Developmental biology ([Differentiation of ...')).toBe(
      'Updated pathways include Developmental biology (Differentiation of ...'
    );
  });

  // #951: the lead item's line is the index's excerpt, which ends in "..." only
  // when it was cut; this keeps that "..." and adds none of its own.
  describe('from the excerpt the news index writes', () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(' ');
    const ofBody = (body: string) => summary(articleExcerpt(body));

    it('ends in no "..." under the word limit', () => {
      expect(ofBody(`## A title\n\n${words(10)}`)).toBe(words(10));
    });

    it('ends in "..." over the word limit', () => {
      expect(ofBody(words(EXCERPT_WORDS + 5))).toBe(`${words(EXCERPT_WORDS)} ...`);
    });

    it('ends in no "..." at exactly the word limit', () => {
      expect(ofBody(words(EXCERPT_WORDS))).toBe(words(EXCERPT_WORDS));
    });

    it('ends in no "..." under the word limit, however long the tags are', () => {
      expect(ofBody(`<p title="${words(EXCERPT_WORDS)}">${words(10)}</p>`)).toBe(words(10));
    });
  });
});
