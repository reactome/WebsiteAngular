# Research: Render page reuse

Read from the code on 4 Nov 2026 (main at a70c4e7b), with the pilot of spec.md's
Background. Every "decision" below that rests on reading rather than measurement is
checked by R4's prototype and R5's comparison before it is built on.

## R1. Moving a loaded page to the next figure

**Decision:** navigate inside the app, and recreate the render component for every figure.

- **The navigation:** the render page puts a function on `window`,
  `__renderNavigate(url)` (contracts/render-page.md). It calls the router's
  `navigateByUrl` with the path and query of a render address, the same address the
  service loads today.
- **Recreating the component:** a route reuse strategy for the two render routes
  (`render` and `render/:pathwayId`) never reuses their component. Every navigation
  destroys the old `RenderComponent` and constructs a new one.
- **Why that works:** the new component reads `route.snapshot` in its field
  initialisers, exactly as on a fresh page. None of its reads changes, so each of its
  parameters needs nothing new to prove.

**Why not make the component react to parameter changes:** every one of its 1,665 lines
assumes one figure a lifetime. Its readiness signals, its effects and its exports would
all need re-arming, and a missed one leaks silently. Recreating keeps the one-figure
assumption true.

**Readiness:** the caller must not read the old figure's readiness.

- Each navigation carries an id. The new component copies it into `__renderState` and
  onto its host as `data-render-nav`.
- The caller waits for a `cr-render` with that id that is ready or in error. The old
  host is removed when its component is destroyed, so a stale host cannot match.

**Alternatives:**

- keeping full `goto`s on held pages: this saves only the page's creation, not starting
  the site's code, which the pilot found to be the cost;
- a batch API on the page drawing many figures per call: the spec puts it out of scope,
  since reuse makes it unnecessary.

## R2. State that outlives the component

The component is recreated, but what it injects from the root is not. These services, and
anything global on the page, keep their state from one figure to the next:

| What                                        | Holds                                                         | Today's render page                                    | Decision                                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UrlStateService` (`RouterUrlStateService`) | pathway, analysis token, resource, sample, flags from the URL | read from the router                                   | follows the navigation; a parameter absent from the new address must read as absent (checked in R4/R5)                                                                                 |
| `DarkService`                               | `isDark`, the `dark` class on `body`, `localStorage`          | set explicitly from `dark=` at construction, both ways | harmless as written (always set); a mutant that stops setting it must fail R5                                                                                                          |
| `SpeciesService`                            | `currentSpecies`                                              | set only when `species=` is given                      | **a leak risk:** a figure after an overview of another species starts with that species. Reset to the site's default when `species=` is absent, or show R5 that nothing drawn reads it |
| `AnalysisService`                           | the result, its loading state, samples                        | driven by the URL's token                              | a figure without a token must show no overlay (R5's token-then-none order)                                                                                                             |
| `DataStateService`, `EventService`          | the current pathway, the selected and highlighted events      | set by the component                                   | checked by R5's select and highlight orders                                                                                                                                            |
| `EhldService`, `SvgExporterService`         | caches of illustrations and the overview's drawing            | keyed by what they draw                                | harmless if keyed; checked by R5                                                                                                                                                       |
| HTTP results cached in services             | content service answers                                       | same release, same answers                             | harmless: the graph does not change during a run; a build change replaces pages (R3)                                                                                                   |
| `window.__renderState`, `__renderExport`    | the last figure's state and exports                           | assigned by each component                             | overwritten at construction; the caller reads them only after R1's readiness                                                                                                           |
| `document.fonts`, the icon registry         | loaded fonts and icons                                        | loaded once                                            | harmless, and part of what reuse saves                                                                                                                                                 |
| DOM left behind (`document.body` SVG hosts) | the exporter appends a measuring `svg` to `body`              | removed after use (to check)                           | R4 counts `body`'s children after each figure                                                                                                                                          |

