# Tasks: An Expression Heatmap of the Selection's Own Genes

**Input**: design documents in `specs/024-expression-heatmap/`: plan.md, spec.md, research.md (R1–R9), data-model.md, contracts/expression-endpoint.md, quickstart.md.

**Tests**: required. The constitution's principle III says to prove a test fails before believing it passes, and every test task below says how to make it fail. A pull request that completes a task ticks it here and adds its PR number, in the same pull request (CLAUDE.md).

**Pull requests** (plan.md, "Delivery order"):

| PR    | Covers                                                                                                                                                                                                                                                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR-A  | Phases 1–2: contract, pure leaves, refresh step, fixture, and the endpoint family with its routing. One pull request, because the leaves have no users until the endpoint exists, and the dead-code ratchet never lets that count rise (measured: 104 → 112 with the leaves alone). |
| PR-C  | Phases 3–5: the tab, for User Stories 1–3                                                                                                                                                                                                                                           |
| PR-D  | Phase 6: download, User Story 4                                                                                                                                                                                                                                                     |
| PR-E… | Phase 7: one PR per further species, User Story 5                                                                                                                                                                                                                                   |

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (a different file, and no dependence on an incomplete task).
- **[Story]**: US1–US5, from spec.md.

---

## Phase 1: Setup (PR-A)

