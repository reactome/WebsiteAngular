# Implementation Plan: Interactor confidence filtering and download

**Branch**: `001-interactor-confidence-filter` | **Date**: 2026-09-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-interactor-confidence-filter/spec.md`

## Summary

Give the interactor overlay a confidence threshold and an export, which are the
two rows of the curator release checklist (`RELEASE-TESTING.md:117-118`) that
cannot be signed off because the behaviour does not exist here.

Both are additions to machinery that already exists. The scores are already
fetched and already displayed in the interactors table; the interactions are
already held on the cytoscape node that owns them
(`occurrenceNode.data('interactors')`), so filtering and export are both
in-memory. Nothing new is fetched, and no service contract changes.

The threshold goes in the URL, because `UrlStateService`'s reader resets any
param the URL does not mention — a signal alone does not survive the turn, let
alone a reload. Declaring it with an initial value of `0.45` gets FR-007 free:
`currentQueryParams()` omits a value equal to its initial, so a threshold nobody
changed is absent from the address rather than written into it.

## Technical Context

**Language/Version**: TypeScript 5.x, Angular 21 (zoneless, signals, `strictTemplates`)

**Primary Dependencies**: cytoscape (the diagram), Angular Material (the control), existing `InteractorService` and `UrlStateService`

**Storage**: none. The threshold lives in the URL; per-resource memory is a `Map` in the service for the session only, matching the old browser, which also forgets on reload.

**Testing**: vitest for units, Playwright for e2e (`npm run e2e`, project `code`)

**Target Platform**: the browser, same as the rest of the pathway browser

**Project Type**: feature inside an existing Angular workspace — no new project

**Performance Goals**: dragging the control must not make the diagram
unresponsive (SC-005). Filtering is a class or style toggle over elements already
on the graph, so the cost is cytoscape's restyle, not a re-layout or a fetch.

**Constraints**: the six quality gates, with two ratcheted baselines — `check:lint` 653 and `check:dead` 146 — which a new component must not raise.

**Scale/Scope**: one new component, one new URL param, one export function, plus
changes to the interactor service. Measured worst case in the data: 33
interactions on a single entity; a diagram may show several entities' at once.

## Constitution Check

| Principle                                                | How this plan satisfies it                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Verify the instrument**                             | Every assertion counts interactors **on the diagram**, never the control's position or the param's value. "Interactors are shown" is read from the graph holding interactor nodes, not from `currentResource()` being set, because the graph is what the reader sees. |
| **II. Measure in the running app**                       | The threshold is URL state, and URL state has twice behaved in ways invisible from the source (#185, #191). Every acceptance scenario gets an e2e case; unit tests cover only the pure parts (the filter predicate, the TSV shape).                                   |
| **III. Prove a test fails first**                        | The two checklist rows are currently **missing**, so each new e2e case must be shown red against `main` before the feature exists — that is the cheapest possible "prove it fails", and it is recorded per task.                                                      |
| **IV. Never leave a reader on an unstable id**           | The export names its entity by stable id; the threshold param carries a number, no ids. Nothing here introduces a dbId.                                                                                                                                               |
| **V. Comments carry the failure, with measured figures** | The only figures that appear in code comments are 0.45 (from `InteractorsContent.java`) and the 0.482–0.98 range (measured for Q13158). Both are cited where used.                                                                                                    |

**Gate result: pass.** No violations to justify; Complexity Tracking below is empty.

One deviation from the input brief, recorded rather than silently taken:
`FileDownloadService` / `ManagedDownloadDirective` are **not** reused. They exist
for server downloads — progress, cancellation, a 180s ceiling, a failure reason
from a response. The export is synchronous and in-memory, so those states cannot
occur, and wiring them in would add a spinner that never spins. See research.md
§3, which also records the consequence for FR-011.

## Project Structure

### Documentation (this feature)

```
specs/001-interactor-confidence-filter/
├── spec.md
├── plan.md            # this file
├── research.md        # Phase 0
├── data-model.md      # Phase 1
├── quickstart.md      # Phase 1
├── contracts/
│   └── ui-contract.md # Phase 1 — the UI surface, there being no new service API
└── checklists/
    └── requirements.md
```

### Source code (repository root)

```
projects/pathway-browser/src/app/
├── interactors/
│   ├── interactor-threshold/            # NEW: the control
│   │   ├── interactor-threshold.component.ts
│   │   ├── interactor-threshold.component.html
│   │   └── interactor-threshold.component.scss
│   ├── interactor-export.ts             # NEW: pure — rows to TSV
│   ├── interactor-export.spec.ts        # NEW
│   ├── interactor-threshold.ts          # NEW: pure — the filter predicate + clamping
│   ├── interactor-threshold.spec.ts     # NEW
│   └── services/interactor.service.ts   # CHANGED: per-resource thresholds, apply the filter
├── services/url-state.service.ts        # CHANGED: one new param
└── viewport/
    ├── viewport.component.html          # CHANGED: render the control under the diagram
    └── viewport.component.ts            # CHANGED: whether to show it

e2e/
└── interactor-threshold.spec.ts         # NEW

RELEASE-TESTING.md                       # CHANGED: :117 and :118 missing -> auto
CURATOR-REPORT.md                        # CHANGED: drop the two matching gaps
```

**Structure Decision**: the feature lives beside the interactor code it extends,
under `projects/pathway-browser/src/app/interactors/`. The two pure modules are
separate files so they can be unit-tested without a browser — the pattern
`url-state.service.spec.ts` uses for `FRAGMENT_PATTERN` and `isContentRoute`.

## Complexity Tracking

No constitution violations, so nothing to justify here.

## Phase status

- [x] Phase 0 — research.md: the five decisions, all evidenced
- [x] Phase 1 — data-model.md, contracts/ui-contract.md, quickstart.md
- [ ] Phase 2 — tasks.md, by `/speckit-tasks`
