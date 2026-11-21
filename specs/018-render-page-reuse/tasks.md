# Tasks: Render page reuse

**Input**: design documents in `specs/018-render-page-reuse/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

Each task is one pull request with its own adversarial review. Every test is seen failing
first (constitution III). The PR that completes a task ticks it here with its number.

## Phase 1: Measure first (go or no-go)

- [x] T001 Prototype and measure (research R4), on a branch that is not merged (#793).
  - **On the render page:** add `__renderNavigate` and the never-reuse strategy for the
    render routes in `projects/pathway-browser/src/app/render/render-navigation.ts`.
  - **In the service:** add a held page per slot in `tools/render/service.ts`, without
    the replacement rules.
  - **Measure:** time each kind fresh against reused at concurrency 4, through a
    loopback service with `RENDER_FILES` and a scratch site build. Count each page's
    heap and `body`'s children over 2,000 figures.
  - **Done** (research.md R4 result: go, on a sample in the book's proportions). Its
    findings changed T003, T005 and T007, and added T011. The 2,000-figure run moved to
    T007.
  - **Record:** the result in research.md R4 (go or no-go), with
    `RENDER_REUSE_MAX` and the memory bound chosen.
  - **If no-go:** stop, and record why.

**Checkpoint**: go: reused reactions take at most half their fresh median.

## Phase 2: The comparison first (US2, P1)

- [x] T011 [US2] Fresh renders repeatable (research R7), in the render page.
  - **Fix:**
    - the reaction layout put in a canonical form before it is drawn (nodes in a fixed
      order, ids renumbered in the layout and in the graph's nodes, which refer to it): done in
      #795;
    - full-size structure labels in exports, which waiting cannot give (research R7):
      done in #796, with ngx-reactome-base #23;
    - the endpoint's varying layout (R7's seventh case) raised as a change of its own:
      [spec 006](../006-content-service-to-node/tasks.md) T092 ports the endpoint to
      node, with a deterministic layout (research D21 there).
  - **Test:** the same sample drawn twice on fresh pages, every SVG byte-identical; seen
    failing before the fix.
    - **Until T092 is done,** a reaction may differ between the two draws only if its
      layout from the endpoint differed between them. The test records each draw's
      layout response, as the page received it, and compares their canonical forms.
      Even then, the two draws' text elements, taken as (content, font size) pairs in
      any order, must match, so a label regression on such a reaction still fails. Any other
      difference fails.
    - **Exempt reactions** are listed in the result. More than 2% of the sample's
      reactions exempt fails the test (for example, at 100 reactions two pass and a
      third fails), so a growing list stops it rather than passing
      unnoticed. (Varying layouts have been seen for two reactions of the 99 in T001's sample:
      research R7.)
    - **T011 is ticked** when the test passes with that exemption, so T002 can go on.
      Removing the exemption is part of spec 006 T092: it is done when this test
      passes with none.
    - **On T001's own sample the cap fails:** two of 99 is 2.02% (research R7). Decided
      5 Nov 2026 (awright): the cap is not raised; the reaction layout is ported (spec 006
      T092), whose layout does not vary, so T011 waits on T092 and is ticked with no
      reaction exempted.
    - **Passed with no reaction exempted, 6 Nov 2026 (#846):** once the reaction layout was
      answered by node (spec 006 T092 step 5, #834) and the site's proxy routed it there, 100
      human reactions of release 98 drawn fresh twice by `tools/render/reuse-compare.ts --mode
