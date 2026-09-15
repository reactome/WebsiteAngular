# Tasks: Interactor confidence filtering and download

**Feature**: `specs/001-interactor-confidence-filter` | **Plan**: [plan.md](./plan.md)

Three independently deliverable slices, in priority order. **US1 alone closes the
blocked checklist row** and is the MVP; US2 and US3 each add value without
needing the next.

## How to read the red-first tasks

Constitution principle III: a test never seen fail describes the fix rather than
guarding it. Both checklist rows are currently **missing**, so every e2e case
here can be shown red simply by running it against `main` before the code exists.
Each such task says to record the failure text in the commit. _Recorded_ means
pasted, not asserted.

---

## Phase 1: Setup

- [x] T001 Create the feature directory `projects/pathway-browser/src/app/interactors/interactor-threshold/` per plan.md's structure decision
- [x] T002 Capture the worked-entity baseline: run the `curl` in [quickstart.md](./quickstart.md) against the local ContentService and record the interaction count and score range for Q13158 in the implementation commit, so every later figure is one measured today rather than copied from this plan

---

## Phase 2: Foundational (blocks every story)

**Nothing in Phase 3+ can be asserted until the graph can be counted and the
threshold exists.**

- [x] T003 [P] Add `clampThreshold(raw: unknown): number` to `projects/pathway-browser/src/app/interactors/interactor-threshold.ts` — returns 0.45 for anything unparseable, negative or above 1, per data-model.md's clamping rule
- [x] T004 [P] Add `passesThreshold(interaction, threshold): boolean` to the same file — `score >= threshold`, and **an interaction with no score is hidden**, per data-model.md's validation rule
- [x] T005 Add `interactor-threshold.spec.ts` beside it covering both: the clamp against the hand-edited addresses FR-008 names (`banana`, `-1`, `2`, `''`), and the missing-score rule. Unit-testable without a browser, the pattern `url-state.service.spec.ts` uses
- [x] T006 Add `interactorScore: urlParam<number>(0.45, 'number')` to the `values` object in `projects/pathway-browser/src/app/services/url-state.service.ts`, with a comment citing `DEFAULT_SCORE` in `InteractorsContent.java` as the source of 0.45 and noting that FR-007 comes from `currentQueryParams()` skipping a value equal to its initial
- [x] T007 Expose it as `public readonly interactorScore = this.values.interactorScore;` beside the other params in the same file

**Checkpoint**: `npm test` green, `check:types` green. `check:dead` will complain
about the two new exports until T009 imports them — expected, and resolved within
the same story rather than by raising the baseline.

---

## Phase 3: User Story 1 — narrow the interactors on the diagram (P1) 🎯 MVP

**Goal**: raising the threshold removes interactions below it from the diagram,
lowering it brings them back.

**Independent test**: open a pathway, show interactors for Q13158's entity, count
interactor nodes on the graph, raise the threshold, count again.

- [x] T008 [US1] Write `e2e/interactor-threshold.spec.ts` with the US1 cases from [quickstart.md](./quickstart.md) Scenario 1, asserting on `cy.elements('.Interactor').length` — **not** on the control, and performing both steps (choose a resource, then click an occurrence node) because the first alone draws only badges. Run it against `main` first and record the failure text in the commit
- [x] T009 [US1] In `projects/pathway-browser/src/app/interactors/services/interactor.service.ts`, apply `passesThreshold` when drawing interactor nodes, reading the threshold from `UrlStateService.interactorScore`
- [x] T010 [US1] Make a threshold change restyle rather than refetch or re-layout — toggle visibility on elements already on the graph, per plan.md's performance goal (SC-005)
- [x] T011 [P] [US1] Create `interactor-threshold.component.ts/.html/.scss` in the directory from T001: a Material slider `min=0 max=1`, a `[data-threshold]` attribute carrying the value in force, and the empty state FR-012 requires
- [x] T012 [US1] Render it in `projects/pathway-browser/src/app/viewport/viewport.component.html` beneath the diagram, with `@if` on interactors being shown; add the backing field to `viewport.component.ts`
- [x] T013 [US1] Decide "interactors are shown" by reading the graph for interactor nodes, not `currentResource()` — research.md §6 leaves this open and principle I settles it
- [x] T014 [US1] Verify SC-002 by hand against the quickstart's worked entity: the count on the graph equals the number of interactions at or above each threshold tried

