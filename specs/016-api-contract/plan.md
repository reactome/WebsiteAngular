# Implementation Plan: One API contract for the content service and the site

**Branch**: `spec016/api-contract` | **Date**: 2026-10-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/016-api-contract/spec.md`

## Summary

The answers the content service writes and the site reads get one definition each, in a types-only module at `projects/contract/`. The service, the site and the pathway browser import it with `import type`, so nothing new runs or builds (research R1).

The search entry is first: a union of six kinds (event, physical entity, icon, person, interactor, deleted). It is taken from the search indexer's documents, as the service (reproducing Java) writes them, and it replaces the four overlapping types readers use today (R2, R3). The search results, facets and icon entry follow, which closes spec 013's T019.

The OpenAPI 3.1 description is generated from the contract with ts-json-schema-generator and committed, and a test checks it is current (R4). Recorded answers are checked twice, in tests only:

- spec 012's compile-based check, which stays;
- a fast schema check with ajv, driven by the description (R5).

The wire does not change.

## Technical Context

**Language/Version**: TypeScript ~5.9.3. Node 24.22.1 runs the service's `.ts` with type stripping and no build (spec 013); the site and the pathway browser go through the Angular build.

**Primary Dependencies**: ts-json-schema-generator 2.9.0 and ajv 8.20.0 (ajv 2020-12), both new and both dev-only. No runtime dependency is added.

**Storage**: N/A. The generated description is a committed file.

**Testing**:

- vitest 4.1.12;
- spec 012's `tools/api-types` (the compile check over `e2e/har/`);
- the parity comparison and the e2e suite for byte-identity;
- `npm run check:types`, `check:lint`, `check:dead`, and `tools/tsconfig.json`'s type check.

**Target Platform**: the content service image (`deploy/content-node`), which copies only `tools/content-node/` and `tools/package.json`; the site's production build.

**Project Type**: a web application with a service, plus a shared types module.

**Performance Goals**:

- The description generates in about 2 s.
- The schema check runs in about 3 s.
- The compile check is no slower than its 48.6 s today.

**Constraints**:

- No answer changes, byte for byte.
- The contract is types only.
- No validation in served requests.
- Known problems, lint, dead code and loose values never rise.
- No request to the graph database or to Reactome services; this is static work.
- The repository is public.

**Scale/Scope**:

- First target: the search family, with 11,452 of 23,616 known problems, 13 of the 55 routes the site calls, and four reader types.
- Then 23 shared types in 9 model files, then the remaining families, then the analysis service.

## Constitution Check

_GATE: must pass before Phase 0 research, and is re-checked after Phase 1 design._

| Principle                                  | How the plan meets it                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Verify the instrument                   | Both answer checks were first run to reproduce today's counts: 11,452 exactly, and 21 of 24 route and type pairs equal under ajv, with the three differences explained (R5). The generator's discriminator output was reproduced in scratch, not taken from a report. The recordings' gaps (no person entry, no icon entry route, no large id) are named, and the types for those follow the source, recorded as such. |
| II. Measure in the thing                   | Every field kind and kind marker comes from the 8,603 recorded entries and the indexer's source (R2). Each change is deployed and compared before and after on beta.                                                                                                                                                                                                                                                   |
| III. A test fails first                    | Every new check has a named breakage that shows it failing ([contracts/checks.md](contracts/checks.md)).                                                                                                                                                                                                                                                                                                               |
| IV. Stable identifiers                     | Not affected: no URL or link changes.                                                                                                                                                                                                                                                                                                                                                                                  |
| V. Comments carry the failure              | Contract comments say why a field is shaped as it is (text `dbId`, highlight markup, exact longs), with measured figures only.                                                                                                                                                                                                                                                                                         |
| Quality gates                              | Unchanged and all run. `npm test` and the type, lint and dead-code checks cover `projects/contract/` with no configuration change (R1). The ratchets may only fall.                                                                                                                                                                                                                                                    |
| CLAUDE.md: byte-identical, no fallback     | Types only; no answer changes (FR-005).                                                                                                                                                                                                                                                                                                                                                                                |
| CLAUDE.md: new `tools/` code is TypeScript | The generator script and the specs are `.ts`.                                                                                                                                                                                                                                                                                                                                                                          |

**Result**: pass, with no violations, before and after design.

## Project Structure

### Documentation (this feature)

```text
specs/016-api-contract/
├── plan.md
├── research.md          # R1–R8
├── data-model.md        # the search entry's kinds and fields; the answers built on it
├── quickstart.md
├── contracts/
│   ├── module.md        # projects/contract/ and the generated description
│   └── checks.md        # every check, and how each is shown failing
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
projects/contract/                      # NEW: types only (R1)
├── package.json                        # {"type":"module"}
├── README.md
├── scalars.ts                          # Long, EpochMillis, Highlighted
├── search.ts                           # entry kinds, projections, results, facets, icons
├── routes.ts                           # route → answer type, as types
├── openapi.json                        # generated, committed
└── contract.spec.ts                    # types-only + import boundary; no second description

