# Implementation Plan: The content service in modules, then on Express 5

**Branch**: `spec/014-content-service-modules` | **Date**: 2026-10-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/014-content-service-modules/spec.md`

## Summary

`tools/content-node/service.ts` is 8,982 lines, holding 88 endpoints and 206 top-level declarations. It is cut into:

- eleven family modules (twelve, with search in two);
- six shared modules by concern, layered so that no family imports another;
- a registry that keeps today's order;
- a server module.

The order matters for 15 pairs of routes, all within a family (research R3).

One preparatory change breaks the only cycle the cut would create. That cycle is the release, which three helpers look up through the endpoint list (R2).

Then each family moves in its own pull request. Two new checks make each move provable:

- every moved declaration and endpoint is unchanged (R6);
- the ratchets' totals never rise (R5).

Each move is deployed to beta and its answers compared. After the split, both Express services move to version 5. The render service keeps its query parser, so its answers stay the same. Both are re-verified against Java and against themselves (R7).

## Technical Context

- **Language/Version**: TypeScript run by Node 24's type stripping, with no build step (spec 013 R1).
- **Primary Dependencies**: Express 4.22.3, moving to 5; neo4j-driver; the services' own leaves (`graph`, `domain`, `solr`, `parameters`, …).
- **Storage**: N/A. The graph database and Solr are read as before.
- **Testing**: vitest (`tools/**`); the parity harness against Java (`tools/content-node/diff.ts`); the invalid-input corpus; the end-to-end suite; before-and-after captures on beta.
- **Target Platform**: the content-node and render images (`node:24`), on beta.
- **Project Type**: a web service, refactored, plus a library upgrade.
- **Performance Goals**: unchanged. Module boundaries add no work per request.
- **Constraints**:
  - Every answer byte-identical.
  - No logic edit in a move.
  - Ratchets only down.
  - Verification load on the shared graph database small, sequential and spaced.
  - Public repository.
- **Scale/Scope**: 8,982 lines become about 20 modules, none over 1,500 lines. There are 88 endpoints and two services to upgrade.

## Constitution Check

| Principle                                     | How this plan meets it                                                                                                                                                                                                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Verify the instrument                      | The move check and the totals check are themselves shown failing on a planted change before they are trusted. The order test is built from the measured 15 pairs (a first measurement that filled every variable alike found 13; segment by segment there are 15), not from a belief about which routes collide. |
| II. Measure in the thing                      | The cut, the pairs, the fields and Express 5's reach were measured on the file and the loaded list (research). Each move is measured on beta, before and after.                                                                                                                                                  |
| III. Prove a test fails first                 | Five new checks, each shown failing (quickstart).                                                                                                                                                                                                                                                                |
| IV. No unstable identifier left to the reader | Not touched: no answer changes.                                                                                                                                                                                                                                                                                  |
| V. Comments carry the failure                 | Comments move with their code, unchanged (the move check compares them too). New modules get a header saying what they hold and what they may import.                                                                                                                                                            |
| Quality gates                                 | Unchanged, plus the totals check in CI and preflight. The per-module ratchets follow moved code through `--update` in the same pull request, and the totals check holds the line.                                                                                                                                |

No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/014-content-service-modules/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R8, measured
├── data-model.md        # Endpoint, family, shared module, registry, server
├── quickstart.md        # checking a move and the upgrade; each new check seen to fail
├── contracts/
│   ├── boundaries.md    # what may import what
│   └── checks.md        # what the move, totals and order checks report
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
tools/content-node/
├── service.ts           # shrinks to nothing as families move; then removed (the image's CMD runs server.ts)
├── server.ts            # start-up, routing, path rules, download guard, failure answers, /health
├── endpoint.ts          # the Endpoint, Handler, Answer and Request types (a leaf)
├── registry.ts          # the families' lists, in today's order
├── release.ts           # the release, answered once (R2)
├── java-text.ts  body.ts  spring.ts  answers.ts  objects.ts      # shared, layered (R1)
├── reference-entities.ts  search-params.ts                        # shared by two families
├── data-query-endpoints.ts  pathways-events-endpoints.ts  content-endpoints.ts
├── person-endpoints.ts  entities-endpoints.ts  mapping-species-endpoints.ts
├── schema-endpoints.ts  interactors-endpoints.ts  exporters-endpoints.ts
├── citation-endpoints.ts  search-endpoints.ts  search-diagram-endpoints.ts  # the families
└── (existing leaves unchanged: graph, domain, solr, parameters, schema, …)
scripts/
├── check-move.mjs             # R6
└── check-baseline-totals.mjs  # R5
deploy/content-node/Dockerfile # CMD → server.ts, once service.ts is gone
```

**Structure Decision**:

- Families sit beside the existing modules in `tools/content-node/`. A subdirectory would change every import of the existing leaves and the image's copy for no gain.
- Every family module is named `<family>-endpoints.ts`: `schema.ts` (the model's class table) and `citation.ts` (the citation formatter) already exist, and one rule for every family is clearer than renaming two.

## Order of work

1. **Instruments**, before any move:
   - the move check;
   - the totals check (in CI and preflight);
   - the boundary test;
   - the order test over today's list.

   Each is seen to fail.

2. **The release without the list**: the one logic edit; `release.ts` itself comes with layer 6. Verified on beta like a move.
3. **The `Endpoint` type** (`endpoint.ts`, a leaf, so families and `answers` can use it without importing the registry), in the same pull request as step 2, with `service.ts`'s list typed as `Endpoint[]` in place. The casts in the tools go.
4. **Shared modules**, bottom layer first: `java-text`, `body`, `spring`, `answers`, `objects`, then the pair-shared two. Each is a move pull request.
5. **Families**, least coupled first, one pull request each:
   1. citation
   2. content
   3. person
   4. schema
   5. interactors
   6. exporters
   7. entities
   8. mapping-species
   9. data-query
   10. pathways-events
   11. search
   12. search-diagram
6. **`server.ts`**: what is left. `service.ts` is removed and the image's CMD changed. The end-to-end suite runs in full.
7. **Express 5, content service.** Wrappers removed; the URIError path re-measured; everything in R7 re-verified against Java.
8. **Express 5, render service.** The query parser kept as "extended". Its refusals and a few figures checked on beta.

Spec 013's Phase 5 resumes on the content service after step 6, one family module at a time.
