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

- [ ] T011 [US2] Fresh renders repeatable (research R7), in the render page.
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
      reactions exempt fails the test, so a growing list stops it rather than passing
      unnoticed. (So far a varying layout has been seen for one reaction, and for none
      of the 99 fetched three times each in research R7.)
    - **T011 is ticked** when the test passes with that exemption, so T002 can go on.
      Removing the exemption is part of spec 006 T092: it is done when this test
      passes with none.

- [ ] T002 [US2] The comparison script `tools/render/reuse-compare.ts` (research R5).
  - **What it does:** draws the sample through two services, three orders, and compares
    SVG by bytes and the other formats after their named variation.
  - **Tests in `tools/render/reuse-compare.spec.ts`:** it fails on a planted difference,
    and its report names the request and the request drawn before it.
  - Run on T001's prototype to see it work before anything is built.

## Phase 3: The render page (US1, US2)

- [ ] T003 [US2] The render page's entry point (contracts/render-page.md).
  - **Files:** `render-navigation.ts`; the route reuse strategy in
    `app-routing.module.ts`; `nav` and `build` in `__renderState` and `data-render-nav`
    in `render.component.ts`.
  - **Tests:** a second navigation recreates the component, and its readiness carries
    the new `nav`. A non-render address is refused. The page's own address rewrite
    after drawing keeps the component (R4 result, 1).
- [ ] T004 [US2] The state of research R2's table, each row settled. A leak found is
      fixed in the render page:
  - the readiness wait cancelled on destroy, its queries scoped to its own host, and
    `__renderState` cleared at construction (R2 audit 2);
  - the species reset when `species=` is absent (audit 3);
  - an analysis load failure cleared when the token is absent (audit 4);
  - the interactors' thresholds and the default resource taken from the figure's own
    address (audits 5 and 6);
  - audit 7's three checked, and fixed if R5 shows them;
  - `body` left with no exporter hosts.

  Tests: each R5 order that would show the row.

## Phase 4: The service (US1, US3, US4)

- [ ] T005 [US1] Held pages in `tools/render/pages.ts`, used by `schedule()` in
      `service.ts`.
  - The first figure on a page is a full load; later ones navigate in the app.
  - Behind `RENDER_REUSE` (off is today).
  - The comment above `getBrowser()` that warns against reuse is rewritten to say what
    reuse rests on (research R2).
  - The readiness handle is disposed (R4 result, 2).
  - **Tests in `tools/render/pages.spec.ts`:**
    - no more pages than `RENDER_CONCURRENCY`;
    - no page shared by two figures;
    - off means a fresh page and context each time.
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
- T009 needs T004 and T008, and T010 needs T009.
- T003 and T005 can run in parallel.