**Checkpoint**: US1 is shippable. `RELEASE-TESTING.md:117` can move to **auto**.

---

## Phase 4: User Story 2 — keep and share the view (P2)

**Goal**: the threshold survives a reload and travels in a shared address.

**Independent test**: set a threshold, copy the address, open it fresh, count.

- [x] T015 [US2] Add the US2 cases from quickstart Scenario 2 to `e2e/interactor-threshold.spec.ts`, including the **absence** assertion — at 0.45 the address must not name `interactorScore` — and the `banana` case from FR-008. Run against `main` first and record the failure
- [x] T016 [US2] Wire the control's changes through `UrlStateService.interactorScore` rather than local component state, so the URL is the source of truth (research.md §5)
- [x] T017 [US2] Apply `clampThreshold` when reading the param, so a hand-edited address opens the pathway rather than blocking it (FR-008)
- [x] T018 [US2] Add the per-resource `Map<string, number>` to `interactor.service.ts` and write the remembered value into the param when the resource changes (FR-004a)
- [x] T019 [US2] Add the resource-memory case from quickstart Scenario 3 to the e2e spec
- [x] T020 [US2] Clear the param when interactors are cleared (FR-013), and assert it in the e2e spec

**Checkpoint**: US1 + US2 shippable together.

---

## Phase 5: User Story 3 — take the interactors away (P3)

**Goal**: download exactly what is on the diagram.

**Independent test**: filter, download, compare the file's row count with the
graph's interactor count.

- [x] T021 [P] [US3] Add `interactorsToTsv(rows): string` to `projects/pathway-browser/src/app/interactors/interactor-export.ts` — header and column order from data-model.md's Export row
- [x] T022 [P] [US3] Add `interactor-export.spec.ts`: header order, one row per interaction, a tab-free field, and an empty set producing a header and nothing else
- [x] T023 [US3] Add the US3 cases from quickstart Scenario 4 to the e2e spec, asserting the **row count equals the graph's interactor count**. Run against `main` first and record the failure
- [x] T024 [US3] Add the download control beside the threshold control in the component from T011, naming the file `Interactors [<stId>] [<resource>].tsv`
- [x] T025 [US3] Revoke the object URL after use — the existing `molecule-download-table` export does not, and research.md §4 says not to copy that

**Checkpoint**: all three stories shippable. `RELEASE-TESTING.md:118` can move to
**auto**.

---

## Phase 6: Polish and the documents

- [x] T026 Move `RELEASE-TESTING.md:117` from **missing** to **auto**, naming `e2e/interactor-threshold.spec.ts`. Do not mark it auto unless that spec actually asserts it
- [x] T027 Move `RELEASE-TESTING.md:118` from **missing** to **auto**, same spec, same condition
- [x] T028 Remove the two matching gaps from `CURATOR-REPORT.md:225-229` — "No confidence threshold for interactors" and "No interactor download"
- [ ] T029 Run the full gates: `npm test && npm run check:types && npm run check:lint && npm run check:dead && npm run format:check && npm run e2e`. `check:lint` must not exceed 653 and `check:dead` must not exceed 146; if either rises, fix the cause rather than the baseline
- [ ] T030 Rebuild beta from the merged main and confirm the feature through Apache, not only on localhost — the dev server and beta have disagreed before

---

## Dependencies

```
Setup (T001-T002)
  └─> Foundational (T003-T007)   ← blocks everything
        ├─> US1 (T008-T014)      ← MVP, closes RELEASE-TESTING:117
        │     └─> US2 (T015-T020)  needs the control to exist
        │           └─> US3 (T021-T025)  needs a filtered set to export
        └─> Polish (T026-T030)
```

US2 depends on US1 only for the control; US3 depends on US2 only in that its
"exactly what is shown" assertion is more meaningful once filtering is shareable.
Each is independently demonstrable.

## Parallel opportunities

- T003 and T004 — same file, different functions, no shared state
- T011 alongside T009/T010 — the component's markup does not depend on the service change
- T021 and T022 — pure module and its spec
- T026, T027, T028 — three documents, no overlap

## MVP

**US1 alone.** It closes the row a curator is blocked on, and a threshold that
does not survive a reload is still a threshold that works. Ship it before US2 if
time is short.

## The ratchets

`check:dead` counts an exported symbol nothing imports. T003, T004 and T021 each
add one, and each is imported within its own story — so run `check:dead` at the
**story** checkpoint, not after every task, and never raise the baseline to make
it pass.