projects/website-angular/src/model/
├── search.model.ts                     # re-exports the contract's search types
└── icon.model.ts                       # re-exports the contract's icon types

projects/pathway-browser/src/app/model/
└── search.model.ts                     # Search.* re-export the contract; EMPTY_RESULTS stays

tools/content-node/
├── search-core.ts                      # searchEntry writes SearchEntry, no unknown
├── search-endpoints.ts, search-diagram-endpoints.ts, …   # import type from projects/contract
└── boundaries.spec.ts                  # + imports leaving tools/ are type-only (syntax tree)

tools/contract/                         # NEW
├── generate.ts                         # contract → openapi.json (ts-json-schema-generator)
└── generate.spec.ts                    # up to date; route table vs registry.ts

tools/api-types/
├── calls.ts                            # TYPES from projects/contract; + /search/icon/{id}
├── schema.spec.ts                      # NEW: ajv over the recorded answers, via openapi.json
└── known-problems.json                 # falls
```

**Structure Decision**: the contract sits under `projects/`, which every check already covers (R1). The generator sits under `tools/`, where new tooling is TypeScript and loaded by `tools/load.spec.ts`. The service keeps its spec 014 layout: families import the contract the way they import the site's types today, type-only, which the extended boundary check holds.

## Order of work

These are the pull requests, in order. Each one is adversarially reviewed, ticks `tasks.md` with its number, and is deployed and compared on beta before the next begins.

1. **The plumbing on the search facets.**
   - Create `projects/contract/` with `scalars.ts` and the facet types (`FacetCount`, `Facet`, `FacetResponse`, `IconFacetResponse`).
   - The site's model files re-export them, and the service imports them from the contract.
   - Add the boundary checks (types only; service imports leaving `tools/` are type-only).
   - Show the rename failing on both sides.
2. **The search entry.**
   - Write the six kinds, `PathwayOfEntry` and the entity type list (checked against the domain snapshot) in `search.ts`.
   - `searchEntry` builds `SearchEntry` with no `unknown`.
   - The site's `SearchEntry` and `IconEntry` and the pathway browser's `Search.Entry` and `Search.Icon.Entry` re-export it.
   - Readers narrow by kind where they read kind-specific fields.
   - Known problems on the search routes fall, measured.
3. **The search answers.**
   - The grouped results, the diagram and species-overview results, the icon results and the icon entry (`/search/icon/{id}`, added to `calls.ts`).
   - Tick spec 013 T019.
4. **The description.**
   - `tools/contract/generate.ts`, `routes.ts` and `openapi.json`.
   - The up-to-date check, and the route table against the registry.
5. **The schema check.** `tools/api-types/schema.spec.ts` with ajv: a union failure counted once, exact longs read with a reviver.
6. **The rest of T019's shared types, family by family.**
   - Families: content lists, schema tables, interactors, person events, locations, flags, citation.
   - The pathway browser's `Interactor` is first split into the answer type and its client extension.
7. **Later families**, the most known problems first: the enhanced query, other forms, the interactors' details, and onward. Then the render service's types and the analysis service's, splitting the analysis model's values from its types first.

## Complexity Tracking

No constitution violations to justify.