**Found by a reading audit (4 Nov 2026), to reproduce in T001 and R5 before fixing.**
Two were checked against the code here (marked); the rest are as reported, with the
order that would show each:

1. **The component is not recreated by default.** No route reuse strategy exists, and
   `render/A` → `render/B` matches the same route, so Angular keeps the component. A
   query change alone keeps it too. Every `route.snapshot` read would stay stale
   (`render/A?dark=true`, then `render/B`, draws B dark). This is R1's reuse strategy;
   T003's first test is this order.
2. **The readiness wait outlives its component** (checked: no `DestroyRef` or
   `ngOnDestroy` in `render.component.ts`).
   - `waitForDrawn` polls for up to its timeout and finds the host and the illustration
     by global selectors. An old wait can therefore see the next figure's illustration
     and publish the old figure's `__renderState` and `__renderExport`, or overwrite the
     new one's with its timeout error.
   - `__renderState` also keeps the old figure's `ready` until the new one publishes.
   - Order: a slow or failing pathway, then an illustrated one.
   - Fix: cancel the wait on destroy, scope its queries to its own host, and clear
     `__renderState` at construction.
3. **Species is never reset.** `currentSpecies` is set only when `species=` is given or
   the pathway implies one. A mouse pathway, then `render` with no species, draws mouse's
   genome-wide view.
4. **An analysis load failure outlives its token** (checked: `_loadFailure` is cleared
   in `analysis.service.ts` only when a token is present). A dead token, then a pathway
   with no analysis, fails the second with "the analysis result is gone".
5. **The interactors' thresholds** (`interactor.service.ts`: `thresholdByResource`, and
   a one-shot `addressThresholdUnclaimed`) keep the first figure's score. An overlay at
   0.8, then the same overlay at 0.5, draws 0.8.
6. **The default resource** is chosen from the previous token's result while the next
   loads (`analysis.service.ts`). Token A, then token B with another default resource,
   colours B by A's resource.
7. **Probably harmless, to check:**
   - `EventService._diagramPathway` is never cleared, which is a race on a subpathway
     without a diagram;
   - the URL writer may write the previous figure's values while a dbId parameter
     resolves;
   - `cyToSelectedResource` keeps destroyed graphs, which leaks memory.

Each is a row of R5's orders. Each fix is in the render page, in T004, so a fresh page
draws exactly as before.

**The service's own warning:** `service.ts` says, above `getBrowser()`, that reusing a page
"leaks state between renders -- a stale analysis token being the obvious one", and it
opens a fresh page for that reason. That warning is about reusing a page as it is. This
plan recreates the component on every figure and proves the rest by R5's comparison. The
comment is rewritten with T005 to say what the reuse rests on, and that `RENDER_REUSE=off`
is today's behaviour.

The table is from reading. R5's comparison is what decides: each row's risk is a pair of
requests in an order that would show it.

## R3. The service's held pages

- **One held page per concurrency slot.** `schedule()` hands a request a page from the
  pool instead of `browser.newPage()`. The pool never holds more pages than
  `RENDER_CONCURRENCY`.
- **Each page in its own browser context, as today.** The page's `localStorage` and cookies
  are then its own, and a replaced page takes nothing with it.
- **The first figure on a page** is a full load of its address, as today, which brings
  up the app. Every later figure uses `__renderNavigate`.
- **Per figure, as today:** the `RENDER_FILES` interception (`page.route` and
  `page.unroute`) and the `pageerror` and `console` listeners are added and removed for
  each figure, so one figure's problems are never counted on the next.
