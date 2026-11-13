import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
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
  await harness.navigateByUrl(url);
  // The reader applies the params in an async callback; let it finish.
  await new Promise((resolve) => setTimeout(resolve));
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

  it('an unknown DTAB code opens no particular tab', async () => {
    const state = await openAt('/PathwayBrowser/R-HSA-1?DTAB=XX');
    expect(state.tab()).toBeFalsy();
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
