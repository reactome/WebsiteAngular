/**
 * The count beside each resource belongs to one pathway.
 *
 * It outlived the pathway it described. The tally was cleared only inside
 * `rememberResourceCount`, which runs when a count is *stored* -- and nothing was
 * ever stored while the cache was full, because `prefetchResourceCounts` skips
 * any resource it already has an answer for. Full cache, so no fetch; no fetch,
 * so no store; no store, so no clear. Opening a second pathway kept the first
 * one's numbers.
 *
 * Tested here rather than end to end because the bug is a cache decision, not a
 * rendering one: a browser test of it passed both with and without the fix, which
 * makes it worse than no test at all.
 *
 * `prefetchResourceCounts(cy, [])` is the seam -- an empty resource list runs the
 * pathway check and nothing else, so neither HttpClient nor cytoscape is touched.
 */
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { beforeEach, describe, expect, it } from 'vitest';
import cytoscape from 'cytoscape';

import { InteractorService } from './interactor.service';
import { DiagramService } from '../../services/diagram.service';
import { UrlStateService } from '../../services/url-state.service';

describe('the tally beside each resource', () => {
  const pathwayId = signal<string | undefined>(undefined);
  let service: InteractorService;

  beforeEach(() => {
    pathwayId.set(undefined);
    TestBed.configureTestingModule({
      providers: [
        InteractorService,
        { provide: HttpClient, useValue: {} },
        { provide: DiagramService, useValue: {} },
        { provide: UrlStateService, useValue: { pathwayId } },
      ],
    });
    service = TestBed.inject(InteractorService);
  });

  /** No resources, so only the pathway check runs. */
  const arriveAt = (pathway: string) => {
    pathwayId.set(pathway);
    service.prefetchResourceCounts({} as cytoscape.Core, []);
  };

  it('is forgotten when the pathway changes', () => {
    arriveAt('R-HSA-1368108');
    service.resourceCounts.set({ IntAct: { interactions: 193, entities: 40 } });

    arriveAt('R-HSA-109606');

    expect(service.resourceCounts(), "the previous pathway's numbers were still on screen").toEqual(
      {}
    );
  });

  it('is kept while the pathway is the same', () => {
    arriveAt('R-HSA-1368108');
    const tally = { IntAct: { interactions: 193, entities: 40 } };
    service.resourceCounts.set(tally);

    arriveAt('R-HSA-1368108');

    expect(service.resourceCounts(), 're-asking the same pathway threw the answer away').toEqual(
      tally
    );
  });
});
