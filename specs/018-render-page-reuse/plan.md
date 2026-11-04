# Implementation Plan: Render page reuse

**Branch**: `spec018/render-page-reuse` | **Date**: 2026-11-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/018-render-page-reuse/spec.md`

## Summary

The render service keeps one loaded page per concurrency slot and moves it to the next
figure inside the site, with no reload. Each move recreates the render component, so it
reads its parameters at construction exactly as it does on a fresh page.

The render page gains one entry point for this: a window function that navigates within
the app and says when the new figure is ready. The service:

- closes a page after a failure, after a set number of figures, past a memory bound, or
  when the site's build changes;
- keeps today's fresh page per figure behind a setting, which is also the reference
  every reused figure is compared against.

Measured first (research R4), on the service itself, before anything is built.

## Technical Context

**Language/Version**: TypeScript. Node 24 for `tools/render` (spec 013: typed, `noImplicitAny`);
Angular 21 for the render page.

**Primary Dependencies**: Playwright's Chromium (already the service's), the Angular
router.

**Storage**: none new. The figure cache is unchanged.

**Testing**:

- `tools/render/*.spec.ts` under Node's test runner, as the service's tests are today;
- the render page's unit tests under the site's test runner;
- a comparison script for reused against fresh pages (research R5), run by hand and on a
  sample in CI where it fits.

**Target Platform**: the render service's container (Linux, Chromium headless).

**Project Type**: web service and the web page it drives.

**Performance Goals**: release 98's book figures in ≤ 2 h 54 min at four at once
(SC-001). A reaction on a reused page in ≤ half its fresh-page median (SC-002).

**Constraints**:

- byte-identical SVG to a fresh page (SC-003);
- the container's 3 GB limit from T031's run (SC-004);
- the HTTP interface unchanged (FR-007);
- no fallback to another way of drawing (FR-009).

**Scale/Scope**: 19,076 figures a release run; four to eight held pages.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **I. Verify the instrument:** the pilot timed beta's page through Playwright in one
  browser context. The service opens each page with `browser.newPage()`, which makes a
  new context every time, so its pages start with an empty HTTP cache. The pilot may
  therefore understate today's load. R4 times the service itself, by its own log line
  and by the caller's clock, before any number is used.
- **II. Measure in the thing:** R4 prototypes reuse in the service and measures each
  kind of figure at concurrency 4 before the design is built. If reuse does not halve a
  reaction's time there, the plan stops and says so.
- **III. Prove a test fails:** the comparison (R5) must fail on a planted leak. Each of
  these mutants must make it fail:
  - a page left dark;
  - an analysis token left;
  - a species left;
  - a selection left;
  - a component reused rather than recreated.

  Each reuse rule's test must fail with that rule removed.

- **IV. Stable identifiers:** unaffected; the service's routes and answers do not change.
- **V. Comments carry the failure:** comments in the reuse code name what a leak or a
  stale page would draw wrongly.

Gate: passes. Nothing to justify under Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/018-render-page-reuse/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── render-page.md   # the page's in-app navigation entry point
│   └── health.md        # the health answer's additions
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
projects/pathway-browser/src/app/
├── render/render.component.ts      # unchanged reads; announces its navigation id
├── render/render-navigation.ts     # new: window entry point, reuse strategy for render routes
└── app-routing.module.ts           # the render routes recreate their component

tools/render/
├── render-core.ts                  # render() on a fresh page or a held one
├── pages.ts                        # new: held pages, replacement rules
├── service.ts                      # schedule() takes a held page; health counters
├── reuse-compare.ts                # new: reused against fresh, by kind and order (R5)
└── *.spec.ts
```

**Structure Decision**: one held-page module in `tools/render` and one navigation module
in the render page. Both stay small. Nothing outside `tools/render` and the render route
changes.

## Complexity Tracking

None.
