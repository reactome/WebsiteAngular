# Tasks: Render page reuse

**Input**: design documents in `specs/018-render-page-reuse/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

Each task is one pull request with its own adversarial review. Every test is seen failing
first (constitution III). The PR that completes a task ticks it here with its number.

## Phase 1: Measure first (go or no-go)

- [ ] T001 Prototype and measure (research R4), on a branch that is not merged.
  - **On the render page:** add `__renderNavigate` and the never-reuse strategy for the
    render routes in `projects/pathway-browser/src/app/render/render-navigation.ts`.
  - **In the service:** add a held page per slot in `tools/render/service.ts`, without
    the replacement rules.
  - **Measure:** time each kind fresh against reused at concurrency 4, through a
    loopback service with `RENDER_FILES` and a scratch site build. Count each page's
    heap and `body`'s children over 2,000 figures.
  - **Record:** the result in research.md R4 (go or no-go), with
    `RENDER_REUSE_MAX` and `RENDER_REUSE_HEAP_MB` chosen.
  - **If no-go:** stop, and record why.

**Checkpoint**: go: reused reactions take at most half their fresh median.

## Phase 2: The comparison first (US2, P1)

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
    the new `nav`. A non-render address is refused.
- [ ] T004 [US2] The state of research R2's table, each row settled. A leak found is
      fixed in the render page:
  - the species reset when `species=` is absent, unless R5 shows nothing drawn reads it;
  - `body` left with no exporter hosts.

  Tests: each R5 order that would show the row.

## Phase 4: The service (US1, US3, US4)

- [ ] T005 [US1] Held pages in `tools/render/pages.ts`, used by `schedule()` in
      `service.ts`.
  - The first figure on a page is a full load; later ones navigate in the app.
  - Behind `RENDER_REUSE` (off is today).
  - **Tests in `tools/render/pages.spec.ts`:**
    - no more pages than `RENDER_CONCURRENCY`;
    - no page shared by two figures;
    - off means a fresh page and context each time.
- [ ] T006 [US3] Replacement on failure, timeout or browser problem, and on a browser
      restart (data-model Replacement).
  - **Tests:** each reason closes the page, and the next figure is drawn on another; the
    failed request's answer is today's.
- [ ] T007 [US4] Replacement by count, by heap and by build, with the defaults from T001.
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
    comparison with T031's figures.
  - **Record in pdf-export:** the result, in its spec 001 (T042 and research R7).

## Dependencies

- T001 gates everything.
- T002 comes before T003–T008, so each is checked by it.
- T003 → T004.
- T005 → T006 → T007 → T008.
- T009 needs T004 and T008, and T010 needs T009.
- T003 and T005 can run in parallel.
