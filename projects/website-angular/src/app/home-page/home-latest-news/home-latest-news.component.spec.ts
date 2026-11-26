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
});
