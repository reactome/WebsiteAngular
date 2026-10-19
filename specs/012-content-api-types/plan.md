# Implementation Plan: Content API types checked against real answers

**Branch**: `spec/012-content-api-types` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/012-content-api-types/spec.md`

## Summary

Every content API answer on record is compiled as a value of the type the site reads it as, with the project's own compiler settings, as #540 did for the AnalysisService. A field the type does not declare, a field it requires that the answer lacks, or a value of the wrong kind fails the check, naming the route and the JSON path.

- **The instrument first.** The checked-in table of the site's 75 calls, a source scan that keeps it complete, and the compile check over the recordings' 349 distinct JSON bodies, split into route groups. Until a route's type passes, its known problems are a ratcheted count that may only go down.
- **Then the types**, route by route, until the ratchet list is empty:
  - the `[key: string]: any` index signature comes off every graph type, and site-only state is split out;
  - the graph types are checked class by class against the domain snapshot;
  - each route's real shape is its own named projection where it differs, and the JSOG and dbId identity references are typed;
  - duplicated shapes become one.
- **Gaps** the recordings never reach (the in-depth routes, among others) are recorded from our own service, one request at a time.

No answer changes. Research: [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 5.9 (the site, strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`); the checks are ES modules on Node 24.

**Primary Dependencies**: the TypeScript compiler API (already a dev dependency); vitest. Nothing new.

**Storage**: none. The call table and the known-problems list are code; recorded answers are JSON files beside the checks.

**Testing**: vitest, `// @vitest-environment node`, under `tools/api-types/`. The site's own unit tests and the e2e suite (`E2E_PORT=4330`) for every type change that reaches code.

**Target Platform**: the build and CI (`scripts/preflight.sh` runs the vitest suite).

**Project Type**: web application (Angular, two applications and libraries in one repository); checks as development tools.

**Performance Goals**: each route group's check under 60 s and about 1.2 GB when passing (measured: research R3).

**Constraints**: no answer changes (node stays byte-identical to Java); no guard on API data removed because a type calls it unnecessary; lint and dead-code counts only go down; the recorder reads only our own service, sequentially, at most 40 requests; public repository.

**Scale/Scope**: 75 call sites, 57 JSON route patterns, 47 answer types, 121 graph interfaces, 110 snapshot classes, 349 recorded JSON bodies (24.6 MB).

## Constitution Check

| Principle                     | How this plan meets it                                                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Verify the instrument      | The check's own tests: a removed field, an undeclared field and a wrong kind each fail and name where; a failed import fails (it does not resolve to `any`); every recorded answer is either checked or listed (FR-003), never dropped silently. Counts in the spec were re-measured and corrected. |
| II. Measure in the thing      | Every type change cites the recorded answer or snapshot entry that shows it (FR-009). Shapes and omissions were measured on the recordings, not inferred from Java's classes.                                                                                                                       |
| III. Prove a test fails       | Each check is shown failing on a deliberate mistake before it is trusted; each type fix is shown failing against the old type.                                                                                                                                                                      |
| IV. Stable identifiers        | Not affected: no URL or link changes.                                                                                                                                                                                                                                                               |
| V. Comments carry the failure | Each projection type and each widening says which answer showed it.                                                                                                                                                                                                                                 |
| Quality gates                 | Lint and dead-code ratchets only go down: the two uncalled reads are removed; no `eslint-disable` added.                                                                                                                                                                                            |

Gates pass; no violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/012-content-api-types/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R9
├── data-model.md        # call table, recorded answer, problem, class mapping
├── quickstart.md        # how to run each check and see it fail
├── contracts/
│   └── check-output.md  # what each check reports, and the ratchet file
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
tools/api-types/
├── compile.mjs              # shared: answers → virtual files → diagnostics with JSON paths (from #540)
├── calls.mjs                # the table of the site's content API calls (R1)
├── calls.spec.mjs           # the source scan: every call in the table, every entry in the source
├── answers.mjs              # recordings + corpus → distinct answers by route and type
├── content.spec.mjs         # the compile check, one program per route group, with the ratchet
├── known-problems.json      # route → count of known problems; may only go down
├── snapshot.spec.mjs        # graph types against domain-snapshot.json, class by class (R5)
├── record.mjs               # the corpus recorder (R8)
└── recorded/                # corpus answers
tools/analysis-types/        # #540's check, moved onto compile.mjs

projects/pathway-browser/src/app/model/
├── graph/**                 # graph types: index signature removed; fixes from R5
├── graph/wire.model.ts      # Jsog<T>, ByDbId<T> (R6)
├── projections/**           # named projection types per route where shapes differ (R6)
├── search.model.ts          # moved from search.component.ts, one definition (R7)
└── events-hierarchy.model.ts # moved from reacfoam.service.ts

projects/website-angular/src/...  # readers switched to the one definitions; copied services removed (R7)
```

**Structure Decision**: the checks live in `tools/api-types/`, beside `tools/analysis-types/` and run by the existing vitest configuration (`{src,projects,tools,deploy}/**/*.spec.{ts,mjs}`). Types live in pathway-browser's `model/`, which both applications already import.

## Complexity Tracking

| Choice                                 | Why needed                                                                                              | Simpler alternative rejected because                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A ratcheted known-problems list        | The check must land before every type passes, or the first pull request is the whole feature.           | Landing the check only when everything passes delays the instrument for weeks; skipping failing routes hides them. |
| Route groups as separate programs      | A failing group costs about 7 s/MB; one program over everything would exceed the test timeout and 2 GB. | One program: measured at 80 s and 2.4 GB for 80 failing answers.                                                   |
| `Jsog<T>` and `ByDbId<T>` mapped types | The wire answer has references the site's types do not; the check must see the wire answer.             | Typing only the resolved object: the check cannot write a cyclic object back as a literal.                         |
