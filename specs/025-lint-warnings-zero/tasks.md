# Tasks: No lint warnings

**Input**: [spec.md](spec.md), [plan.md](plan.md)

Each task is one pull request. The pull request that completes a task ticks it
here and adds its number. Counts are as measured on 13 Nov 2026.

## Phase 1: The small rules (User Story 1, P1)

- [x] T001 [US1] The small rules, cleared and promoted to `error` in
      `eslint.config.js`: `@angular-eslint/template/button-has-type` (10),
      `@angular-eslint/no-input-rename` (7), `@angular-eslint/no-output-native`
      (6), `@typescript-eslint/no-unused-expressions` (6), `no-useless-escape` (2),
      `@typescript-eslint/ban-ts-comment` (1), `@typescript-eslint/no-empty-object-type`
      (1), `no-empty-pattern` (1), `prefer-const` (1), and four of the five
      `no-useless-assignment`. Seven rules already at zero but still at `warn` were
      promoted too (`no-require-imports`, `use-lifecycle-interface`,
      `no-wrapper-object-types`, `no-extra-non-null-assertion`, `no-output-rename`,
      `no-unused-vars`, `template/prefer-control-flow`). Renamed inputs take their
      public names, so no binding changed; the outputs named after DOM events become
      `pressed` (the download button) and `closed` (the analysis forms). 879 → 838.
- [x] T001a [US1] The last `no-useless-assignment`: a bug (see below), fixed with
      a test (`router-url-state.service.spec.ts`), then the rule promoted (#956).
      838 → 835: the dropped line was also an unsafe assignment, and the `tab`
      translation's `!` became `?? null` (an unknown code had set `undefined`).
- [ ] T001b [US1] `@typescript-eslint/no-namespace` (12): the model namespaces
      (`Analysis`, `Search`, `Graph` and others) become modules, then the rule is
      promoted. Two unused ones in the GSA form's `dataset-library.ts` went in T001.

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

- **A legacy query parameter's value is thrown away**
  (`projects/pathway-browser/src/app/services/router-url-state.service.ts`, the
  `otherTransform` line). A parameter given under an old name (`?DTAB=…` for
  `tab`, `?TOOL=AT` for `analysisTab`) is translated, and the translation is
  then dropped, so nothing is set. `#TOOL=AT` is rewritten to `analysisTab`
  before this and worked; `#…&DTAB=…` is passed on under its old name, so it was
  dropped too. Fixed in T001a: the translation is set.
- **Every excerpt ends in "...", cut or not**
  (`projects/website-angular/src/utils/truncateHtml.ts`): the ellipsis is added
  unconditionally; the check meant to add it only when the text was cut did
  nothing (`result;`). The dead check went in T001; the ellipsis is unchanged,
  as fixing it changes what readers see, and waits for a decision.

## Silenced lines

1. `projects/pathway-browser/src/app/services/analysis.service.ts`,
   `noData`: `@ts-expect-error`, because `@types/chroma-js` leaves out
   `Scale.nodata`, which chroma-js has. (It was there before; T001 gave it its
   reason.)
