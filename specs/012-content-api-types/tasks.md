# Tasks: Content API types checked against real answers

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md) (R1–R9), [data-model.md](data-model.md), [contracts/check-output.md](contracts/check-output.md), [quickstart.md](quickstart.md).

**Tests**: required. Every check is shown failing on a deliberate mistake before it is trusted, and every type fix is shown failing against the old type (constitution III).

**Each pull request**: adversarial review, CI, merge; tick its tasks here with the PR number in the same pull request. Lint and dead-code counts only go down. No answer from the service changes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task).
- **[Story]**: the user story (US1–US6) the task serves.

---

## Phase 1: Setup

- [x] T001 Create `tools/api-types/compile.mjs` from #540's `typeProblems` (`tools/analysis-types/analysis-model.spec.mjs`): answers → virtual files → diagnostics, with the project's tsconfig, `types: []`, `noUnusedLocals: false`; each diagnostic mapped from its position back to the JSON path of the value it points at (research R3). Test in `tools/api-types/compile.spec.mjs`: a missing field, an undeclared field and a wrong kind each report the right path; a missing import fails every answer ("Cannot find"), not a silent pass. — #542
- [x] T002 Move `tools/analysis-types/analysis-model.spec.mjs` onto `compile.mjs`, unchanged in what it checks; its mutation tests still fail as before. — #542

---

## Phase 2: Foundational

- [x] T003 Create `tools/api-types/answers.mjs`: read `e2e/har/*.har` (bodies via `response.content._file`) and `tools/api-types/recorded/*.json`; keep 200 JSON answers with a body; normalise routes (stIds, dbIds, accessions, tokens, classes, research R2); count what is skipped (not 200, no body, not JSON). Test against a small fixture directory. — #542
- [x] T004 [P] Move the types the check imports out of component and service files into model files, unchanged: `Search` (from `projects/pathway-browser/src/app/viewport/search/search.component.ts`) to `model/search.model.ts`; `EventsHierarchy` (from `reacfoam/reacfoam.service.ts`) to `model/events-hierarchy.model.ts`; the website's search, icon and content shapes to `projects/website-angular/src/model/`. Imports updated; type check, lint and dead-code counts unchanged. — #542

---

## Phase 3: User Story 1 + 2 — every call listed, every answer checked (P1) 🎯 MVP

**Goal**: the instrument. **Independent test**: [quickstart](quickstart.md) steps 1–6.

