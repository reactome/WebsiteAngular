import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { SchemaComponent } from './schema.component';

// The data-schema page draws instance counts from two snapshots of the same
// curation database taken at different instants: the bulk /schema/model tree,
// and the live per-class /schema/{class}/count. Against the curator backend
// these genuinely disagree -- 34 of 108 classes differed when this was written,
// by between -8 and +610 -- because curators write to that database all day.
// (On the public site the database is frozen between releases, both agree, and
// none of this is visible, which is why it only ever reproduced on curator.)
//
// Showing both at once put two different numbers for the same class on screen
// side by side -- the sidebar bracket from the snapshot, the header from the
// live call. So the live figure is folded back into the tree. Counts are
// subclass-inclusive, so a class's drift is also its ancestors' drift and
// nobody else's: pushing the delta up the parent chain reconciles the bracket
// with the header while keeping parent >= own + children. These tests pin that.
describe('SchemaComponent instance counts', () => {
  let httpTesting: HttpTestingController;

  // A three-level slice of the real model, with each parent's count including
  // its descendants', matching the subclass-inclusive counts the server
  // returns. Event's margin over Pathway is deliberately narrow so that a
  // correction applied to the child alone would invert the two.
  const MODEL = {
    className: 'DatabaseObject',
    count: 1218707,
    children: [
      {
        className: 'Event',
        count: 37299,
        children: [{ className: 'Pathway', count: 37299, children: [] }],
      },
      { className: 'PhysicalEntity', count: 120685, children: [] },
    ],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        // Constructed directly rather than via createComponent, following the
        // pattern in search.component.spec.ts: these tests exercise the count
        // bookkeeping, not the rendering, so there is no host view and hence
        // no node-level ChangeDetectorRef to inject.
        {
          provide: ChangeDetectorRef,
          useValue: { markForCheck: () => {}, detectChanges: () => {} },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            params: of({}),
            snapshot: { queryParamMap: { get: () => null } },
          },
        },
      ],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    try {
      httpTesting.verify({ ignoreCancelled: true });
    } finally {
      // Must run even when verify throws, or the failure cascades into every
      // later test as "test module has already been instantiated".
      TestBed.resetTestingModule();
    }
  });

  // Flush everything currently in flight: counts with `count`, list-shaped
  // endpoints (attributes, referrals, entries) with an empty array.
  function drainPending(count: number) {
    httpTesting
      .match(() => true)
      .forEach((req) => {
        if (req.request.url.endsWith('/count')) req.flush(count);
        else req.flush([]);
      });
  }

  function setup() {
    const component = TestBed.runInInjectionContext(() => new SchemaComponent());
    component.ngOnInit();

    httpTesting.expectOne((r) => r.url.endsWith('/schema/model')).flush(MODEL);
    // The route subscription lives inside that success callback and fires
    // straight away with the default class, so settle DatabaseObject's
    // requests here and let each test start from a quiet state.
    drainPending(MODEL.count);
    return component;
  }

  // Answer whatever the component asked for on selecting `className`, giving
  // the live count a value deliberately different from the model snapshot's.
  function selectAndFlushCount(component: SchemaComponent, className: string, live: number) {
    component.selectClass(className);
    httpTesting
      .match((r) => r.url.includes(`/schema/${className}/`))
      .forEach((req) => {
        if (req.request.url.endsWith('/count')) req.flush(live);
        else req.flush([]);
      });
  }

  it('brings the sidebar bracket onto the live count for the selected class', () => {
    const component = setup();
    expect(component.getNodeCount('DatabaseObject')).toBe(1218707);

    selectAndFlushCount(component, 'DatabaseObject', 1219317);

    // The header and the bracket beside it are the one number, which is the
    // whole point: on curator they used to differ by hundreds.
    expect(component.liveEntryCount).toBe(1219317);
    expect(component.getNodeCount('DatabaseObject')).toBe(1219317);
  });

  it('carries the correction up the ancestors so no child out-counts its parent', () => {
    const component = setup();

    // Pathway and Event start level, so writing 37338 to Pathway alone would
    // leave the child above the parent that is supposed to contain it.
    selectAndFlushCount(component, 'Pathway', 37338);

    expect(component.getNodeCount('Pathway')).toBe(37338);
    expect(component.getNodeCount('Event')).toBe(37338);
    expect(component.getNodeCount('DatabaseObject')).toBe(1218746);
    // The 39 new instances are Pathways; an unrelated branch has not moved.
    expect(component.getNodeCount('PhysicalEntity')).toBe(120685);
  });

  it('leaves the tree alone when the live count matches the snapshot', () => {
    const component = setup();

    selectAndFlushCount(component, 'Event', 37299);

    expect(component.getNodeCount('Event')).toBe(37299);
    expect(component.getNodeCount('DatabaseObject')).toBe(1218707);
  });

  it('applies a shrinking count, since curators delete as well as add', () => {
    const component = setup();

    // Figure and PathwayDiagram both came back *lower* than the snapshot on
    // curator, so the correction has to run in both directions.
    selectAndFlushCount(component, 'PhysicalEntity', 120677);

    expect(component.getNodeCount('PhysicalEntity')).toBe(120677);
    expect(component.getNodeCount('DatabaseObject')).toBe(1218699);
  });

  it('reports no count until the live one lands, rather than a stale stand-in', () => {
    const component = setup();
    component.selectClass('Event');

    // The snapshot value is available here, but showing it would mean the
    // header visibly corrects itself from 37299 to 37338 a moment later.
    expect(component.liveEntryCount).toBeNull();
    expect(component.totalPages).toBe(0);

    httpTesting
      .match((r) => r.url.includes('/schema/Event/'))
      .forEach((req) => {
        if (req.request.url.endsWith('/count')) req.flush(37338);
        else req.flush([]);
      });
    expect(component.liveEntryCount).toBe(37338);
  });

  it('drops the previous class count while the next is in flight', () => {
    const component = setup();
    selectAndFlushCount(component, 'Event', 37338);
    expect(component.liveEntryCount).toBe(37338);

    component.selectClass('PhysicalEntity');
    // Event's total must not be shown under PhysicalEntity's heading.
    expect(component.liveEntryCount).toBeNull();

    // The assertion above is about the in-flight window; settle the requests
    // it left open so afterEach's verify() has nothing to complain about.
    drainPending(120741);
    expect(component.liveEntryCount).toBe(120741);
  });

  it('ignores a late count for a class the user has already left', () => {
    const component = setup();
    component.selectClass('Event');
    const stale = httpTesting.expectOne((r) => r.url.endsWith('/schema/Event/count'));
    httpTesting
      .match((r) => r.url.includes('/schema/Event/') && !r.url.endsWith('/count'))
      .forEach((req) => req.flush([]));

    selectAndFlushCount(component, 'PhysicalEntity', 120741);

    // Event's response arrives after the user moved on; it must not overwrite
    // the count now on screen for PhysicalEntity.
    stale.flush(37338);
    expect(component.liveEntryCount).toBe(120741);
  });

  it('falls back to the snapshot when the live count request fails', () => {
    const component = setup();
    component.selectClass('Event');
    httpTesting
      .match((r) => r.url.includes('/schema/Event/'))
      .forEach((req) => {
        if (req.request.url.endsWith('/count')) {
          req.flush('boom', { status: 500, statusText: 'Server Error' });
        } else {
          req.flush([]);
        }
      });

    // Better a slightly old number than a blank, and it agrees with the
    // bracket the sidebar is already showing for this class.
    expect(component.liveEntryCount).toBe(37299);
    expect(component.getNodeCount('Event')).toBe(37299);
  });
});