- [x] T001 Install dependencies and build the libraries in the worktree (`npm ci`, `npm run build:libs`). Confirm at least 2 GB free on `/` before downloading any experiment table (research R5; the disk was at 540 MB on 2026-11-10). (#912)
- [x] T002 [P] Add the hand-kept species list to `tools/content-node/expression-species.json`. For now it holds the Homo sapiens entry only: (#912)
  - accession `E-MTAB-2836`;
  - its title and design line;
  - the FTP base URL `https://ftp.ebi.ac.uk/pub/databases/microarray/data/atlas/experiments/E-MTAB-2836/`;
  - the citations: the Expression Atlas 2026 paper (doi:10.1093/nar/gkaf1238) and Uhlén et al. 2015 (doi:10.1126/science.1260419);
  - the licence: CC BY 4.0.

  The fields are in data-model.md's experiment header, and the sources in research R1 and R8.

---

## Phase 2: Foundational (blocks every user story)

### 2a. Contract, pure leaves and the refresh step (PR-A)

- [x] T003 [P] Write the answer types in `projects/contract/expression.ts`, types only, imported by relative `.ts` paths (`Quantiles`, `ExpressionTissue`, `ExpressionExperiment`, `ExpressionRow`, `NotShownReason`, `ExpressionNotShown`, `ExpressionAnswer`, as in contracts/expression-endpoint.md). Every type argument must be named. Check that `projects/contract/contract.spec.ts` and `one-description.spec.ts` pass. (#912)
- [x] T004 [P] Write `tools/content-node/expression-data.ts`, a shared leaf. It loads an experiment file from a directory given by `EXPRESSION_FILES`, lazily, once per species, and validates its shape: (#912)
  - each gene's `values` has the same length as `tissues`;
  - each tuple has five numbers and is non-decreasing;
  - a missing directory or file answers "not available";
  - it never reads another species' file.

  It must import only shared modules (`boundaries.spec.ts`).

- [x] T005 [P] Test T004 in `tools/content-node/expression-data.spec.ts`, using `tools/content-node/fixtures/expression-fixture.json`. Cover: a good file, a missing directory, a missing species, a short `values`, and a decreasing tuple. Show each case fails by mutating the validator. (#912)
- [x] T006 [P] Write `tools/content-node/expression-genes.ts`, a shared leaf with pure matching rules, as in data-model.md and research R2: (#912)
  1. gene references used directly;
  2. `referenceGene` Ensembl ids, kept only if in the table;
  3. when several remain, the one carrying `geneName` is preferred, else one row each;
  4. the unique-`geneName` fallback;
  5. each gene once, with `from[]` merged;
  6. reasons `no-gene`, `not-in-experiment` or `not-measured`;
  7. chemicals and drugs excluded and not counted.

  The input is a list of `{stId, displayName, identifier, schemaClass, geneName[], ensemblGenes[]}` and the experiment's gene index.

- [x] T007 [P] Test T006 in `tools/content-node/expression-genes.spec.ts` with measured cases: (#912)
  - SOD2: P04179's referenceGene is ENSG00000291237, not in the table, so it is rescued by name to ENSG00000112096;
  - DEFB4A/DEFB4B: two genes, two rows;
  - MSH5 with MSH5-SAPCD1: the one carrying the `geneName` wins;
  - an isoform folding into its parent's gene;
  - an IG segment with no gene: `no-gene`;
  - ATP: excluded.

  Show the SOD2 and MSH5 cases fail with the fallback and the name preference removed.

- [x] T008 [P] Write `tools/content-node/expression-order.ts`, a shared leaf (research R6): (#912)
  - each row as log₁₀(median+1) across tissues;
  - average-linkage clustering on correlation distance, with stable leaf order and ties broken by gene name;
  - above 3,000 rows, ordered by the tissue of maximum expression, then by that value.

  A pure function, with no I/O.

- [x] T009 [P] Test T008 in `tools/content-node/expression-order.spec.ts`: (#912)
  - two blocks of co-expressed genes come out contiguous;
  - the order is identical across runs and input orders;
  - the fallback above the threshold;
  - zero rows and one row.

  Time 2,500 synthetic rows, record the measured time in the test's comment (constitution V), and keep it under 1 s. Show the contiguity test fails with clustering replaced by name order.

- [x] T010 Write the refresh step, `tools/content-node/snapshot-expression.ts`, an entry-guarded TypeScript module (`isEntry(import.meta.url)`), so that `tools/load.spec.ts` loads it without running it. For each species in `expression-species.json`, or the one given by `--species`, it: (#912)
  1. downloads `<acc>-tpms.tsv`, `<acc>-configuration.xml` and `<acc>.condensed-sdrf.tsv` into a temporary folder (research R4, R5);
  2. maps group ids to labels and sample counts;
  3. writes `<acc>.json` to `--out`.

  It refuses to write unless:
  - the gene count equals the data rows;
  - the tissue count equals both the columns and the configuration's groups;
  - every tuple is non-decreasing;
  - 20 cells, sampled with a fixed seed, equal the source text;
  - the file round-trips.

  A "WHEN TO RUN IT" header says: when Expression Atlas updates a listed experiment.

- [x] T011 Add a `--fixture` mode to T010, cutting the fixture `tools/content-node/fixtures/expression-fixture.json` from the real human table. It keeps the human tissues and about 20 genes: BCL2, BAX, CASP9, SOD2 (both ids), DEFB4A, DEFB4B, MSH5, MSH5-SAPCD1, a gene expressed nowhere, and a few more. Generate and commit the fixture, which must stay under 50 KB. (#912)
- [x] T012 Test T010's checks in `tools/content-node/snapshot-expression.spec.ts`, offline, on a small TSV and configuration made in the test. A mutated cell, a missing column, an extra group and a decreasing tuple must each be refused, with nothing written. Show the cell case passes wrongly when the sample comparison is removed. (#912)
- [x] T013 Run the refresh step on the real human table into a local data folder outside the repository. Record the reported gene and tissue counts (expected 61,860 and 29) and the file's size in the PR description, then measure the service's memory with the file loaded (research R5: under 150 MB). (#912)

### 2b. The endpoint family and its routing (PR-A, continued)

- [x] T014 Write `tools/content-node/expression-endpoints.ts`, the family, for `GET /ContentService/expression/{id}`: (#912)
  1. resolve the selection: pathway, reaction, complex, set, protein or reference entity, by stId or dbId, as the other `{id}` routes do;
  2. gather its reference entities, with each gene product's `geneName` and `referenceGene` ENSEMBL identifiers, in one Neo4j query;
  3. take the species from the selection, or from a reference entity's proteins;
  4. load the species' experiment (T004), match (T006), order (T008);
  5. answer an `ExpressionAnswer` through `nonEmptyJson<ExpressionAnswer>`/`satisfies`.

  The errors: 404 for an unknown id in the service's envelope, and 503 when the data is not available. Mark it `samplesOnly: true`, with the comment "No sample: Java has no such URL". It imports only shared modules.

- [x] T015 Test T014 in `tools/content-node/expression-endpoints.spec.ts`, with a stubbed graph and the fixture. Cover: (#912)
  - a pathway gives a heatmap with the fixture's genes, ordered;
  - a complex gives only its genes;
  - `uniprot:P10415` gives one row, in human;
  - `chebi:30616` gives `no-genes`;
  - a non-listed species gives `species-not-available`;
  - an unknown id gives 404;
  - an unset `EXPRESSION_FILES` gives 503.

  Show the complex case fails with the selection ignored.

- [x] T016 Register the family in `tools/content-node/registry.ts`, in match order, and update `tools/content-node/fixtures/route-order.json`. Check that `registry.spec.ts` and `boundaries.spec.ts` pass. (#912)
- [x] T017 Add the route's entry to `tools/content-node/parameters.ts` RECORD (`java: null`, a `why` saying Java has no counterpart, `query: []`). Check that `parameters.spec.ts` and `invalid-inputs.spec.ts` pass. (#912)
- [x] T018 Route it in nginx, `deploy/nginx/common/routes-core.conf`: a node location for `^/ContentService/expression/[^/]+/?$`, quoted if it contains `;` or `{`, and including `content-node-proxy.conf`. Add the matching row in `proxy.conf.js`. Check `deploy/nginx/routes.spec.ts` and `projects/website-angular/src/scripts/proxy-order.spec.ts`, and run `deploy/nginx/test-config.sh`. (#912)
- [x] T019 Add the mount to the content service's compose definition: `${EXPRESSION_FILES_DIR:-./deploy/content-node/no-expression-files}:/data/expression:ro` and `EXPRESSION_FILES=/data/expression`, as `DIAGRAM_FILES` is. Add the empty `deploy/content-node/no-expression-files/` folder with a README saying how to fill it. No server path is committed. (#912)
- [x] T020 Add the route to `projects/contract/routes.ts` as `'GET /ContentService/expression/{id}': ExpressionAnswer`, then regenerate with `node tools/contract/generate.ts`. Check that `generate.spec.ts`, `tools/api-types/schema.spec.ts` and `known-problems.json` (which must not rise) pass. (#912)
- [x] T021 Write the operation's description for the API page in the generator's node-only notes: what it answers, the experiment and licence, and why the gene list is not a parameter. `/ContentService/openapi.json` must show it. (#912)

**Checkpoint**: `curl /ContentService/expression/R-HSA-109606` answers a heatmap on a local service with the real file (quickstart §2).

---

## Phase 3: User Story 1 - See where a selection's genes are expressed (P1) 🎯 MVP (PR-C)

**Goal**: the Expression tab draws the selection's own genes × tissues from the endpoint, and no longer uses the Expression Atlas widget.

**Independent Test**: on R-HSA-109606 the rows are that pathway's genes (BCL2, BAX, CASP9), none of LINCADL or MIR1302-7, and BCL2's medians equal the table's.

- [x] T022 [P] [US1] Add the endpoint call to the Pathway Browser, in the service the tab uses: `getExpression(stId)` returning `ExpressionAnswer`, re-exported from the contract with `export type`, never a second interface. (#913)
- [x] T023 [US1] Rewrite `projects/pathway-browser/src/app/details/tabs/expression-tab/expression-tab.component.{ts,html,scss}`: (#913)
  - fetch the answer for the selection;
  - remove `loadWidget`, the EBI bundles, the stylesheet and the `#expressionContainer` widget;
  - show a loading state, the heatmap, `no-genes`, `species-not-available` and an unavailable state;
  - replace the heatmap when the selection changes, never leaving the last one under a new name.
- [x] T024 [US1] Write the heatmap component in `projects/pathway-browser/src/app/details/tabs/expression-tab/expression-heatmap/`: (#913)
  - a canvas grid of rows × tissues, shaded by log median;
  - HTML gene and tissue labels;
  - scrolling for large selections and a narrow panel;
  - drawn in one pass, without blocking the page for 2,500 rows (research R7).
- [x] T025 [US1] Follow the light and dark themes (FR-014): the scale, background, labels and gridlines come from the site's theme tokens, with a distinct "not expressed" shade, and the canvas redraws when the theme changes. (#913)
- [x] T026 [US1] Add alphabetical sorting as an alternative to the server's order (FR-006). (#913)
- [x] T027 [US1] Remove the CDN font host that the widget needed from `e2e/support/backend.ts`, and remove `ebi.ac.uk/gxa` from anything the suite expects. (#913)
- [x] T028 [US1] Write e2e tests in `e2e/pathway-browser.spec.ts`, recorded with `npm run e2e:record` and `E2E_PORT` set: (#913) The dark-mode test asserts that the cells are redrawn in the new theme's colours when it is switched; each test was shown to fail against the widget, and the theme test with the theme dependency removed.
  - R-HSA-109606's rows include BCL2, BAX and CASP9 and none of Atlas's defaults;
  - a complex shows only its genes;
  - BCL2 by reference shows one row;
  - no request goes to `ebi.ac.uk`;
  - in dark mode the heatmap's background is the theme's.

  Show each fails against the widget, and the dark-mode one with the theme hook removed. Replace the three widget tests from #911.

**Checkpoint**: the MVP. The tab shows the selection's genes, on beta, with the data folder mounted (T040).

---

## Phase 4: User Story 2 - Read a value and how much it varies (P2) (PR-C)

**Independent Test**: hovering over BCL2 × spleen shows the table's five values and the tissue's sample count.

- [x] T029 [US2] Add hover and keyboard focus over the heatmap's cells in `expression-heatmap/`: a focusable grid with arrow-key navigation, and a tooltip naming the gene, tissue, median, minimum, quartiles, maximum and sample count (FR-004). For a single-sample tissue it says "1 sample" and shows no spread. (#913)
- [x] T030 [P] [US2] Add the legend in `expression-heatmap/`: unit TPM, the logarithmic scale with ticks, and the "not expressed" shade, in both themes (FR-005, FR-014). (#913)
- [x] T031 [US2] Write e2e tests for hover, focus and the legend. Show they fail with the tooltip's source swapped. (#913) Hover and keyboard focus each have a test, the hover one shown to fail with hover disabled; the legend is checked by its unit label.

---

## Phase 5: User Story 3 - Know what is missing, and why (P2) (PR-C)

**Independent Test**: on R-HSA-109606 the tab says "N of M genes shown" and lists those not shown with reasons. ATP shows "no genes with expression data".

- [x] T032 [US3] Show "N of M genes shown" under the heatmap, and a list of the genes not shown, each with its reason in words (FR-007): "no matching gene", "not in this experiment" or "not measured". (#913)
- [x] T033 [US3] Name the source on the tab (FR-012): the experiment's accession and title linked to Expression Atlas, its design line, its last update, the citations and the licence, and the note "values as published; genes chosen and reordered". (#913)
- [ ] T034 [US3] Write e2e tests for the not-shown list on a recording containing an unmatched gene, and for ATP's "no genes" with no heatmap. Show each fails with the list hidden. Done: ATP's "no genes" with no heatmap (e2e). Still to do: an e2e recording with an unmatched gene, as R-HSA-109606 matches all 59; the list itself is covered by the endpoint's unit tests.

---

## Phase 6: User Story 4 - Take the numbers away (P3) (PR-D)

**Independent Test**: the download from R-HSA-109606 has one row per shown gene with the five values per cell, and names E-MTAB-2836.

- [ ] T035 [US4] Write `projects/pathway-browser/src/app/details/tabs/expression-tab/expression-download.ts`. It writes a TSV of the shown rows in the shown order: Ensembl id, gene name, then per tissue the five values. A header comment block names the experiment, source, last update, licence and citations, and the selection. Add the button to the tab.
- [ ] T036 [US4] Write a unit test for the TSV, and an e2e download test comparing the file with the answer. Show it fails with a column dropped.

---

## Phase 7: User Story 5 - Other species, from their own tissues (P3) (PR-E…, one species per PR)

**Independent Test**: R-MMU-109606 shows mouse genes × the mouse experiment's tissues and names E-MTAB-3718. A species not on the list says expression is not available.

- [ ] T037 [US5] Mus musculus, E-MTAB-3718:
  - measure its matching coverage the way research R2 did for human, with Reactome's referenceGene to ENSMUSG for mouse gene products;
  - add it to `expression-species.json` only if coverage is at least 95%;
  - run the refresh step, and record the counts in the PR;
  - add an e2e recording for R-MMU-109606.
  - after deploying, purge the edge cache of `/ContentService/expression/*`: the earlier "species not available" answers are stored there until the next release.
- [ ] T038 [US5] Rattus norvegicus (E-GEOD-53960, adult groups only, each sex its own column), Bos taurus (E-MTAB-2798), Gallus gallus (E-MTAB-2797), Sus scrofa (E-MTAB-5895, the design line stating juvenile) and Xenopus tropicalis (E-MTAB-3726, single sample). Each goes through the same steps as T037, in a PR of its own. Teach the refresh step to select groups by label for rat.
- [ ] T039 [US5] Write an e2e test showing a pathway of a species not on the list (R-DME-109606) says expression is not available and draws nothing. Show it fails if the species check is removed.

---

## Phase 7b: User Story 6 - See it on a body (P2) (PR-F, stacked on PR-C)

**Independent Test**: on R-HSA-109606, pointing at BCL2 shades the figure's organs by BCL2's medians; pointing at the spleen picks out the spleen column; the female figure draws endometrium, ovary, fallopian tube and placenta.

- [x] T045 [US6] Record each tissue's UBERON id. The refresh step reads `<acc>.condensed-sdrf.tsv`'s organism-part factor per assay, gives each tissue entry `uberon` (data-model.md), and refuses a group whose assays name more than one id. `ExpressionTissue` in `projects/contract/expression.ts` gains `uberon`; regenerate `openapi.json`; refresh the fixture and the beta data. (#914)
- [x] T046 [US6] Ship the human figures (male, female, brain) as site assets from the anatomogram package, unchanged (stripping their editor metadata saved only 5%, and nginx already compresses SVG), with a NOTICE naming their source and licence; in `projects/pathway-browser/src/assets/anatomogram/`. Record their sizes. (#914)
- [x] T047 [US6] Write the figure component in `expression-tab/expression-anatomogram/`. It loads the chosen figure's SVG on first view, draws it inline, sets each matched organ's fill from the heatmap's scale and the theme's tokens, and leaves unmatched organs in the theme's neutral colour. It has a male / female / brain switch, follows dark mode, and shows the organ's name when pointed at. (#914)
- [x] T048 [US6] Link the figure and the heatmap. Pointing at or focusing a gene shades the figure by that gene. Pointing at an organ picks out its column, and pointing at a column picks out its organ. The pointed-at state is shared between the two components through the tab. (#914)
- [x] T049 [US6] e2e: pointing at BCL2 shades the spleen darker than the liver (computed fills); pointing at the spleen picks out its column; the female figure has the ovary and not the testis; dark mode recolours the outline; nothing is fetched from EBI. Show each fails with its link removed. (#914)
- [x] T050 [US6] Species without a figure (pig, when it is listed) show the heatmap alone. The figure's attribution joins the tab's source line. (#914)

---

## Phase 8: Polish & cross-cutting

- [ ] T040 Mount the expression data on beta: run the refresh step into a folder outside the repository, set `EXPRESSION_FILES_DIR` in the uncommitted `.env`, restart the content service, and check quickstart §2–4 against beta. No path goes in the repository.
- [ ] T041 [P] Add SC-003's comparison to the refresh step: `--compare <base URL>` samples 20 cells from a live answer and compares them with the source table. Run it against beta and record the result.
- [x] T042 [P] Update `RELEASE-TESTING.md` and `CURATOR-REPORT.md`: Download row to follow with #915. (#917)
  - the Expression tab's checks, each marked auto, human, gap or missing;
  - the refresh step under "after a release or an Expression Atlas update".
- [x] T043 [P] Measure SC-004 on beta for a 100-gene pathway and for Signal Transduction, and record the timings in the PR. Measured 2026-11-11 on beta: 61 and 170 genes 1.4 s from opening the tab to the heatmap; Signal Transduction (2,763 genes) 4.9 s the first time (the answer 3.0 s), 2.0 s after. (#917)
- [ ] T044 Run `scripts/preflight.sh` by hand in the worktree before every push, and push with SSH keepalives (the hook takes about 20 minutes). Tick each task with its PR number in this file, in the PR that completes it.

---

## Dependencies & execution order

- **Phase 1, then 2a, then 2b**:
  - T003, T004, T006, T008 and their tests are mutually parallel;
  - T010 and T011 need T002;
  - T011's fixture is needed by T005, T007, T015, T028 and others;
  - T014 needs T003, T004, T006 and T008;
  - T016–T021 need T014.
- **US1 (Phase 3) needs Phase 2.** US2 and US3 need US1's tab and heatmap. US4 needs US1. US5 needs Phase 2 and US1, and is independent of US2–US4.
- T040 needs PR-A merged, or a preview on beta. T041 needs T040.

## Parallel examples

- **Phase 2a**: T003, T004+T005, T006+T007 and T008+T009 at once, as four different files.
- **US2**: T030 (legend) alongside T029 (hover).
- **US5**: each species is its own pull request, with no shared files beyond `expression-species.json`, so merge them in turn.

## Implementation strategy

- **MVP**: Phases 1–3. The tab shows the selection's own human genes across 29 tissues, in both themes, with no third-party request. This replaces today's heatmap of Atlas's default genes.
- **Then**: US2 and US3 complete PR-C (hover, legend, not-shown list, attribution). PR-D adds the download. Further species follow one at a time, each only after its coverage is measured.
