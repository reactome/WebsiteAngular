# Tasks: No lint warnings

**Input**: [spec.md](spec.md), [plan.md](plan.md)

Each task is one pull request. The pull request that completes a task ticks it
here and adds its number. Counts are as measured on 13 Nov 2026.

## Phase 1: The small rules (User Story 1, P1)

- [ ] T001 [US1] Clear the eleven small rules and promote each to `error` in
      `eslint.config.js`: `@angular-eslint/template/button-has-type` (10),
      `@angular-eslint/no-input-rename` (7), `@angular-eslint/no-output-native`
      (6), `@typescript-eslint/no-unused-expressions` (6), `no-useless-assignment`
      (5), `@typescript-eslint/no-namespace` (14), `no-useless-escape` (2),
      `@typescript-eslint/ban-ts-comment` (1), `@typescript-eslint/no-empty-object-type`
      (1), `no-empty-pattern` (1), `prefer-const` (1). May split in two if
      `no-namespace` (the `Analysis`-style namespaces) needs its own review.

## Phase 2: Values typed "anything" (User Story 2, P2)

The five `no-unsafe-*` rules and `no-explicit-any`, area by area.

- [ ] T002 [US2] `projects/reactome-table` (19).
- [ ] T003 [US2] `e2e` (16; its 5 non-null assertions with it).
- [ ] T004 [US2] `projects/reactome-gsa-form` (100).
- [ ] T005 [US2] `projects/website-angular`, first third by folder (~75).
- [ ] T006 [US2] `projects/website-angular`, second third (~75).
- [ ] T007 [US2] `projects/website-angular`, the rest (~78).
- [ ] T008–T013 [US2] `projects/pathway-browser`, by feature folder, about 50
      each (311 in all). Split decided when T007 is done, from a fresh count.
- [ ] T014 [US2] Promote `no-explicit-any` and the five `no-unsafe-*` rules to
      `error` (their counts are zero).

## Phase 3: Asserted values (User Story 3, P3)

- [ ] T015 [US3] `no-non-null-assertion` outside the Pathway Browser (8).
- [ ] T016–T017 [US3] `no-non-null-assertion` in the Pathway Browser (138), in
      two halves; the second promotes the rule to `error`.

## Phase 4: Done

- [ ] T018 Confirm `lint-baseline.json` has no warned rules left, and every
      rule warned on 13 Nov is an error; list the silenced lines (SC-004) and the
      bugs found (SC-005) here.

## Bugs found on the way

_None yet._

## Silenced lines

_None yet._
