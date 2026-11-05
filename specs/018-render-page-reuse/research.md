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
  Only a navigation that `__renderNavigate` started recreates it: the page's own
  address rewrites after drawing keep the component, as on a fresh page (R4 result).
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
  - the service's container, read from its own cgroup (`memory.current` against
    `memory.max`) after each figure, is over `RENDER_REUSE_MEMORY` of its limit (FR-006;
    default from R4). Not the page's JavaScript heap: in R4 pages crashed the container
    while their heaps stayed between 38 and 53 MB. With no limit to read (the CLI, or no container), only the count
    applies;
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
- **Also:** the JavaScript heap and `body`'s children after each figure, over many
  figures on one page, to choose `RENDER_REUSE_MAX` and the memory bound.
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
- **The figures themselves** are compared by bytes with a run of the same build with
  `RENDER_REUSE=off`, after T011. T031's folder is no byte reference: fresh renders then
  were not repeatable (R7), and T011 changes what is drawn.

## R4 result (T001, 4–5 Nov 2026): go

**The prototype:** branch `spec018/t001-prototype`, never merged. The setup was:

- a scratch `production,beta` site build;
- a loopback render service with `RENDER_FILES`, `RENDER_CONCURRENCY=4`, a 3 GB
  container and a 180 s timeout;
- release 98.

The prototype's setting is named `RENDER_REUSE_MEM`; the plan calls it
`RENDER_REUSE_MEMORY`. Each service started with an empty cache and drew SVGs four at a time, in one fixed
shuffled order. Reused pages ran with the memory rule (point 3 below) at 0.5.

**The gate, on a sample in the book's proportions:** 340 reactions, 24 diagrams, 24
highlights in an ancestor's diagram and 12 illustrations, and no overview. The book is
16,187 reactions of 19,076 figures. The split of the other 60 was chosen, not taken
from the book's counts, and the projection depends on it.

| Kind         | Fresh median | Fresh mean | Reused median | Reused mean |
| ------------ | ------------ | ---------- | ------------- | ----------- |
| reaction     | 3.04 s       | 3.12 s     | 0.47 s        | 1.12 s      |
| illustration | 3.06 s       | 3.14 s     | 0.94 s        | 1.34 s      |
| highlight    | 5.33 s       | 5.34 s     | 3.33 s        | 3.43 s      |
| diagram      | 5.89 s       | 6.89 s     | 4.01 s        | 4.83 s      |
| all 400      | 349.1 s wall |            | 149.8 s wall  |             |

- **Failures and memory:** none failed either way. The peak was 1,923 MiB fresh and
  2,321 MiB reused, with 305 of 400 figures on a held page.
- **SC-002:** reused reactions take 0.15 of their fresh median; half is required.
- **The projection:** the wall time falls to 0.43 of fresh. Applied to T031's 5 h 47
  min, that gives about 2 h 29 min, under SC-001's 2 h 54 min. This is a projection
  from 400 figures; T010's real run decides SC-001.
- **A mixed sample** (99 reactions, 40 diagrams, 40 highlights, 20 illustrations, one
  overview) gave 213 s fresh against 130 s reused (0.61), with peaks of 2,014 and
  2,272 MiB. That mix has more large figures than the book.

**What the prototype found, each now part of the plan:**

1. **The page rewrites its own address.**
   - After drawing, the render page navigates: a reaction's id becomes its pathway with
     `?select=`.
   - A reuse strategy that recreated the component on every render-route navigation
     also recreated it on that rewrite. The new figure's component, with its navigation
     id, was replaced by one without it.
   - 84 of 200 figures failed: 80 timeouts, 3 renderer crashes and 1 other error.
   - The strategy now recreates the component only during a navigation that
     `__renderNavigate` started (R1).
2. **An element handle pins a figure.**
   - `page.waitForSelector` returns a handle to the ready host. An undisposed handle
     keeps that host and its whole tree alive. A heap snapshot showed earlier figures'
     trees retained only by DevTools handles.
   - On a fresh page closing the page frees it; on a held page every figure stayed.
   - **Measured:** on one page, over the same 36 diagrams, in a harness that forces
     garbage collection before each reading:

     | After 36 diagrams | Heap   | DOM nodes |
     | ----------------- | ------ | --------- |
     | handle kept       | 157 MB | 343,370   |
     | handle disposed   | 43 MB  | 10,935    |

     With it disposed, the heap stayed between 38 and 53 MB over the 36 diagrams, SVG
     export included.

   - `body`'s child count was 11 throughout, with the leak and without, so it is not a
     measure of this kind of leak.
3. **The page's heap is the wrong bound.**
   - **Crashes after the fix:** held pages still crashed ("Target crashed") with no
     memory rule. Runs after the fix had 17 of 200 failures, then 8 and 16 with 10 and
     25 figures per page. A count does not prevent it.
   - **Container memory:** the container's peak was its 3 GB limit in the count runs.
   - **Renderer memory:** during a separate reused run, with neither a count nor the
     memory rule, the largest renderer process sampled
     between 530 MB and 1,100 MB, and the others between 320 and 900 MB. These are
     resident sizes, which count shared memory more than once. Sizes fell as well as
     rose, so they are not a strict high-water mark.
   - **The likely cause (inferred, not traced):** memory outside the JavaScript heap,
     held between figures and freed when a page closes, which four held pages plus a
     large diagram take past the limit.
   - **What worked:** closing a finished page, instead of holding it, whenever the
     container's memory is over half its limit gave no failures. That held in both
     samples above (600 figures).
   - **Hence:** `RENDER_REUSE_MEMORY` (0.5) in place of `RENDER_REUSE_HEAP_MB`.
     `RENDER_REUSE_MAX` (200) is kept as a backstop that was neither tuned nor
     exercised. With no limit to read, only the count applies, and T007 tests that case.
