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
- [ ] T012 [US2] What T002's first `reuse` run found (#957 records it).
  - **The overview's label leak:** found and fixed in the render page, or the page replaced
    when the species changes, with the pair (mouse overview, then the default) passing.
  - **Fresh renders that vary:** an illustration with a token, and highlights, made
    repeatable as T011 made reactions, and the fresh twice-over test extended to them.
- [ ] T006 [US3] Replacement on failure, timeout or browser problem, and on a browser
      restart (data-model Replacement).
  - **Tests:** each reason closes the page, and the next figure is drawn on another; the
    failed request's answer is today's.
- [ ] T007 [US4] Replacement by count, by the container's memory and by build, with the
      defaults from T001 (`RENDER_REUSE_MAX` 200, `RENDER_REUSE_MEMORY` 0.5).
  - The site's build is read from the render page's HTML at `RENDER_BASE`, at most once
    a minute (research R3).
  - **Measure first:** heap and document nodes over 2,000 figures on one page, to set
    `RENDER_REUSE_MAX` (R4 result).
  - **Tests:** each rule, seen failing with it removed.
- [ ] T008 [US1] The health additions (contracts/health.md) in `service.ts`, and the
      settings in the service's header comment and its README (`tools/render/README.md`).
  - **Tests:** health with reuse on and off; every existing field unchanged.

## Phase 5: Proof and the release run

- [ ] T009 [US2] SC-003 and SC-005.
  - **Run:** the comparison on 500 or more requests, three orders, every format, through
    a reuse-on and a reuse-off service built from main.
  - **Mutants:** run each mutant of research R5 and record that it fails.
  - **Then:** turn `RENDER_REUSE` on by default.
- [ ] T010 [US1] SC-001, SC-002 and SC-004: pdf-export's figures step for release 98 with
      T031's settings (research R6).
  - **Record here:** the time, the health counters, the container's peak memory and the
    comparison with a reuse-off run of the same build (research R6).
  - **Record in pdf-export:** the result, in its spec 001 (T042 and research R7).

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
- T003 and T005 can run in parallel.