- [x] T005 [US2] Write `tools/api-types/calls.mjs`: the 75 calls of research R1 (file, method, http, route, params, type, coverage), with `text`/`blob` for the four non-JSON reads and `gap: …` for the routes in R2's gap list. — #542
- [x] T006 [US2] Write `tools/api-types/calls.spec.mjs`: the source scan (compiler API over `projects/**/src`, specs excluded) finds every `HttpClient` call and `fetch()` whose URL uses `CONTENT_SERVICE` or a literal `/ContentService`, and fails on one not in the table, an entry with no call, or a call read as `any`/`unknown` (listed until US2's typing tasks clear them, then failing). Show it failing by adding a call and by deleting an entry. — #542
- [x] T007 [US1] Write `tools/api-types/content.spec.mjs`: match each answer to its call (route pattern and shape-changing params), compile each route group as its own program (eventsHierarchy; `query/enhanced/v2`; the rest in two), report problems in the contract's format, and list answers no call reads. Show it failing with quickstart steps 1–4. — #542
- [x] T008 [US1] Add `tools/api-types/known-problems.json` and the ratchet (data-model): seed it with today's counts per route; fail when a count rises, and when a count falls without the file being lowered. Show both failing (quickstart step 5). — #542
  - The first run found, and #542 fixed: `/data/eventsHierarchy` leaves `entities.exp` out for an analysis without expression values, and the species overview's expression filters indexed it (`exp[sample]`), which throws; now `exp?.[sample]`, with a test that throws on the old code. The 22 other routes are counted in `known-problems.json`.
- [ ] T009 [US2] Remove the two reads with no callers (`DatabaseObjectService.fetchSimpleData`, `SpeciesService.getOrtholog`) and their table entries; dead-code count goes down.
- [ ] T010 [US2] Type the four `any` reads (`entity-popup.component.ts` `/data/query/enhanced/{id}`, `/data/query/{id}`, `/interactors/static/molecule/{acc}/details`; `content-data.service.ts` `getInstance`) with named types from their recorded answers (or `gap` until the corpus, T030); the call table's "read as anything" list is empty.

**Checkpoint**: the check runs in CI; every route is either passing or counted.

---

## Phase 4: The index signature (US1, US4)

- [ ] T011 [US4] Split site-only state out of the API types (research R4): `Event` (`isSelected`, `isHovered`, `ancestors`, `parent`, `hit`), `Pathway` (`subpathwayColor`, `hitReactionsCount`), `Relationship.Has` (`index`, `moleculeView`, `highlight`), `DatabaseObject` (`_updateCounter`, `isLoaded`), `Species.shortName` into interfaces the site's state extends.
- [ ] T012 [US1] Remove `[key: string]: any` from `projects/pathway-browser/src/app/model/graph/database-object.model.ts` (97 type errors in 11 files measured, plus templates): each read of an undeclared field becomes a declared field (on the evidence of a recorded answer) or a named projection. Run `ng build` for templates; known-problems counts are re-seeded where removing the signature exposes undeclared fields (they may rise once, in this pull request only, and the review checks each).

---

## Phase 5: User Story 3 — graph types against the snapshot (P2)

**Goal**: every graph type agrees with what Java writes for its classes. **Independent test**: quickstart step 7.

- [ ] T013 [US3] Write `tools/api-types/snapshot.spec.mjs` (research R5): the mapping table (117 interfaces → Java classes, the site-only interfaces named and skipped), each type's properties via the compiler API (inheritance, optionality from the symbol, element types resolved to declarations, enum values read), compared with the union of the concrete descendants' written properties per view. Rules from data-model. Show it failing: rename `Book.isbn`, flip a kind, remove a class from a copy of the snapshot. Seed its own known-mismatch list from R5's findings, ratcheted like T008.
- [ ] T014 [P] [US3] Fix `NegativePrecedingEvent.precedingEvent` (resolves to the DOM `Event`: import the graph `Event`) and `NegativePrecedingEvent.reason` (an object, not a string).
- [ ] T015 [P] [US3] Fix `Type.MODIFIED_RESIDUE` in `projects/pathway-browser/src/app/constants/constants.ts` to `'modifiedResidue'`, Java's value.
- [ ] T016 [P] [US3] Fix the never-written fields: `Book.ISBN` → `isbn`; remove `TranslationalModification.label`, `PhysicalEntity.type`, `Publication.authorName` (each read checked first: a reader of a never-written field is a silent bug, fixed with it).
- [ ] T017 [P] [US3] Fix single-vs-list kinds: `name` on the external ontologies, `Affiliation`, `FunctionalStatusType`; `ReferenceSequence.description`; `Interaction.accession`; `EntityFunctionalStatus.functionalStatus`; `ReferenceIsoform.isoformParent`; `Deleted.deletedInstanceDbId`; `ReactionLikeEvent.reactionType` (objects). Each reader updated.
- [ ] T018 [US3] Fix the view-dependent relationship fields on `PhysicalEntity` (`compartment`, `componentOf`, `consumedByEvent`) and `ReactionLikeEvent` (`input`, `output`, `composedOf`): the Flatten names hold classes, the nested-aggregated names hold relationship objects; required only where every view writes them.

**Checkpoint**: the snapshot check's known-mismatch list is empty; written-but-undeclared properties are listed.

---

## Phase 6: User Story 4 — each route's real shape (P2)

**Goal**: every route's answer passes against its own type. **Independent test**: the route's known-problems count reaches zero.

- [ ] T019 [US4] Add `projects/pathway-browser/src/app/model/graph/wire.model.ts`: `Jsog<T>` (graph-valued fields also admit `{'@ref': string}`; graph objects carry `'@id'?: string`) and `ByDbId<T>` (graph-valued fields also admit `number`). Type `JSOGDeserializer` as `Jsog<T> → T`, removing its casts. Test both against recorded v2 and `pathways/top` answers.
- [ ] T020 [US4] `query/enhanced/v2/{id}` (four readers, research R7): read as `Jsog<…>` of the nested-aggregated shape; root vs nested measured; its known-problems count to zero.
- [ ] T021 [P] [US4] `event/{id}/ancestors`: a named `AncestorPathway` projection (`inDisease`, `inferred`, `diagramHeight`, `diagramWidth`, `oldStId`; research R6); the three readers use it.
- [ ] T022 [P] [US4] `pathways/top/{taxId}` and `pathways/low/entity/{id}`: named projections with `ByDbId` species; the entity popup's inline type replaced.
- [ ] T023 [P] [US4] The person routes: `person/{id}` (with `ByDbId` publication authors) and the four event lists (`PersonEvent`: `authorDbId`, `dateTime`, `labels`, …).
- [ ] T024 [P] [US4] `otherForms`, `participants/{id}`, `participants/{id}/referenceEntities`: named projections; `Molecule`'s client-computed fields split from the answer type.
- [ ] T025 [P] [US4] Search routes: entry `dbId` a string (the answers send one), `id` declared, facets `{}` when nothing matches; `spellcheck`/`suggest` `string[]`.
- [ ] T026 [P] [US4] `eventsHierarchy/{taxId}`: `exp` optional (absent on non-expression analyses), `children` optional on leaves; `locationsInPWB` likewise.
- [ ] T027 [P] [US4] The remaining routes in `known-problems.json` (species, schema, content toc/doi/contributors, interactors, exporter reaction diagram, flags, citation), each to zero.

**Checkpoint**: `known-problems.json` is empty and removed; the check is strict everywhere.

---

## Phase 7: User Story 5 — one definition per shape (P3)

- [ ] T028 [US5] Merge the duplicated shapes of research R7 into one definition each: Person (three), the search entry, result group and facets, the tree node, the small event projections, the reference entity, TocPathway/DoiPathway. Each reader switched; the check covers the one definition.
- [ ] T029 [US5] Merge the copied services: pathway-browser's entity, data-state and interactor services and their website provider copies become one, read by both applications; the JSOG flatten written once; the two citation reads use `CONTENT_SERVICE`. Run both applications' e2e suites.

---

## Phase 8: User Story 6 — what the recordings miss (P3)

- [ ] T030 [US6] Write `tools/api-types/record.mjs` (research R8): at most 40 URLs, our own service only, one at a time with a pause; both in-depth routes (a known event, a known entity, an unknown identifier), the Reacfoam flag, the GET interactor details, `citation/pathway`. Record into `tools/api-types/recorded/`; the call table's `gap` entries become `corpus`.
- [ ] T031 [US6] Type what the corpus shows: the in-depth routes' empty answer (the readers' guards kept, FR-010), and any route T030 covers for the first time, to zero problems.

---

## Phase 9: Polish

- [ ] T032 Run the full e2e suite (`E2E_PORT=4330`) and both applications' builds; record the lint and dead-code counts against the start.
- [ ] T033 Update `CLAUDE.md`'s guidance only if a rule for future work emerges (e.g. "a new content API call needs an entry in `tools/api-types/calls.mjs`"), and the quickstart if a command changed.

---

## Dependencies

- T001 → T002, T007. T003 → T007. T004 → T007.
- Phase 3 (the instrument) before every later phase.
- T011 → T012 → Phase 5 and Phase 6 (the signature hides undeclared fields from both).
- T019 → T020, T022, T023.
- T030 → T031; T030 also turns T010's `gap` entries into checked ones.
- Phase 7 after Phase 6 (merge shapes once each is measured).

## Parallel opportunities

- T004 alongside T001–T003.
- T014–T017 together (different files), after T013.
- T021–T027 together, after T019 (different routes and files), merging one at a time (they meet in `known-problems.json`).

## Implementation strategy

1. **MVP**: Phases 1–3. The check lands with today's problems counted, so a change that makes any route worse fails CI from then on.
2. Then the signature (Phase 4), the snapshot (Phase 5), and route by route (Phase 6) until the list is empty; duplicates and the corpus last.