4. **Fresh renders are not repeatable** (R7), so R5's byte comparison cannot yet be
   run as written.

**Not done as R4 planned:**

- **The 2,000-figure run on one page.** The memory rule bounds the service whatever a
  page holds, but it would not show a slow leak inside a page. That run moves to T007,
  which sets the count against it.
- **The overviews:** the mixed sample had one overview, not five, and the gate sample
  none.

## R7. Fresh renders vary (found by T001)

Two runs of the same 200 SVGs, each on fresh pages, differed in 49 files, all
reactions.

**Drawing order (42).** The same elements are drawn in a different order. The cause is
the reaction layout's source, ContentService's Java
`/exporter/reaction/{id}/diagram`:

- it numbers a layout's ids from a counter that runs across requests, so the same
  reaction gets new ids on every call;
- for some reactions it also lists the nodes in a different order.

Six calls for one reaction gave six different answers. Six fresh draws of that reaction
gave three different SVGs from the live endpoint, and one SVG when the endpoint was
answered from a fixed copy. That was shown for one reaction; the 42 are attributed to
it, not each tested. Over 99 reactions fetched three times each, every answer varied,
and none did once put in the canonical form T011 describes. (The layout itself still
varies for some reactions, below, but none did in those three fetches.) With that form
in the render page, six fresh draws each of R-HSA-1483229 and R-HSA-1630306 gave one SVG
each.

**Label placement (7).**

- **Six:** a node's label was drawn smaller and moved aside, at 8.43 to 11.72 px
  against 12 px.
- **The cause, reproduced for proteins:**
  - **What the style does:** it shrinks a protein's or molecule's label and moves it
    aside, to make room for its structure, which is a video or picture in an HTML layer
    over the diagram. It undoes that when the structure fails to load.
  - **When the load starts:** for a protein, only after a throttled check that the node
    is on screen at a zoom where structures show, so possibly after the figure is
    declared ready.
  - **Measured:** R-HSA-211224 drawn 12 times, four at once, gave two SVGs. DFFA and
    DFFB were at 8.43 px in 10 and at 12 px in 2. No lookup was pending at export in
    either.
  - **Waiting is not enough:** waiting for pending lookups does not help, because in
    most draws none had started.
- **What an export shows:** the structure layers are HTML and not part of the export,
  so a shrunken label sits next to empty space. Making this repeatable means choosing
  one look for exports, full-size labels or shrunken ones.
- **Decided (5 Nov 2026):** full size. The style library gained `features.structures`
  (CSS `--structures`), and the render page sets `--structures: 0`. R-HSA-211224, drawn
  12 times four at once, then gave one SVG with full-size labels. The site itself keeps
  its structures.
- **The seventh:** its compartment and labels sit 32 px lower in one run. Here the
  endpoint computed a different layout: one answer in six for R-HSA-1791144 placed a
  node 16 px higher and shrank the compartment to fit. The layout is made per request
  and probably depends on the order the endpoint takes the nodes in, so it varies for
  some reactions. No canonical form can
  fix that; it has to be fixed where the layout is made.

**Reuse against fresh:** reused SVGs differed from fresh ones in 88 of 183 (a run after
the handle fix). R5 cannot tell a leak from this until fresh renders are repeatable, so
T011 makes them repeatable first:

- the reaction layout put in a canonical form before it is drawn: nodes in a fixed
  order, ids renumbered from that order;
- full-size structure labels in exports (above; done);
- the endpoint's varying layout fixed where the layout is made (a separate change).

**Also seen, in an earlier T001 run on fresh pages:** a species overview for a species
other than human failed with "asked for species 7955, the page drew 9606". It is
recorded here for its own fix.

**Measured after T011's fixes (5 Nov 2026, `reuse-compare.ts --mode fresh`):** T001's
200-figure sample (99 reactions, 40 diagrams, 40 highlights, 20 illustrations, one
species overview), drawn twice on fresh pages against a site build with #795 and #796:

- **198 byte-identical**, against 49 differing before the fixes.
- **The two that differ are both reactions whose Java layout varies:** asked eight times
  each, R-HSA-1791144 gave two node arrangements (2 and 6 calls) and R-HSA-9844549 two
  (4 and 4). A reaction drawn the same each time (R-HSA-1630306) gave one arrangement in
  eight calls.
- **The exemption's cap:** 2 of the 99 reactions is 2.02%, just above T011's 2%, so the
  test as written fails on this sample. Whether to raise the cap or wait for spec 006
  T092 is open. The exemption's detection (each draw's layout as the page received it)
  is not built yet; the two were identified by asking the endpoint directly.
