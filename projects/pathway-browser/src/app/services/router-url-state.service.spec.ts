import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Params, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { UrlStateService } from './url-state.service';
import { RouterUrlStateService } from './router-url-state.service';

@Component({ selector: 'cr-browser', template: '' })
class BrowserStub {}

async function openAt(url: string): Promise<UrlStateService> {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([
        {
          path: 'PathwayBrowser',
          children: [
            { path: '', component: BrowserStub },
            { path: ':pathwayId', component: BrowserStub },
          ],
        },
      ]),
      { provide: UrlStateService, useClass: RouterUrlStateService },
    ],
  });
  const state = TestBed.inject(UrlStateService);
  const harness = await RouterTestingHarness.create();
  // navigateByUrl waits for the app to be stable, by which time the reader has
  // applied these params: none of them needs a lookup.
  await harness.navigateByUrl(url);
  return state;
}

/**
 * The old browser's names for two settings, arriving in the query string.
 *
 * A param under a legacy name was translated and the translation dropped:
 * nothing set it, so `?DTAB=MT` opened the default tab and `?TOOL=AT` an
 * empty browser.
 */
describe('RouterUrlStateService, legacy query parameters', () => {
  it('DTAB opens the tab its old code names', async () => {
    const state = await openAt('/PathwayBrowser/R-HSA-1?DTAB=MT');
    expect(state.tab()).toBe('molecule');
  });

  it('DTAB in a legacy fragment reaches the same place', async () => {
    // The fragment reader moves it into the query string, under its old name.
    const state = await openAt('/PathwayBrowser/#R-HSA-1&DTAB=MT');
    expect(state.tab()).toBe('molecule');
  });

  it('an unknown DTAB code leaves the tab unset, as no tab at all does', async () => {
    // null, not undefined: the details panel settles its Info fallback only on
    // null, and an undefined tab pushed a history entry instead (#168).
    const state = await openAt('/PathwayBrowser/R-HSA-1?DTAB=XX');
    expect(state.tab()).toBeNull();
  });

  it('TOOL=AT opens the analysis tool', async () => {
    const state = await openAt('/PathwayBrowser/?TOOL=AT');
    expect(state.analysisTab()).toBe('qualitative');
  });

  it('the current name is still read as it is', async () => {
    const state = await openAt('/PathwayBrowser/R-HSA-1?tab=results&analysisTab=species');
    expect(state.tab()).toBe('results');
    expect(state.analysisTab()).toBe('species');
  });
});

/**
 * The address read into the state: each param's text parsed by its type, and a
 * param given more than once read as its first value, as `paramMap.get` reads
 * it. A repeated param used to throw part-way through (a list has no `split`),
 * and every param after it in the list kept its old value.
 */
describe('RouterUrlStateService, reading the address', () => {
  it('reads the pathway from the route', async () => {
    const state = await openAt('/PathwayBrowser/R-HSA-1');
    expect(state.pathwayId()).toBe('R-HSA-1');
  });

  it('parses each param by its type', async () => {
    const state = await openAt(
      '/PathwayBrowser/R-HSA-1?select=R-HSA-5&flag=R-HSA-2;R-HSA-3&significance=0.01' +
        '&flagInteractors=true&overlay=a__b&gsaFilter=1;2'
    );
    expect(state.select()).toBe('R-HSA-5');
    expect(state.flag()).toEqual(['R-HSA-2', 'R-HSA-3']);
    expect(state.significance()).toBe(0.01);
    expect(state.flagInteractors()).toBe(true);
    expect(state.overlay()).toBe('a b');
    expect(state.gsaFilter()).toEqual([1, 2]);
  });

  it('leaves a param the address does not name at its initial value', async () => {
    const state = await openAt('/PathwayBrowser/R-HSA-1?significance=0.01');
    expect(state.interactorScore()).toBe(state.interactorScore.initialValue);
    expect(state.flag()).toEqual([]);
    expect(state.significance()).toBe(0.01);
  });

  it('reads a param given twice as its first value, and goes on to the rest', async () => {
    const state = await openAt(
      '/PathwayBrowser/R-HSA-1?flag=R-HSA-2&flag=R-HSA-3&overlay=a&overlay=b&significance=0.01'
    );
    expect(state.flag()).toEqual(['R-HSA-2']);
    expect(state.overlay()).toBe('a');
    expect(state.significance()).toBe(0.01);
  });
});

/**
 * A query parameter that arrives as null or undefined (#954).
 *
 * The router never hands one over, so this goes round it: the service reads
 * these from a stand-in route. The reader once set such a value and then went
 * on to parse it, so `null.split` threw part-way through and every param after
 * it kept its old value. Absent and empty are the same here: the param goes
 * back to its initial value, as one the address does not name does -- not to
 * null, which a list param (`flag`, initially []) cannot hold.
 */
describe('RouterUrlStateService, a null or undefined query parameter', () => {
  it('reads as absent, and the params after it are still read', async () => {
    const queryParams = new BehaviorSubject<Params>({});
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            fragment: of(null),
            queryParams,
            snapshot: { fragment: null, queryParams: {} },
          },
        },
        { provide: UrlStateService, useClass: RouterUrlStateService },
      ],
    });
    const state = TestBed.inject(UrlStateService);
    state.flag.set(['R-HSA-9']);
    state.overlay.set('old');

    // flag (a list) and overlay (text) come before significance in the params.
    queryParams.next({ flag: null, overlay: undefined, significance: '0.01' });
    // The reader is asynchronous: let it finish.
    await new Promise((resolve) => setTimeout(resolve));

    expect(state.flag()).toEqual([]);
    expect(state.overlay()).toBeNull();
    expect(state.significance()).toBe(0.01);
  });
});
