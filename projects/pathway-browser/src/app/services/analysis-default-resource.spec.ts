import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { AnalysisResource, AnalysisResult } from '../../../../contract/analysis.ts';
import { MemoryState } from '../../../../reactome-diagram-element/src/memory-state';
import { AnalysisService } from './analysis.service';
import { UrlStateService } from './url-state.service';

/** A result holding `resources` besides TOTAL, as the Analysis Service answers it. */
function result(token: string, resources: AnalysisResource[]): AnalysisResult {
  return {
    expression: { columnNames: [] },
    identifiersNotFound: 0,
    pathwaysFound: 0,
    pathways: [],
    resourceSummary: (['TOTAL', ...resources] as const).map((resource) => ({
      resource,
      pathways: 0,
      filtered: 0,
    })),
    speciesSummary: [],
    summary: {
      token,
      type: 'OVERREPRESENTATION',
      text: true,
      projection: true,
      interactors: false,
      includeDisease: true,
    },
  };
}

function setUp() {
  // DarkService reads this first; jsdom has no matchMedia to fall back on.
  localStorage.setItem('is-dark', 'false');
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: UrlStateService, useClass: MemoryState },
    ],
  });
  const analysis = TestBed.inject(AnalysisService);
  const state = TestBed.inject(UrlStateService);
  const http = TestBed.inject(HttpTestingController);
  // Reading the result is what starts its load, as a view does; the load and
  // the effects after it take a few turns.
  const settle = async () => {
    for (let turn = 0; turn < 4; turn++) {
      analysis.result();
      TestBed.tick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  const answer = async (token: string, resources: AnalysisResource[]) => {
    await settle();
    for (const request of http.match((r) => r.url.endsWith(`/token/${token}`)))
      request.flush(result(token, resources));
    await settle();
  };
  return { state, answer, settle };
}

describe('the default resource (spec 018, research R2 audit 6)', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).match(() => true);
    localStorage.removeItem('is-dark');
  });

  it("is the token's own result's, not the previous token's while the next loads", async () => {
    const { state, answer, settle } = setUp();

    state.analysis.set('UNIPROT-TOKEN');
    await answer('UNIPROT-TOKEN', ['UNIPROT']);
    // The one specific resource is the default: production shows it.
    expect(state.resourceFilter()).toBe('UNIPROT');

    // The next figure: another token, no resource, as its address reads.
    state.analysis.set('TOTAL-TOKEN');
    state.resourceFilter.set(null);
    await settle();
    expect(state.resourceFilter(), 'while TOTAL-TOKEN loads').toBeNull();

    await answer('TOTAL-TOKEN', []);
    expect(state.resourceFilter(), 'once it has loaded').toBeNull();
  });

  it('is still chosen when the next token holds one', async () => {
    const { state, answer } = setUp();
    state.analysis.set('TOTAL-TOKEN');
    await answer('TOTAL-TOKEN', []);
    expect(state.resourceFilter()).toBeNull();

    state.analysis.set('UNIPROT-TOKEN');
    await answer('UNIPROT-TOKEN', ['UNIPROT']);
    expect(state.resourceFilter()).toBe('UNIPROT');
  });
});
