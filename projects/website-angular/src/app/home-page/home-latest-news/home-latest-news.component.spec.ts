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
});
