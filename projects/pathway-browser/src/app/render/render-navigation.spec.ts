import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, RouteReuseStrategy, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';
import { installRenderNavigate, pageBuild, renderNavigate } from './render-navigation';
import { currentRenderNav, RENDER_FIGURE, RenderReuseStrategy } from './render-reuse-strategy';

/**
 * Stands in for RenderComponent, whose external template the unit runner
 * cannot compile: it reads its move id and its address at construction, as
 * RenderComponent does, so a component kept across a move shows the previous
 * figure's.
 */
@Component({ selector: 'cr-render', template: '' })
class FigureStub {
  readonly nav = currentRenderNav(inject(Router));
  private readonly snapshot = inject(ActivatedRoute).snapshot;
  readonly pathway = this.snapshot.paramMap.get('pathwayId');
  readonly dark = this.snapshot.queryParamMap.get('dark') === 'true';
}

@Component({ selector: 'cr-other', template: '' })
class OtherStub {}

async function setUp() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          path: 'PathwayBrowser',
          children: [
            {
              path: 'render',
              children: [
                { path: '', component: FigureStub, data: { [RENDER_FIGURE]: true } },
                { path: ':pathwayId', component: FigureStub, data: { [RENDER_FIGURE]: true } },
              ],
            },
            { path: ':id', component: OtherStub },
          ],
        },
      ]),
      { provide: RouteReuseStrategy, useClass: RenderReuseStrategy },
    ],
  });
  const harness = await RouterTestingHarness.create();
  const router = TestBed.inject(Router);
  const shown = (): FigureStub => {
    const figure: unknown = harness.routeDebugElement?.componentInstance;
    if (!(figure instanceof FigureStub)) throw new Error('no figure is shown');
    return figure;
  };
  return { harness, router, shown };
}

describe('render page navigation (spec 018)', () => {
  it('a full load carries no move id', async () => {
    const { harness, shown } = await setUp();
    await harness.navigateByUrl('/PathwayBrowser/render/R-HSA-1');
    expect(shown().nav).toBeNull();
  });

  it('a move recreates the component, which reads the new address and carries the new id', async () => {
    const { harness, router, shown } = await setUp();
    await harness.navigateByUrl('/PathwayBrowser/render/R-HSA-1?dark=true');
    const first = shown();

    expect(await renderNavigate(router, '/PathwayBrowser/render/R-HSA-2', 'n1')).toBe(true);
    const second = shown();
    expect(second).not.toBe(first);
    expect(second.nav).toBe('n1');
    expect(second.pathway).toBe('R-HSA-2');
    // The first figure was dark; kept, the component would draw this one dark too.
    expect(second.dark).toBe(false);

    expect(await renderNavigate(router, '/PathwayBrowser/render?species=10090', 'n2')).toBe(true);
    const third = shown();
    expect(third).not.toBe(second);
    expect(third.nav).toBe('n2');
    expect(third.pathway).toBeNull();
  });

  it('a move that changes only the query recreates the component', async () => {
    const { harness, router, shown } = await setUp();
    await harness.navigateByUrl('/PathwayBrowser/render/R-HSA-1');
    const first = shown();
    await renderNavigate(router, '/PathwayBrowser/render/R-HSA-1?dark=true', 'n1');
    expect(shown()).not.toBe(first);
    expect(shown().dark).toBe(true);
  });

  it('a move to the address already shown still recreates the component', async () => {
    const { harness, router, shown } = await setUp();
    await harness.navigateByUrl('/PathwayBrowser/render/R-HSA-1');
    await renderNavigate(router, '/PathwayBrowser/render/R-HSA-1', 'n1');
    const first = shown();
    expect(first.nav).toBe('n1');
    await renderNavigate(router, '/PathwayBrowser/render/R-HSA-1', 'n2');
    expect(shown()).not.toBe(first);
    expect(shown().nav).toBe('n2');
  });

  it("the page's own address rewrite keeps the component and its move id", async () => {
    const { harness, router, shown } = await setUp();
    await harness.navigateByUrl('/PathwayBrowser/render/R-HSA-1');
    await renderNavigate(router, '/PathwayBrowser/render/R-HSA-2', 'n1');
    const moved = shown();
    // As the page does after drawing a reaction: its pathway, with ?select=.
    await router.navigateByUrl('/PathwayBrowser/render/R-HSA-3?select=R-HSA-2');
    expect(router.url).toBe('/PathwayBrowser/render/R-HSA-3?select=R-HSA-2');
    expect(shown()).toBe(moved);
    expect(shown().nav).toBe('n1');
  });

  it('refuses anything that is not a render address, and does not move', async () => {
    const { harness, router, shown } = await setUp();
    await harness.navigateByUrl('/PathwayBrowser/render/R-HSA-1');
    const first = shown();
    for (const url of [
      '/PathwayBrowser/R-HSA-1',
      '/PathwayBrowser',
      '/render/R-HSA-1',
      '/PathwayBrowser/render/R-HSA-1/more',
      '/PathwayBrowser/render;x=1/R-HSA-1',
      '/PathwayBrowser/render/R-HSA-1(aux:x)',
      'https://example.org/PathwayBrowser/render/R-HSA-1',
    ]) {
      expect(await renderNavigate(router, url, 'n'), url).toBe(false);
    }
    expect(router.url).toBe('/PathwayBrowser/render/R-HSA-1');
    expect(shown()).toBe(first);
  });

  it('puts __renderNavigate on the page', async () => {
    const { harness, router, shown } = await setUp();
    await harness.navigateByUrl('/PathwayBrowser/render/R-HSA-1');
    installRenderNavigate(router);
    const navigate = window.__renderNavigate;
    if (!navigate) throw new Error('__renderNavigate is not on the page');
    expect(await navigate('/PathwayBrowser/render/R-HSA-2', 'n1')).toBe(true);
    expect(shown().nav).toBe('n1');
    expect(await navigate('/PathwayBrowser/R-HSA-2', 'n2')).toBe(false);
    delete window.__renderNavigate;
  });
});

describe('pageBuild', () => {
  function page(html: string): Document {
    return new DOMParser().parseFromString(`<html><head>${html}</head></html>`, 'text/html');
  }

  it("names the page's content-hashed main script", () => {
    expect(
      pageBuild(
        page(
          '<script src="polyfills-AB12.js" type="module"></script>' +
            '<script src="main-IPGKAK5D.js" type="module"></script>'
        )
      )
    ).toBe('main-IPGKAK5D.js');
  });

  it('names an unhashed main script, as a development build serves', () => {
    expect(pageBuild(page('<script src="/main.js" type="module"></script>'))).toBe('main.js');
  });

  it('is null with no main script', () => {
    expect(pageBuild(page('<script src="mainly-ABC.js"></script>'))).toBeNull();
  });
});
