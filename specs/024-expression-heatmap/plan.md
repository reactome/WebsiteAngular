# Implementation Plan: An Expression Heatmap of the Selection's Own Genes

**Branch**: `spec/024-expression-heatmap` | **Date**: 2026-11-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/024-expression-heatmap/spec.md`

## Summary

The Expression tab stops embedding Expression Atlas's widget, which ignores the genes it is asked about. Instead it draws a heatmap of its own, from a new node-only endpoint, `GET /ContentService/expression/{id}`:

- **Resolving the genes**: the content service matches the selection's proteins to their genes from the graph, with Reactome's own `referenceGene` (98.96% of human gene products in the experiment, 99.57% with a gene-name fallback).
- **The values**: it looks the genes up in Expression Atlas's published tissue table for the selection's species, held in memory, and orders them so genes expressed alike sit together.
- **The answer**: the rows, the genes not shown and why, and the experiment's attribution.
- **Refreshing**: the tables are not committed. A checked refresh script writes them into a read-only mount, as the release's diagram files are.
- **Species**: human first (E-MTAB-2836, 29 tissues). Six other species follow from a hand-kept list of tissue experiments. Every other species says expression is not available.

## Technical Context

**Language/Version**: TypeScript. Node 24 for the content service and the refresh script (`tools/`, under `noImplicitAny`); Angular for the Pathway Browser.

**Primary Dependencies**: the content service's existing stack (Express 5, the Neo4j driver); Angular and Angular Material in the site. No new runtime dependency: the heatmap is drawn on a canvas by our own component (research R7).

**Storage**: one JSON file per experiment in a read-only data directory mounted into the content service (`EXPRESSION_FILES`), loaded lazily and held in memory. The human file is about 25 MB (research R5).

**Testing**:

- vitest, for matching, ordering, the refresh script's checks, the endpoint on a fixture table, and the contract;
- Playwright e2e with HAR-recorded answers;
- `deploy/nginx/routes.spec.ts` and `test-config.sh`.

**Target Platform**: the content service's Docker image on Linux; current desktop browsers.

**Project Type**: web application (site + service) in the existing monorepo.

**Performance Goals** (SC-004):

- a 100-gene pathway's heatmap within 2 s of opening the tab;
- a 2,500-gene pathway's within 5 s, without freezing the page;
- server-side ordering of 2,500 rows within the request budget, to be measured.

**Constraints**:

- no third-party request when the tab is used;
- nothing loaded for readers who never open it;
- values exactly as published;
- the repository is public, so no data tables or server paths are committed;
- request lines stay under nginx's default 8 KB, which is why the endpoint takes an id, not gene ids.

**Scale/Scope**:

- about 61,900 human genes × 29 tissues × 5 values per experiment, and 7 species planned;
- selections from 1 to about 2,500 genes;
- one endpoint, one component, one refresh script.

## Constitution Check

_GATE: must pass before Phase 0 research, and again after Phase 1 design._

| Principle                     | How this plan meets it                                                                                                                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Verify the instrument      | The refresh step checks its own output before writing: counts, quantile order, 20 cells against the source, and a round-trip. It refuses a mutated fixture (R4). SC-003 compares a live answer with the published table.                                              |
| II. Measure in the thing      | The sizes, coverage, tissue counts and species list in research.md were measured on the real files and the live services, and the spec's 27 was corrected to the measured 29. Memory per species and ordering time are to be measured in implementation, not assumed. |
| III. Prove a test fails       | Each new unit and e2e assertion is shown to fail with its code undone or mutated, as in PRs #910 and #911.                                                                                                                                                            |
| IV. No unstable identifier    | Genes are keyed by versionless Ensembl gene ids. The experiment is named by its accession. Each row says which Reactome entities (stable ids) it came from.                                                                                                           |
| V. Comments carry the failure | Comments state why: Atlas ignoring genes, the 8 KB request line, the SOD2 id change. Figures in comments are the measured ones.                                                                                                                                       |

**Gate (pre-research)**: PASS. **Gate (post-design)**: PASS. There are no violations, so Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/024-expression-heatmap/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R9
├── data-model.md
├── quickstart.md
├── contracts/
│   └── expression-endpoint.md
├── checklists/
│   └── requirements.md
└── tasks.md             # next: /speckit-tasks
```

### Source Code (repository root)

```text
projects/contract/
├── expression.ts                       # ExpressionAnswer and its parts (types only)
└── routes.ts                           # + 'GET /ContentService/expression/{id}'

tools/content-node/
├── expression-endpoints.ts             # the family: one GET route, samplesOnly
├── expression-genes.ts                 # shared leaf: matching rules (R2), pure
├── expression-order.ts                 # shared leaf: row order (R6), pure
├── expression-data.ts                  # shared leaf: loads and validates an experiment file
├── snapshot-expression.ts              # refresh step (R4), entry-guarded
├── expression-species.json             # the hand-kept species → experiment list (R8)
├── fixtures/expression-fixture.json    # ~20 genes × human tissues, cut by the refresh step
├── registry.ts, parameters.ts, fixtures/route-order.json   # + the new family
└── *.spec.ts                           # one beside each module

deploy/
├── nginx/common/routes-core.conf       # + expression location → node
└── content-node/ (compose)             # + EXPRESSION_FILES read-only mount

proxy.conf.js                           # + expression row → content node

projects/pathway-browser/src/app/details/tabs/expression-tab/
├── expression-tab.component.*          # rewritten: fetches the answer, no widget
├── expression-heatmap/                 # canvas heatmap, labels, legend, focus grid
└── expression-download.ts              # the shown table as TSV (FR-009)

e2e/
├── pathway-browser.spec.ts             # Expression tab scenarios (R9)
└── support/backend.ts                  # the CDN font host removed
```

**Structure Decision**: the existing monorepo layout. The endpoint is a new content-node family (spec 014's rules); the answer type is a contract module (spec 016's rules); the UI stays in the Expression tab's folder.

**Delivery order**, each step a pull request:

1. **Contract and pure leaves**: matching, ordering, the data loader and the refresh script, with the fixture.
2. **The endpoint family and its routing**: nginx, proxy, parameters, route order, openapi.
3. **The tab**: heatmap, hover, legend, dark mode, not-shown list. The widget is removed.
4. **Download** (User Story 4).
5. **Further species**, one per pull request, each after its coverage is measured (User Story 5).

## Complexity Tracking

None.
