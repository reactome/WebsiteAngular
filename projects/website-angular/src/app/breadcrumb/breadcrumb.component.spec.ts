import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, UrlSegment } from '@angular/router';
import { Subject } from 'rxjs';
import { BreadcrumbComponent } from './breadcrumb.component';
import { NavOptionsService } from '../../services/nav-options.service';
import { ContentService } from '../../services/content.service';
import { NavOption } from '../../types/link';

const url = (path: string) => path.split('/').map((part) => new UrlSegment(part, {}));

describe('BreadcrumbComponent', () => {
  let component: BreadcrumbComponent;
  let http: HttpTestingController;
  let segments: Subject<UrlSegment[]>;
  const navOptions = signal<Record<string, NavOption>>({});

  beforeEach(() => {
    vi.useFakeTimers();
    navOptions.set({});
    segments = new Subject();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // Constructed directly, with no host view: see search.component.spec.ts.
        {
          provide: ChangeDetectorRef,
          useValue: { markForCheck: () => {}, detectChanges: () => {} },
        },
        { provide: ActivatedRoute, useValue: { url: segments } },
        { provide: NavOptionsService, useValue: { navOptions } },
        { provide: ContentService, useValue: {} },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    component = TestBed.runInInjectionContext(() => new BreadcrumbComponent());
    component.ngOnInit();
  });

  afterEach(() => vi.useRealTimers());

  const person = (id: string) =>
    http.expectOne((request) => request.url.endsWith(`/data/person/${id}`));

  it("names the contributor once the site's navigation has loaded", () => {
    segments.next(url('content/detail/person/69596'));
    person('69596').flush({ displayName: 'Hoffmann, I' });
    navOptions.set({ about: { label: 'About', link: '/about' } as NavOption });
    vi.advanceTimersByTime(100);
    expect(component.breadcrumbs.map((crumb) => crumb.label)).toEqual(['Search', 'Hoffmann, I']);
  });

  it('leaves out a contributor navigated away from before it was named', () => {
    // Both wait for the site's navigation; only the one now shown is added.
    segments.next(url('content/detail/person/141896'));
    segments.next(url('content/detail/person/69596'));
    navOptions.set({ about: { label: 'About', link: '/about' } as NavOption });
    person('69596').flush({ displayName: 'Hoffmann, I' });
    person('141896').flush({ displayName: 'Wang, X' });
    vi.advanceTimersByTime(100);
    expect(component.breadcrumbs).toEqual([
      { label: 'Search', link: '/content/query' },
      { label: 'Hoffmann, I', link: '/content/detail/person/69596' },
    ]);
  });
});