fresh`: 100 drawn, 0 differ. With Java's layouts the same test had found 2 differences in
      200 (T002, #810). Reactions with `R-NUL-` ids time out in the render page itself, whatever
      the layout: issue #843, outside this test.

- [x] T002 [US2] The comparison script `tools/render/reuse-compare.ts` (research R5) (#810, #957).
  - **Written (#810):** the script and its tests. Its first run, `--mode fresh` on T001's
    sample, is in research R7. Still to do before it is ticked: a run in `reuse` mode,
    which needs a site build with the render page's entry point (T003): T001's prototype
    does not report `reuse` in `/health`, so the script refuses it.
  - **What it does:** draws the sample through two services, three orders, and compares
    SVG by bytes and the other formats after their named variation.
  - **Tests in `tools/render/reuse-compare.spec.ts`:** it fails on a planted difference,
    and its report names the request and the request drawn before it.
  - Run in `reuse` mode once T003–T005 report `reuse` (T001's prototype does not).
  - **First `reuse` run, 8 Nov 2026 (#957):** T005's service against beta's site (T003 and
    T004 built in), 20 SVG requests (reactions, reaction layouts, a diagram dark, with
    subpathways off, a selection and a highlight, an illustration, the overview of two
    species, and two analysis tokens), listed, reversed and in ten runs of pairs.
    - **What differed, each drawn again through two services on this host:**
      - **A leak:** the genome-wide view after the mouse overview, on a held page, wraps
        one label of 7,604 ("Regulation of TBK1, IKKε-mediated activation of IRF3, IRF7
        upon TLR3 ligation") on three lines where a fresh page wraps it on five. Two fresh
        pages agree, and so do two held ones; an overview after a diagram, or after the
        dark overview, does not differ. Seen only at the service's viewport (1600 by
        1000). FoamTree reuses a label's fit for the same text at an area within 5%; what
        carries it between two FoamTree instances is not found. Disposing the old instance
        does not change it. T012.
      - **Fresh renders that vary** (research R7's kind, not reuse): an illustration with
        an analysis token (one element's `style` written before its `class`, or after) and
        the highlight on R-HSA-69620 (a halo's last point, 4 px apart) differ between two
        fresh pages as they do between a fresh and a held one. T012.
      - **A sample error:** R-MMU-69620 answers 500 on fresh pages too: `RENDER_FILES` here
        holds only human diagrams. Each failure closes its page, so the next draw is a full
        load, which the script reports as draws not on a held page.
      - One 500 (R-HSA-9844549 with a token, after R-HSA-1791144) did not recur when drawn
        again.

## Phase 3: The render page (US1, US2)

- [x] T003 [US2] The render page's entry point (contracts/render-page.md) (#877).
  - **Files:** `render-navigation.ts`; the route reuse strategy in
    `app-routing.module.ts`; `nav` and `build` in `__renderState` and `data-render-nav`
    in `render.component.ts`.
    - **Built:** the strategy is a module of its own, `render-reuse-strategy.ts`,
      provided in the site's root config. In `render-navigation.ts` it took the site's
      initial bundle 67 bytes over its 450 kB budget; on its own the bundle is 449.33 kB.
    - **A move to the address already shown** reloads it (`onSameUrlNavigation`), or the
      router ignores it and no component carries the new `nav`.
  - **Tests:** a second navigation recreates the component, and its readiness carries
    the new `nav`. A non-render address is refused. The page's own address rewrite
    after drawing keeps the component (R4 result, 1).
    - **Seen failing:** with no recreation; with recreation on every render navigation
      (the prototype's trap: the rewrite test fails); without the same-address reload;
      and with the address check removed or loosened.
    - **In a browser** (a scratch build): one page moved through an illustration, a
      reaction rewritten to its pathway, a reaction layout twice, the overview and a
      dark diagram. Each host carried its own `nav` and nothing else was on the page;
      the reaction's SVG matched a fresh page's byte for byte.
- [x] T004 [US2] The state of research R2's table, each row settled. A leak found is
      fixed in the render page (#885):
  - the readiness wait cancelled on destroy, its queries scoped to its own host, and
    `__renderState` cleared at construction (R2 audit 2);
  - the species reset when `species=` is absent (audit 3);
  - an analysis load failure cleared when the token is absent (audit 4);
  - the interactors' thresholds and the default resource taken from the figure's own
    address (audits 5 and 6);
  - audit 7's three checked, and fixed if R5 shows them;
  - `body` left with no exporter hosts.

  Tests: each R5 order that would show the row.

  - **Settled, 7 Nov 2026,** in a browser, on a scratch `production,beta` build. Each order
    is one held page drawing a figure, moved with `__renderNavigate` to the next, compared
    with the next on a fresh page: the SVG, `__renderState` and `body`'s children.
    - **Found, on T003's build:** 5 of 19 orders differed, each a row above.
      - Audit 2: a move while a diagram was still drawing published the next figure, an
        illustration, under the diagram's id.
      - Audit 3: a mouse pathway or a mouse overview, then the overview with no
        `species=`, drew mouse's overview.
      - Audit 4: a dead token, then the same pathway with none, failed with "the analysis
        result could not be read".
      - Audit 6: a token holding UNIPROT, then one holding only TOTAL, coloured the second
        for UNIPROT.
    - **Fixed:** `startAsFresh` (`render/start-as-fresh.ts`), run at construction, clears
      `__renderState` and `__renderExport`, dismisses the last load failure, and sets the
      species a fresh page ends at (the id's, or the default). The wait stops once its
      component is destroyed, and reads only its own host. The default resource is taken
      only from the result of the token in the address (`analysis.service.ts`), which on
      the site is the same: the previous result was kept only while the next loaded.
    - **After:** 24 of 25 orders the same, adding interactor thresholds, a subpathway with
      no diagram, and chains of three. The 25th differs only in the page's address after
      drawing: a reaction layout drawn twice keeps `?layout=reaction`, which a fresh page's
      address writer drops. The writer runs only when a state value changes, and the
      second figure changes none. Nothing reads the address after construction (the
      component's reads are its field initialisers), so the figure and its state are
      identical; left as it is.
    - **Settled without a change:** the interactor thresholds and `cyToSelectedResource`
      (audits 5 and 7) are reached only through an interactor overlay, which the service
      never asks for, and the orders with one showed no difference; the subpathway race
      (audit 7) showed none. Exporter hosts are removed after use; Reacfoam's is now
      removed when measuring throws too.
    - **Unit tests, seen failing:** `start-as-fresh.spec.ts`, with each of its lines
      removed in turn; `analysis-default-resource.spec.ts`, without the token check.
    - **Analysis tokens:** two made on this host's own Analysis Service for this, from five
      UniProt and four ChEBI identifiers.

- [x] T013 The render page waits for its analysis overlay, fresh and held, for
      pdf-export's analysis report (its spec 002: T017, research R3, FR-204) (#958).
  - **Asked for:** with a token, the page is ready only once the view carries the overlay
    for the result's default resource (the one resource besides TOTAL, when the result
    holds exactly one; otherwise TOTAL); a token that cannot be read ends in the page's
    error; the render cache's key bumped; a test that fails when the page is ready first.
  - **Already built, by #771 (2 Nov 2026), before held pages:** `analysisShown` in
    `render.component.ts` waits on `AnalysisService.settled` and on each view's own
    colouring (the diagram's `appliedAnalysis` for the token and resource, the
    illustration's for the result, the overview's tree for the token and resource);
    `analysisFailure` makes an unreadable token an error; the cache key went to v12 for
    it. pdf-export's research R3 was written on 30 Oct, before it. The reaction's own
    layout carries no overlay, and says so (`analysis: null`).
  - **Added here: held pages.** A moved figure is a new component in an app whose
    analysis service can already have settled for the last figure. Tests in
    `e2e/downloads.spec.ts`: a diagram with a token after an illustration without one;
    the overview after a diagram with the same token (the result already settled); and a
    dead token after a figure that drew. Each figure's readiness is read on its own host
    (`data-render-nav`).
  - **Seen failing** (13 Nov 2026, a dev server of this tree, recorded answers):
    - with `analysisShown` always true, all five overlay tests, fresh and held;
    - with only `settled` kept, four (not the illustration, whose colouring arrives with
      its result, as the test's comment says);
    - with `settled` dropped, the illustration's;
    - with the views' checks skipped on a moved figure only, the two held tests alone;
    - with `analysisFailure` never failing, the three unreadable-token tests.
  - **The cache key is not bumped again.** This change adds tests, not output: every
    figure cached under v12 and later was drawn with the wait, so a bump would only make
    the cache cold.

## Phase 4: The service (US1, US3, US4)

- [x] T005 [US1] Held pages in `tools/render/pages.ts`, used by `schedule()` in
      `service.ts` (#957).
  - The first figure on a page is a full load; later ones navigate in the app.
  - Behind `RENDER_REUSE` (off is today).
  - The comment above `getBrowser()` that warns against reuse is rewritten to say what
    reuse rests on (research R2).
  - The readiness handle is disposed (R4 result, 2).
  - **Tests in `tools/render/pages.spec.ts`:**
    - no more pages than `RENDER_CONCURRENCY`;
    - no page shared by two figures;
    - off means a fresh page and context each time.
  - **Built:**
    - a page is held only after a figure that succeeded and left it movable: one that
      failed is closed, so T006 adds the browser problems and the browser's restart to a
      rule that is already there;
    - `render()` reports whether the page can still be moved: a PDF is printed from the SVG
      put in the page's place, and a site built before T003 has no `__renderNavigate`;
    - `/health` says `reuse`, and with it on `reused`, which reuse-compare reads before it
      trusts a run; the rest of the health contract is T008's.
  - **Seen failing:** the pool's tests with reuse ignored, no cap, a page left on the list
    while drawn, a failed page kept, `reusable` ignored and a close that throws; the move's
    tests with every page loaded, the handle kept, any host waited for and a refused move
    ignored.
- [x] T012 [US2] What T002's first `reuse` run found (#957 records it) (#997).
  - **The overview's label leak:** found and fixed in the render page, or the page replaced
    when the species changes, with the pair (mouse overview, then the default) passing.
  - **Fresh renders that vary:** an illustration with a token, and highlights, made
    repeatable as T011 made reactions, and the fresh twice-over test extended to them.
  - **Found first, 17 Nov 2026: the genome-wide view drawn empty.** On main the render
    page took an empty tree as drawn: FoamTree lays out an empty list as readily as the
    species' pathways, and readiness waited for the tree's data only with a token. The
    human overview, whose pathways arrived about 75 ms after that, came out as a
    background with nothing on it (215 bytes of drawing; `groups: 0`), fresh and held
    alike, so the pair passed by being empty. **Fixed:** the overview is drawn only once
    its tree is the one fetched (`showsCurrentData`), token or not. **Test:**
    `e2e/downloads.spec.ts`, the tree held back four seconds: the page must not be ready
    before it arrives and must report its groups; seen failing without the fix.
  - **The label leak: fixed in the render page, not by replacing the page.** FoamTree
    keeps each word's width, measured once, in a cache for the page's life (its label
    module's `c`). Roboto comes in unicode subsets; a word with a Greek letter ("IKKε",
    "β-amyloid", "ω-3") was measured before the Greek subset had loaded, in a fallback
    font. A fresh page measured those four words so; a held page, after an overview that
    had brought the subset in, measured them in Roboto, and "Regulation of TBK1,
    IKKε-mediated activation of IRF3, IRF7 upon TLR3 ligation" wrapped on three lines
    instead of five. The held page's was the right one. Replacing the page on a species
    change would have kept the wrong one, and the same could happen after any figure
    that loads the subset. **Fixed:** the render page loads every subset of the labels'
    font (Roboto 400, `render/label-font.ts`) before it makes the overview. **Tests:**
    `label-font.spec.ts` (each of four mutants fails it); in `e2e/downloads.spec.ts`,
    every word measured by the overview is measured in a loaded font, with the font
    files slowed: 9,937 words were not without the wait. **The pair:** mouse overview,
    then the default, on a held page, byte-identical to a fresh page's default overview
    (it differed before the font fix, and two fresh pages agreed).
  - **The illustration with a token:** the analysis outline (`rect.inner-stroke`) is a
    copy of the region's label box. The box arrives with an empty `style` that the
    colouring removes, but a copy taken while it was there kept it, and wrote `style`
    before `class`. Seen in 6 of 20 fresh draws of R-HSA-1643685 with one token, through
    one page each. **Fixed:** the copy is made without the box's style
    (`ehld/inner-stroke.ts`); the drawing is unchanged. **Test:** `inner-stroke.spec.ts`,
    failing without the fix.
  - **The highlights: a race, not a fresh render's own variation.** Fresh pages agreed
    (28 draws of `highlight=R-HSA-69615`, and 24 highlights of R-HSA-69620's events drawn
    fresh twice, one SVG each). With the fixes above, the reuse run still differed on
    every highlight, after various figures and not repeatably for any one pair: the
    highlighted lines' ends, about 4 px apart. The page marked the highlight only when
    the figure was taken, before the diagram had redrawn the lines selected, so their
    ends were where unselected lines end; on a held page, quicker to draw, the redraw was
    sometimes part done. The same page taken a second time, a second later, gave a third
    SVG, and a third time the same as the second: the settled figure. **Fixed:** the
    highlight is marked once the diagram is drawn, before the page's two-frame wait, so
    the figure taken is the settled one. **Test:** `e2e/downloads.spec.ts`, a highlighted
    diagram taken twice a second apart must be the same; seen failing without the fix.
  - **The fresh twice-over test, extended:** `reuse-compare.ts --mode fresh` on 32
    requests (T002's sample with R-HSA-1791144 and R-HSA-9844549 drawn as pathways and as
    reactions, five illustrations with a token, six highlights, a Greek-labelled diagram,
    and the overviews of both species). On main's site: 3 differ, all illustrations with a
    token (the overviews agreed by being empty). With these fixes: 0 differ.
  - **The reuse run with these fixes:** `--mode reuse` on the same 32, against a scratch
    `production,beta` build of this change: listed, reversed and ten runs of pairs, 260
    draws on held pages, 0 differ (before the highlight fix: 17 differ, every one a
    highlight).
  - **The render cache key** goes to v14: an overview cached under v13 can be empty, or
    have its Greek-lettered labels wrapped as measured in a fallback font, and a highlight
    has its lines' ends taken before they were redrawn.
  - **For T006–T010:**
    - An overview whose tree cannot be read now ends in the page's 60 s "nothing drawn"
      error instead of an empty figure, so T006's failure rule closes its page.
    - `ReacfoamComponent` never disposes its FoamTree, so each overview on a held page
      leaves one behind; T007's long run should include overviews.
    - A fresh overview now fetches Roboto's nine subsets before drawing (once per held
      page).
    - R-MMU-69620 drew normally here: #957's 500s were not the release files.
- [x] T006 [US3] Replacement on failure, timeout or browser problem, and on a browser
      restart (data-model Replacement) (#1000).
  - **Tests:** each reason closes the page, and the next figure is drawn on another; the
    failed request's answer is today's.
  - **Built:** `Pages` in `pages.ts` judges each figure (`verdict`: `hold`, `spent` for a
    page that no longer holds the render page, or a reason) and counts replacements by
    reason in `replaced`. T007 adds its reasons to `Reason` and its rules beside these.
    - `failure`: the figure threw (an error, a timeout, a crash while drawing), or its
      result reported a browser problem (`problems`, what the log line counts: the figure
      is answered, the page replaced), or a held page's renderer died while it was idle
      (`alive()`: the page's `crash` event, or closed under the pool).
    - `browser`: `replaceAll('browser')` on the browser's `disconnected` event closes every
      held page; a page being drawn on when it happens is closed after its figure.
    - The figure's own result or error is what `use()` returns, with reuse on as off.
  - **Seen failing** (`pages.spec.ts`), each mutant against its tests: a failed figure
    kept; browser problems ignored; a crashed page given out; held pages left on a
    restart; a page drawn on during a restart held after; replacements not counted; the
    failed figure's error rewritten; a close that throws.
  - **Live, a loopback service against this host's site, reuse on, one page** (the counts
    read from `replaced` through a local edit of `/health`, which T008 publishes):
    - the browser killed between figures: the next figure a full load and drawn (200),
      `browser: 1`. Without the `disconnected` listener, `alive()` still catches it but
      counts `failure`; without both, the next figure answered 500 ("Target page, context
      or browser has been closed").
    - the held page's renderer killed: the next figure a full load and drawn, counted a
      failure; without `alive()`, 500 ("Target crashed").
    - a figure timed out on a held page (`RENDER_FILES` empty, `RENDER_TIMEOUT` 8 s):
      500 with the same body as with reuse off, and the next figure a full load.
- [x] T007 [US4] Replacement by count, by the container's memory and by build, with the
      defaults from T001 (`RENDER_REUSE_MAX` 200, `RENDER_REUSE_MEMORY` 0.5) (#1001).
  - The site's build is read from the render page's HTML at `RENDER_BASE`, at most once
    a minute (research R3).
  - **Measure first:** heap and document nodes over 2,000 figures on one page, to set
    `RENDER_REUSE_MAX` (R4 result).
  - **Tests:** each rule, seen failing with it removed.
  - **Measured, 17 Nov 2026:** one held page, 2,000 figures of release 98 drawn in
    turn with the release's files (1,600 reactions' own layouts, 200 diagrams, 80
    highlights, 60 illustrations, 60 overviews of two species, light and dark, shuffled),
    garbage collected before each reading, on a scratch `production,beta` build of main.
    - **The overview's FoamTree was never disposed** (T012's note), and it held its whole
      layout: on beta's build, the heap after each overview rose by about 17 MB, and the
      browser's memory by about 90 MB (28 overviews on one page: heap 52 to 482 MB,
      browser 2.7 GB). In the full sample the heap was 190 MB after 400 figures and
      climbing. **Fixed** in the page (`ReacfoamComponent.ngOnDestroy` disposes it), in
      a commit of its own with `reacfoam-dispose.spec.ts`, seen failing without it.
      With it, the same 28 overviews keep the heap between 67 and 76 MB.
    - **With the fix:** 2,000 drawn, none failed, all on the one page. The heap stayed
      between 73 and 119 MB with no trend (median over each 100 reactions, 75 to 113
      MB); document nodes about 13,500 after the first illustration, a plateau, not a
      growth (the illustration kept until the next); a reaction's median time 313 ms
      over its first 200 and 319 ms over its last. The browser's memory (PSS of its
      processes) rose from about 900 MB at figure 300 to about 1,150 MB at 2,000:
      about 0.15 MB a figure, outside the heap.
    - **So `RENDER_REUSE_MAX` stays 200.** Nothing in a page grows enough over 2,000
      figures to need a lower count, and a higher one would save at most one load in
      200 (under 1% of a run's time); 200 bounds the slow growth outside the heap to
      about 30 MB a page. Without the dispose fix, 200 figures would have carried about
      seven overviews' trees per page, some 600 MB of browser memory each at four pages,
      and the memory rule, not the count, would have bounded it.
  - **Built,** in `pages.ts`, on T006's `Reason`:
    - `count`: a page that has drawn `maxFigures` (`RENDER_REUSE_MAX`) is closed after
      that figure, so no page draws more.
    - `memory`: after a figure that would leave its page held, `overMemory()`; the
      service compares `memoryShare()` with `RENDER_REUSE_MEMORY`. The share is read
      from the cgroup's `memory.current` against `memory.max`, at the nearest limit from
      the process's own group up (the container's root, or a unit's limit); with none,
      only the count applies.
    - `build`: before a held page is given a figure, its `loaded` build (the
      `__renderState.build` of its first figure) against `siteBuild()`, the main script
      named in `RENDER_BASE`'s `/PathwayBrowser/render`, read at most once a minute
      (`atMostEvery`). Either unreadable, nothing is replaced.
  - **Seen failing**, each mutant against `pages.spec.ts`: no count; the count off by
    one; no memory rule; the rules never asked; no build rule; a build replaced when
    either is unknown; a failing build read not caught; the build read every time, and
    only once; a failed read not null; no walk up the cgroup; "max" read as a limit; a
    missing `memory.current` read; a loose main-script match.
  - **Live, a loopback service against this host's site, reuse on, one page** (the
    counts read through a local edit of `/health`, which T008 publishes):
    - `RENDER_REUSE_MAX=2`, five reactions: loads at the first, third and fifth,
      `count: 2`.
    - Under a user unit with `MemoryMax=3G`: `RENDER_REUSE_MEMORY=0.01` closed the page
      after each of three figures (`memory: 3`); 0.99 held it for all three.
    - Through a proxy that names another main script in the render page's HTML once
      told to: the next figure within the minute still moved; after 61 s the page was
      replaced (`build`). A new page that loads a build other than the one the HTML
      names (only the proxy does that) is replaced again at the next figure, which is a
      fresh page per figure: safe, and slower.
- [x] T008 [US1] The health additions (contracts/health.md) in `service.ts`, and the
      settings in the service's header comment and its README (`tools/render/README.md`) (#1002).
  - **Tests:** health with reuse on and off; every existing field unchanged.
  - **Built:** with reuse on, `/health` adds `pages`, `replaced` (all five reasons) and
    `site` after `reuse` and `reused` (T006's); with it off the four are absent, not
    zero, as T006 left `reused`. `Pages.health()` gives the counts; `site` is what the
    once-a-minute `siteBuild` last read, null before a read or after a failed one, and
    `/health` starts a read without waiting for it. The type is `RenderHealth` in the
    contract, with the reasons as `RenderReplacement`, which `pages.ts`'s `Reason` now
    is. The settings were in the header comment and README already (T007).
  - **Tests** (`service.spec.ts`, `pages.spec.ts`): reuse off, the answer's keys are
    exactly the fields before spec 018 and `reuse`; reuse on (a second copy of the
    service loaded with `RENDER_REUSE=on` against a stand-in site), those keys and then
    `reused`, `pages`, `replaced`, `site`, each count zero, and `site` the stand-in's
    build, read once however often health is asked; `Pages.health()` after held,
    counted, failed and restarted pages.
  - **Seen failing**, each mutant: `pages` given `reused`; `reused` given `held`;
    `replaced` all zeros; the counts left out of `/health`; `site` left out; health not
    starting a read; a read not recorded; the read every time; the fields given with
    reuse off; an existing field dropped.
  - **Live, a loopback service against this host's site:** reuse off, the answer is
    main's, key for key; reuse on with `RENDER_REUSE_MAX=2` and one page, three
    figures gave `reused: 1`, `pages: 1`, `replaced.count: 1` and `site` the main
    script the site's render page names.

- [x] T014 [US2] A PDF leaves its page unmovable (found by T009) (#1003).
  - **The defect:** with reuse on, the figure drawn after a PDF on the same page timed out
    (a 500 after `RENDER_TIMEOUT`), where a fresh page draws it. Live, on one held page:
    a reaction's SVG, its PDF, another reaction's SVG answered 200, 200, 500, and
    `replaced.failure` went to 1. In T009's first run of the other formats, every figure
    drawn after a PDF on a held page failed so.
  - **The cause:** a PDF is printed from the SVG put in the page's place
    (`page.setContent`). That replaces the document, not the window: Chromium keeps the
    window's globals, `__renderNavigate` among them. `render()` asked the window whether
    the page could still move, was told yes, and the page was held (`hold`, not
    `spent`). The next figure was moved by a router whose document was gone, and its host
    never came.
  - **The fix,** in `render-core.ts`: a PDF never leaves its page movable, so it is closed
    as `spent` after its figure (T005's rule, as intended).
  - **Test** (`render-core.spec.ts`): a stand-in page whose window keeps
    `__renderNavigate` after `setContent`, as Chromium's does: an SVG leaves the page
    movable, a PDF does not. Seen failing on the code before the fix (a PDF reported
    `movable: true`).
  - **The other formats** leave the render page in place: PNG, JPEG, GIF and PowerPoint
    are taken with `page.evaluate` from the page as drawn, and nothing else in
    `tools/render` calls `setContent` or loads another document into a page. T009's
    runs of them held pages throughout (below).

## Phase 5: Proof and the release run

- [x] T009 [US2] SC-003 and SC-005.
  - **Run:** the comparison on 500 or more requests, three orders, every format, through
    a reuse-on and a reuse-off service built from main.
  - **Mutants:** run each mutant of research R5 and record that it fails.
  - **Then:** turn `RENDER_REUSE` on by default.
  - **Done, 21 Nov 2026 (#1033): `RENDER_REUSE` is on by default** (`off` turns it off; the
    tests of `/health` cover both, the default's seen failing with the old setting).
    The first SVG run (17 Nov, below) had three differences; two were found and fixed
    (#1020, #1022), and the third, a failure, did not come back.
  - **Run, 21 Nov 2026, clean:** the same comparison (`--mode reuse`, a fresh container
    each run, `--code tools/render` of main with #1020 and #1022 in, the release 98
    files) on a new SVG sample of 751 requests. Listed and reversed: 751 drawn each, 0
    differ. Pairs (8 runs, 3,628 draws): the only differences are 15 requests answered
    500 in every run, the fresh one included: a highlight or selection on an
    illustration, which the service refuses ("highlight is not drawn on an
    illustration yet"), fresh as held. Draws not on a held page (2 to 27 a run) are each
    after a page replaced for a console error or memory, counted in `/health`.
  - **Run, 17 Nov 2026:** `reuse-compare.ts --mode reuse` (each run a fresh container,
    concurrency 1, `--code tools/render`, the release 98 files) against a scratch
    `production,beta` build of main. The script gained, for this: planted failures
    (`!` lines), a held-page count that expects a new page after a PDF or a failure,
    `--port`, and each run's `/health` counts in its report. The SVG run's later
    containers mounted T014's fix, which changes nothing for an SVG.
  - **The SVG sample (SC-003, SC-005): 566 requests,** drawn fresh, then on held pages as
    listed, reversed and in pairs (11 runs, 3,716 draws on reused services):
    - 249 reaction layouts and 5 of mouse; 108 diagrams and 12 of other species (mouse,
      zebrafish, chicken, cow, fly); 71 illustrations; 50 figures in an ancestor's
      diagram (a subpathway with no diagram of its own, or a reaction drawn in its
      pathway, selected); 35 highlights; 25 selections; the genome-wide view 4 times and
      species overviews 4 (mouse, rat, zebrafish).
    - Settings: 55 dark, 25 subpathways off, 33 with a token. The tokens were made on this
      host's own Analysis Service, never a real analysis: three over-representation
      results (one with UniProt as its resource, one with nothing found, one without
      projection) and an expression result of three samples.
    - 3 planted failures, each a token that does not exist, straight before the same
      figure without it.
    - **Result: 3 differences in 3,716 draws, so the default stays off.** Listed and
      reversed: 566 each, 0 differ. Pairs: 2,584 draws, 3 differ:
      - `R-HSA-975957.svg` after its token version (pairs 2). Drawn again (6 requests:
        fresh twice, 0 differ; held, it differed in 3 of 6 runs, after its dark version,
        after a reaction's layout and as the token version after a highlight). The two
        SVGs are the same length; one wide red stroke (`rgb(204,0,0)`, 40 px) has
        `stroke-opacity` 0.018 fresh and 0.012 held. The likely cause, not traced: a
        stroke whose opacity changes over time (an animation or a fade), taken at a
        different moment on a held page, which draws faster. T012's highlight race was
        of this kind.
        **Found and fixed (20 Nov):** the diagram fits its view with an animation of a
        second (`select()`), the bands take their opacity from the zoom, and the page
        said it was ready while the fit still ran. On one held page moved 40 times
        between R-HSA-975957 and four other figures, the bands came out at opacity 0.007
        to 0.018, the zoom at ready 0.3829 to 0.3931 and still moving (`cy.animated()`
        true), settling at 0.3822 within 0.2 s; fresh pages, slower to be ready, gave
        0.018 each time. Now the render page ends any viewport animation at its end
        before it is ready (`render/settle-viewport.ts`; a view that will not settle is
        the figure's error). Test: a fit of 60 frames ends in one; seen failing without
        the stop (#1020).
      - `R-HSA-9674403.svg?highlight=R-HSA-9674408` after its dark version (pairs 1).
        Drawn again it differed once (after the plain diagram) in 6 runs and matched in
        5 direct draws on a held page: intermittent.
      - `R-HSA-69895.svg` with a token (an opposite, drawn only to come first) answered
        500 on a held page after a reaction's layout. Drawn again, fresh twice and held
        in that order, it drew each time: intermittent, cause not found.
        **20 Nov, a different defect found drawing it again:** with a token (made on this
        host's own Analysis Service) the figure, drawn in its ancestor R-HSA-69620,
        differed held from fresh in 22 of 32 draws, and fresh from fresh too. The page
        said it was ready while the nodes' background images (each node's analysis
        colouring is one) were still loading, and the export leaves out an image still
        loading: on fresh pages 132 images at ready, 252 three seconds later, every
        time. So token figures were missing part of their colouring, fresh or held. Now
        the page waits until every node's background image has loaded or failed before
        it is ready, and an expression sample's images before its frame is taken
        (`render/background-images.ts`; still loading after 20 s is the figure's
        error). Test: a wait for three images ends only with the last; seen failing
        with a wait for the first only (#1022).
  - **The other formats (SC-003), 24 requests each,** of every kind but the GIF overview
    (a GIF of the genome-wide view fails, fresh as held):
    - **What varies by itself,** each drawn twice on fresh pages (`--mode fresh`, 120 drawn
      twice, 0 differ after normalising): a PDF's dates and id, and a PowerPoint's zip
      times (a reaction's PDF and PowerPoint differed raw between two fresh draws and
      matched once normalised). PNG, JPEG and GIF were byte-identical raw.
    - **Sample errors, refused fresh as held and swapped out:** a GIF whose token reaches
      none of its figure ("all 3 frames are identical", three pathways), and a PNG or JPEG
      of R-HSA-5579030 at scale 2 (19,652 px wide: 39,304 px exceeds what a canvas can
      export; it draws at scale 1). Both are the service's own refusals, outside reuse.
    - **PNG, JPEG, GIF, PowerPoint (96):** 8 runs, 670 draws, every request in the sample
      byte-identical (normalised for the PowerPoint) to its fresh draw in every order. 18
      opposites failed, each a GIF given the expression token where its samples reach
      nothing: the same refusal fresh.
    - **PDF: the first run found T014.** Every figure drawn after a PDF on a held page
      timed out. After T014's fix: 24 PDFs, each straight after an SVG of its opposite (so
      drawn on a held page in the listed and reversed runs), 8 runs, 320 draws, 0 differ,
      none failed. Live, a reaction's SVG, its PDF and another reaction's SVG answered 200,
      200, 200, the third on a new page.
  - **Held pages replaced during the runs,** each counted in `/health` and none a
    difference: a figure whose page logs a console error (a 404 for a picture, "Missing
    graph data for node" in a disease reaction) has its page replaced by T006's rule,
    on fresh pages too (drawn by the CLI). In the formats' runs 212 replacements for that
    and 11 for memory (PNG and PowerPoint of large figures near half the 3 GB limit). The
    script reports those runs as not held throughout; the requests after each were drawn
    on a new page and matched.
  - **SC-005: met.** The 3 planted failures failed fresh and held, in the listed and
    reversed runs; each run counted at least 3 pages replaced for a failure; the figure
    after each (the same pathway without the dead token, listed; the one before it,
    reversed) matched its fresh draw. In the SVG runs, 1,168 more replacements were for
    console errors (T006's rule, above) and 10 for memory; 2,525 of 3,716 draws were on a
    held page.
  - **Mutants** (research R5), each a scratch build of main with one change, through the
    same comparison on an 11-request sample (a diagram plain, dark, with a token, a
    selection, a highlight and subpathways off; a reaction with a dead token; an
    illustration; a mouse diagram; the human and mouse overviews). Main's build on the
    same sample: no figure differs.
    - dark left (`isDark` set only when asked): 37 differ;
    - token left (the address's `analysis` not cleared when absent): 16;
    - species left (`startAsFresh`'s species reset removed): 5;
    - selection left (`select` not cleared): 19;
    - highlight left (the last highlight kept): 13;
    - subpathways left off (off once, off after): 14;
    - the component reused (the reuse strategy never recreates it): the second figure
      timed out, a 500 where fresh drew it (run stopped once caught);
    - **an analysis failure left (`dismissLoadFailure` removed): not caught,** and it
      cannot be through the service. A figure with an unreadable token either fails (a
      pathway, the overview) or draws and logs console errors (a reaction's layout, which
      takes no overlay); either way its page is replaced (FR-005, T006), so no figure
      after it is drawn on that page. Its run matched main's figure for figure. The
      render page's unit test covers the reset (`start-as-fresh.spec.ts`, T004).
- [x] T010 [US1] SC-001, SC-002 and SC-004: pdf-export's figures step for release 98 with
      T031's settings (research R6).
  - **Record here:** the time, the health counters, the container's peak memory and the
    comparison with a reuse-off run of the same build (research R6).
  - **Record in pdf-export:** the result, in its spec 001 (T042 and research R7).
  - **Done, 20 Nov 2026: SC-001, SC-002 and SC-004 met** (the last re-run below). The first
    run did not finish; the second was T019's fault.
  - **Run, 18 Nov 2026, 01:05:22–05:16:37 UTC:** a render container of the
    `websiteangular-render` image with main's `tools/render` mounted (T014's fix in),
    `RENDER_REUSE=on` with T007's defaults (`RENDER_REUSE_MAX` 200,
    `RENDER_REUSE_MEMORY` 0.5), concurrency 4, queue 16, timeout 180 s, 3 GB of memory
    and no swap, 1 GB of shared memory, the release's files; pdf-export's figures step
    with `--parallel 4` against beta's release 98 graph. Concurrency 4 is research R6's
    setting (pdf-export's research R7 notes that T031's was not recorded; T031's summed
    figure times were about four times its elapsed time).
  - **Result: 15,427 of 19,076 figures in 4 h 11 min, then stopped** by the figures
    step's breaker (8 figures in a row unanswered). The report's missing: 35 unanswered,
    10 failed.
  - **The stop was not page reuse.** The figure rate fell from about 04:35 (36 figures in
    the three minutes to 04:40, against about 230 before). Found afterwards: the site
    server (`serve-prod.js`, through which the render page fetches `/ContentService`) had
    piled up about 11,858 connections to the content service, each an abandoned
    request's answer never read, so the content service answered in 5 to 30 s and
    figures timed out. Fixed in #1006. Every figure that failed fell in that slowdown
    (T016).
  - **Health at the end** (`/health` after the step stopped): rendered 15,432, failed 57
    (26 timeouts, 18 "nothing drawn within 60s", 13 "no pathway found"), reused 6,460,
    replaced for failure 1,278, memory 7,715, count 0, build 0, browser 0. **Fewer than
    half the figures (42%) were drawn on a held page.** From 02:00 to 03:16 none were:
    `reused` stayed at 2,617 while `replaced.memory` rose by about 150 every three
    minutes.
  - **Per figure, the median of the render log's times, fresh and held** (different
    figures, not pairs): reaction 3.9 s fresh (7,493) and 1.2 s held (5,598), 3.25 times
    as fast; diagram 6.0 and 3.0 s; illustration 3.8 and 1.2 s.
  - **Peak memory** (the container's `memory.peak`): 2,654 MiB of the 3 GiB limit.
  - **The reuse-off run** started at 05:25 and drew nothing (8 unanswered at once: the
    same content-service slowdown); the time set aside for the runs ended before it
    could be run again. So no byte comparison of the same build either; T009 covered
    identity (#1003). The
    comparison is with pdf-export's reuse-off result: 19,076 figures in 5 h 47 min at
    about four at once (its spec 001: SC-010, T031's run).
  - **Projected:** 14,989 figures in the 3 h 29 min to 04:34:14, before the rate fell,
    is 4,306 an hour; at that rate the 19,076 take **about 4 h 26 min**, about 23% less
    than 5 h 47 min. The best stretch (03:16 to 04:34, 4,577 an hour) gives 4 h 10 min.
    The basis is this run's own rate; the order of the figures is not random, so the
    rest of the book need not draw at that rate.
  - **SC-001 (no more than 2 h 54 min): not met.** Not met as measured, since the run did
    not finish, and the projection (about 4 h 26 min) does not support it either.
  - **SC-002: met for reactions,** 1.2 s held against 3.9 s fresh, by medians over the
    run rather than per reaction.
  - **SC-004: met as far as the run went.** No page passed 200 figures (`count` 0: none
    reached it), the peak stayed under the limit, and no failure was for memory or the
    browser (`browser` 0). Not shown for the full run.
  - **Why the gain is small:** the two replacement rules close most pages early. The
    memory rule (half of a 3 GB container, shared by four pages) was crossed almost
    constantly (7,715 replacements); the failure rule replaces a page on any console
    error, which fresh pages log too (404s for pictures, "Missing graph data for node"),
    as T009 found (1,278). T015.
  - **Re-run, 18–19 Nov 2026,** after T015 with #1006 deployed: main at `c076ccd`
    (T015's rules: `RENDER_REUSE_MEMORY` 0.5, its ceiling), the same container settings,
    the step with `--parallel 4`, then the same build with `RENDER_REUSE=off`.
    - **Both complete, nothing missing or failed:** 19,076 of 19,076 figures each, health
      `failed` 0. Reuse on: **4 h 15 min 22 s**; off: **5 h 52 min 59 s** (the off run
      matches T031's 5 h 47 min). On took 27% less.
    - **Identical:** every one of the 19,076 figures is byte-identical between the two runs
      (sha256 of each file; SC-003 at full scale).
    - **But reuse mostly stopped (T019):** `reused` 3,893, `replaced.memory` 15,170, the
      other reasons 0. From about an hour into the run every page was replaced for memory
      after its figure: the memory share counted the container's file cache (1.24 GiB of
      inactive file cache, an 82% reading for a 44% working set). So this run measures
      T019's fault, not the rules.
    - **Per figure, medians from the render log** (fresh against held; different figures):
      reaction 3.4 s and 0.5 s (12,963 and 3,224), diagram 5.0 and 2.6 s, illustration
      3.3 and 0.7 s. In the off run: reaction 3.9 s, diagram 5.7 s, illustration 3.3 s.
    - **Peak memory** (`memory.peak`) reached the 3 GiB limit in both runs, the file cache
      included, as `memory.current` does; no figure failed.
    - **Projected with reuse working:** with every figure on a held page at this run's
      held means (reaction 0.64 s, diagram 2.89 s, illustration 0.94 s), the book's
      figures sum to about 18,200 s, about 1 h 16 min at four at once, against the same
      sum from the off run's means (82,700 s, 5 h 45 min; measured 5 h 53 min). Not a
      result: SC-001 is shown by T010's next run, after T019.
    - **SC-001: not met as measured** (4 h 15 min against 2 h 54 min). **SC-002: met for
      reactions** (0.5 s held, 3.4 s fresh). **SC-004: met** (no failure, no page past
      its count).
  - **Re-run, 20 Nov 2026, 14:28–16:23 UTC: SC-001 met.** The render container as
    before (`RENDER_REUSE=on`, concurrency 4, queue 16, timeout 180 s, 3 GB of memory
    and no swap, 1 GB of shared memory, the release's files) with main's `tools/render`
    after T019 (#1014) and T020 (#1018) mounted, drawing beta's site built from main after
    #1020; pdf-export's figures step with `--parallel 4` against beta's release 98 graph.
    - **Complete in 1 h 55 min 10 s** (6,910 s; the step's report: complete, nothing
      missing, no stop), against 5 h 47 min (T031) and 5 h 53 min (the reuse-off run of
      18–19 Nov): a third of the time. Health at the end: rendered 19,064, failed 0,
      reused 15,252 (80%), replaced for memory 3,809 and for nothing else.
    - **Identical:** every one of the 19,076 files is byte-identical (sha256) to the
      reuse-off run of 18–19 Nov. That run's build predates #1020, whose fix brings a
      held page's figure to what a fresh page has once its fit ends, so the two agree.
    - **Per figure, medians from the render log** (fresh against held; different
      figures): reaction 3.1 s and 0.4 s (3,230 and 12,957), diagram 5.5 and 2.6 s,
      illustration 3.1 and 0.5 s. The step's own totals, summed over the four at once:
      reactions 16,699 s (1.03 s each), diagrams 3,897 s, figures in an ancestor's diagram
      5,861 s, illustrations 289 s.
    - **Peak memory** (`memory.peak`): 3,072 MiB, the limit, the file cache included (as
      T019 found, the working set is what the rules read); no figure failed, and no page
      was replaced for the browser or for its count.
    - **SC-001: met** (1 h 55 min against no more than 2 h 54 min). **SC-002: met**
      (reactions 0.4 s held, 3.1 s fresh). **SC-004: met** (no page past its count, no
      failure; the memory rule replaced pages 3,809 times, which is it working).
    - **Not in this run:** T009's background-image wait (#1022), found after it. Token
      figures are not in the book, and the book's figures were identical to fresh pages'
      here.
- [x] T015 [US4] Tune the replacement rules (#1008).
  - **Memory:** the share judged per page (the container's share divided by the pages
    held), or a higher share, measured against the 3 GB limit so that SC-004 still holds.
  - **Failure:** replace a page on a page error or a crash, not on a console error that a
    fresh page logs too.
  - **Tests:** each rule seen failing with its change undone.
  - **Then:** T010 again, after #1006 is deployed, and the reuse-off run of the same build
    for the comparison. That run is T010's, still open; this task is the rules.
  - **Failure, built:** `verdict` in `pages.ts` replaces a page for a problem in the page
    (an error thrown and not caught, `pageerror`; or a release file left unanswered,
    `files:`), not for console errors alone (`console:`, the prefix `render-core.ts`
    writes them with, `LOGGED`). A failed or timed-out figure, a crash and a browser
    restart replace the page as before; the figure's answer is today's, and the log line
    still counts console errors.
  - **Console errors are the figure's, not the page's:** every run below logged them for
    the same 53 of the 571 figures, drawn fresh or held (in the first, 32 on fresh
    pages), and nothing else: "Missing graph data for node" (the site's
    `diagram.service.ts`, for a disease reaction drawn in its normal pathway), and
    "Failed to load resource" for a 404. No run had a `pageerror`. So no console error
    is kept as a reason.
  - **Memory, built:** `memoryVerdict`. Past `RENDER_REUSE_MEMORY` a page goes only if it
    has drawn more than one figure and no page went for memory in the last
    `RENDER_CONCURRENCY` figures: one a round, not every page. Past a quarter of the way
    from there to the limit (0.625 of it at 0.5), every page goes, as T007's rule did at
    the bound.
    - Why not per page: nothing measures one page's memory. Its heap is not it (research
      R4), and a renderer process is not tied to its page.
    - A first version replaced the open page that had drawn the most, with the ceiling
      halfway. At 0.5 it peaked at 2,602 MiB (2,162 with the ceiling a quarter of the
      way). At 0.35 it replaced 243 pages: the page that had drawn the most had most
      often drawn two, the others being new, so it churned much as T007's rule did.
  - **Measured, 18 Nov 2026:** 571 figures of release 98 in the book's order (figures
    2,901 to 3,500 of T010's run, repeats dropped: 464 reactions' own layouts, 107
    diagrams and illustrations), each run in a new render container (the
    `websiteangular-render` image with this branch's or main's `tools/render`
    mounted), concurrency 4, queue 16, timeout 180 s, 3 GB and no swap, 1 GB of shared
    memory, the release's files, against beta's site; asked four at a time as the
    figures step asks, one run at a time. Peak is the container's `memory.peak`.

    | Rules                     | Bound | Held       | Memory | Failure | Time   | Peak      |
    | ------------------------- | ----- | ---------- | ------ | ------- | ------ | --------- |
    | T007's (main)             | 0.5   | 416 (73%)  | 100    | 52      | 338 s  | 2,140 MiB |
    | T015's                    | 0.5   | 459 (80%)  | 109    | 0       | 295 s  | 2,312 MiB |
    | T007's (main)             | 0.35  | 248 (43%)  | 270    | 52      | 464 s  | 2,008 MiB |
    | T015's                    | 0.35  | 402 (70%)  | 167    | 0       | 319 s  | 2,108 MiB |
    | T015's failure rule alone | none  | 547 of 562 | 0      | 11      | 245 s  | 3 GiB     |
    | reuse off                 |       | 0          |        |         | (stop) | 1,718 MiB |
    - **At 0.5** the memory count is unchanged on this sample: past the bound, a round's
      page went (85) or the ceiling was passed (24). The gain is the failure rule's: 52
      fewer replacements, 80% held, 13% less time. The peak is 172 MiB higher.
    - **At 0.35,** a bound below what four pages use (T010's case: the container past its
      bound with every page new): T007's rule held 43% and took 464 s; T015's held 70%
      and took 319 s, with 103 fewer replacements for memory (82 for the round, 85 past
      the ceiling) and a peak 100 MiB higher.
    - **No memory rule** (`RENDER_REUSE_MEMORY` 1): the container reached its 3 GiB
      limit, and 9 figures failed ("Target crashed"). A memory rule is needed.
    - **Reuse off** was stopped at 590 s with 510 drawn; it peaked at 1,718 MiB.
    - Beta's site was redeployed between the first runs and the others: T007's rules at
      0.5 were run on both builds (100 and 135 for memory; 73% and 67% held; 2,140 and
      2,089 MiB); the rows above are all the later build but the no-memory-rule run.

  - **Identity of figures drawn after a console error on a held page** (before, they were
    drawn on a new page): `reuse-compare.ts --code tools/render` on 48 requests, 24 of
    the figures above that log console errors (17 reactions, 7 diagrams) each followed
    by one that does not. Listed, reversed and one run of pairs: 192 draws, 0 differ.
    The script exits 1 because one draw in each of two runs was on a new page: a page
    replaced for memory at concurrency 1, not a difference. Only comments in
    `pages.ts` changed between the fresh run and the others.
  - **For T010's run:** the peak is the one to watch. T010 peaked at 2,654 MiB with
    T007's rules; T015's rules ran 100 to 170 MiB higher here, so a full run may come
    near 2.8 GiB of the 3 GiB.
- [x] T016 R-HSA-381753 (a reaction's layout) fails on a fresh page as on a held one: a
      timeout waiting for the figure, or "nothing drawn within 60s". Find whether it is
      the release's data or the render page, and fix it or record it as missing. (#1010)
  - Not reproduced. R-HSA-381753 is a pathway ("Olfactory Signaling Pathway"), drawn as
    its diagram, not a reaction layout; asked for as a reaction layout it is refused at
    once with a 400, by design. On a fresh page it is ready in about 1.3 s (70
    elements, no page errors, every content service answer within 0.5 s).
  - Its failures in T010, and those of the other 16 figures that failed ("nothing drawn
    within 60s", "no pathway found"), all fall in the content service's slowdown that
    #1006 fixed: none failed before it. One of each kind checked again draws (the
    pathway R-HSA-109606, the reaction R-HSA-1299478); T010's re-run covers the rest.
    Nothing is to be recorded as missing from the book.
- [x] T017 When the content service fails or answers slowly, the render page says "no
      pathway found" for pathways that exist (six in T010's slowdown; the give-up in
      `render.component.ts` treats a failed read as an absent pathway). A failed read
      is reported as such ("could not be read"), and only an answer that the pathway is
      not there as "no pathway found". Test: each answer seen with its own message. (#1011)
  - **Cause, confirmed:** the give-up read `currentPathway()`, which is empty for a read
    that failed in any way, so after 3 s every settled read with no pathway was "no
    pathway found". On beta's build, the pathway's read answered 504, 500 or 404 (by a
    route in the browser) each gave "no pathway found for R-HSA-5357769". A slow read
    alone never tripped it (still loading); a read the proxy gave up on did. The render
    service's own check (`describe`) did the same: any refusal of `/data/query/{id}` was
    a 404 "no such pathway".
  - **Now:** the page says "no pathway found" only for a 404 or 410, or an empty answer
    (`render/pathway-failure.ts`), and "could not read pathway {id}: {the request's
    failure}" for any other, with `__renderState.failure` `not-found` or `unreadable`.
    The render service answers the first 404 and the second 502 (any other failure of
    the page stays 500); its check treats only a 404 or 410 as unknown. The same build,
    the same routes: 504 and 500 say "could not read", 404 "no pathway found", none
    draws.
  - **What callers see** for a pathway the content service fails on: before, a 500
    "no pathway found for …" (or a 404 "no such pathway" when the check failed too);
    now a 502 "could not read pathway …". pdf-export's figures client counted the 500
    as `failed` (the page's own failure, not retried, not counted by the breaker) and
    the 404 as `refused`; it counts a 502 as `unanswered`, which the breaker counts.
    content-node's exporters answer any status but 503 as a 500 naming the failure, so
    only the message changes there.
- [x] T018 The render page fetches from hosts other than the site's while it draws: a
      diagram's ChEBI structure images (about 60 for R-HSA-381753) and a structure
      viewer's library from a CDN. Drawing does not wait for them (seen: with them held
      back, the diagram was ready as soon). Decide whether the render service blocks or
      answers them locally, so a release's figures step sends no load outside; if
      blocked, prove the figures are unchanged. (#1036)
  - **Measured, 21 Nov 2026,** on R-HSA-381753's render page: 59 ChEBI structures, the
    font (Roboto, from Google's font host) and the structure viewer's script and
    stylesheet (a CDN). Blocked outright, the page logged 62 console errors ("Failed to
    load resource"), and a page that logs one is replaced (T006): reuse would end. Answered
    with an empty 200, none.
  - **Decided: answered locally** (`tools/render/outside.ts`). A ChEBI structure gets an
    empty answer, which the diagram treats as a structure ChEBI has not got; the
    structures are HTML over the canvas and never in a figure. Anything else is fetched
    once a service and answered from memory. `RENDER_OUTSIDE=allow` lets them through;
    `/health`'s `outside` counts both. Tests seen failing on five mutants (structures
    fetched, nothing kept, a failed fetch kept, the encoding kept, the download site
    taken).
  - **Proof:** `reuse-compare.ts --mode outside` (new: fresh with them let through, then
    fresh with them answered, each run's `/health` checked) on T009's 751 SVG requests
    and 30 PNG, PDF and PowerPoint, plus R-HSA-381753 in three formats: 781 drawn, 0
    differ. The only failures are the 15 highlights on illustrations the service refuses,
    in both runs. The answered run answered 4,707 requests and fetched 13.
- [x] T019 The memory rule read the container's file cache as pages' memory. The
      share it compares with the bound is `memory.current` against `memory.max`, and
      `memory.current` counts the file cache: the figures written to the service's cache
      and the files it reads. In T010's re-run the container read 82% full (2.65 of
      3 GiB), 1.24 GiB of it inactive file cache, a working set of 44%: past T015's
      ceiling, so from its first hour every page was replaced after its figure (3,466
      figures drawn on held pages, then none; 9,644 pages replaced for memory by
      13,110 figures). The share is now the working set, `memory.current` less
      `inactive_file` from `memory.stat`, as the kubelet and `docker stats` count it.
      Test: T010's reading gives 44%, not 82%; seen failing without the change. (#1014)

- [x] T020 The render service slowed through every run of the book, held pages or fresh:
      a reaction of 8 to 14 elements took 2.75 s at the start of T010's reuse-off run and
      about 5.8 s near its end, and held reactions slowed from 0.66 s to 4.6 s in its
      third run. **Cause:** after every write the cache was measured by listing its
      folder and reading each file's size (`evict`), a stat per cached figure, on the
      event loop that also answers the page's requests and while the page was still
      held. Timed on this host: one such scan 96 ms at 1,000 files, 741 ms at 5,000,
      2.7 s at 19,000. **Now** the cache keeps a running total (`cache-total.ts`): the
      folder is read once, again every 1,000 writes, and by an eviction, which sets the
      total it leaves. **Measured:** the same 120 reactions, 4 at once, with 19,000
      figures already in the cache: 213.6 s before (6.99 s a figure, as logged), 33.0 s
      after (0.98 s). Test: the folder is read once for three writes, a replaced file's
      size comes off, every so many writes it is read again, an eviction's total is
      kept; each fails when the folder is read on every write. (#1018)
  - **T010's third run (19–20 Nov, T019 in, reuse on):** complete, 19,076 figures, no
    failures, 4 h 18 min; every figure byte-identical to the second run's. Reuse held:
    14,529 figures on held pages (76%), 4,531 replaced for memory. Not faster, because
    of this task's fault: every kind slowed through the run (reaction held 0.67 s in its
    first 2,000 figures, 4.1 s by its 16,000th). T010 runs again after this task.

## Dependencies

- T001 gates everything.
- T011 comes before T002's run on a real sample.
- T011's exemption for reactions whose layout Java varies stays until spec 006 T092
  is done; that task, not this spec, removes it.
- T002 comes before T003–T008, so each is checked by it.
- T003 → T004.
- T005 → T006 → T007 → T008.
- T012 before T009.
- T013 at any time; it gates pdf-export's spec 002 T019 and T020.
- T009 needs T004, T008 and T012, and T010 needs T009.
- T010 is run again after T015, with #1006 deployed, and ticked on that run; its
  first re-run measured T019's fault and its second T020's, so it runs once more after T020.
- T014 (found by T009) before T009's switch of the default.
- T003 and T005 can run in parallel.