- **Replaced** (closed, and its context with it) when:
  - the figure failed, timed out, or reported a browser problem (FR-005);
  - it has drawn `RENDER_REUSE_MAX` figures (FR-006; default from R4);
  - its JavaScript heap, read through the DevTools protocol's
    `Performance.getMetrics` after each figure, is over `RENDER_REUSE_HEAP_MB` (FR-006;
    default from R4);
  - the site's build differs from the build the page loaded (FR-008). Nothing reports
    the site's build today: `/health`'s `build` is a hash of the service's own modules
    (`buildId()` in `service.ts`). So the render page reports its own build as the name
    of its main script, which the production build already content-hashes
    (`main-{hash}.js`), in `__renderState.build`. The service learns the site's current
    build by reading the same name from the render page's HTML at `RENDER_BASE`. It does
    that at most once a minute, and before a held page is reused after a minute idle.
    It is one small request, never a figure. A page whose build is not the current one
    is replaced. Measured in T001: the request's time, and whether a deploy is seen
    within the minute.
- **`RENDER_REUSE`:** `off` gives today's behaviour, a fresh page and context per figure
  (FR-010). The default is on once SC-003 passes.
- **Health:** today's fields stay. It adds `pages` (held), `reused` (figures drawn on
  a held page), and `replaced` by reason (contracts/health.md).
- **The CLI** keeps a fresh page per figure (FR-011).

## R4. Measure first

Before building, a prototype measures reuse on the service itself:

- **The prototype:** the navigation entry point and the reuse strategy on the render
  page, and a pool in `service.ts` without the replacement rules.
- **Where:** a site build in a scratch output path, never beta's `dist/`, served on
  loopback, and a loopback render service with `RENDER_FILES` at concurrency 4.
- **What:** per kind, fresh against reused, by the service's log line and by the
  caller's clock:
  - 100 reactions;
  - 40 diagrams;
  - 40 highlights in an ancestor's diagram;
  - 20 illustrations;
  - 5 species overviews.
- **Also:** the JavaScript heap and `body`'s children after each figure, over 2,000
  figures on one page, to choose `RENDER_REUSE_MAX` and `RENDER_REUSE_HEAP_MB`.
- **Go:** reactions on reused pages take at most half their fresh median (SC-002), and
  the projected release 98 run is under 2 h 54 min. Otherwise the plan stops and records
  why.

## R5. The comparison

`tools/render/reuse-compare.ts` draws a sample twice, through a service with
`RENDER_REUSE=off` and through one with it on, and compares the two.

- **The sample:** at least 500 requests, covering:
  - every kind (reaction layout, pathway diagram, highlight, select, illustration,
    genome-wide view, species overview);
  - every setting (dark, subpathways off, an analysis token, a resource);
  - for the token, one of the private replay's tokens, never a real analysis.
- **Orders:** the reused run draws the sample in three orders:
  - as listed;
  - reversed;
  - with each request placed after its own opposite (dark after light, a token after
    none, a species after another, a selection after none, and each the other way).

  The orders go through one held page, at concurrency 1, so each pair meets on the same
  page.

- **SVG:** byte-identical, or the script fails and names the request and the request
  drawn before it.
- **The other formats:** first, each format is drawn twice on fresh pages to find what
  varies by itself:
  - PNG and JPEG are expected to be exact;
  - the PDF may carry a creation date;
  - the PowerPoint's zip carries times;
  - the GIF is expected to be exact.

  What varies is stripped and named, then the reused output is compared with the fresh
  (FR-003).

- **Mutants (constitution III):** dark left, token left, species left, selection left, the
  component reused. Each must fail the comparison, and the result is recorded.

## R6. The release run (SC-001, SC-004)

- **Setup:** pdf-export's figures step, release 98, against a loopback render service
  with `RENDER_FILES`. Settings as T031's run: `RENDER_CONCURRENCY=4`,
  `RENDER_QUEUE=16`, a 3 GB container, and the private release 98 graph read-only.
- **Recorded:**
  - the step's time and its figures' report;
  - the service's health counters;
  - the container's peak memory.
- **The figures themselves** are compared with T031's folder by bytes. A difference is
  explained, by a build change between the two runs, or it is a failure.
