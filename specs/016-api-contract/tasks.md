---
description: 'Tasks for spec 016: one API contract for the content service and the site'
---

# Tasks: One API contract for the content service and the site

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Every task**:

- Is one pull request, with its own adversarial review.
- Ticks this file with its PR number, in that same pull request.
- Shows each new check failing before it is trusted (constitution III; [contracts/checks.md](contracts/checks.md) names the breakage).
- Leaves every answer byte-identical: run the parity comparison and the search e2e (`E2E_PORT=4330`) before and after, and deploy the content service on beta when a service module changed.
- Never lets the known-problems, lint, dead-code or loose-value counts rise.
- Sends no request to the graph database or to Reactome services.
- Before pushing, also runs `npx vitest run tools/api-types` and a scratch `npx ng build reactome --configuration production --output-path <scratch>`.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [ ] T001 Create `projects/contract/` with `package.json` (`{"type":"module"}`), `README.md` (types only; relative `import type` paths ending in `.ts`; named type arguments; writer helpers stay in `tools/content-node/answers.ts`) and `scalars.ts` (`Long` tagged `@asType integer` `@format int64`, `EpochMillis`, `Highlighted`), and confirm the type, lint, dead-code and test checks see the directory with no configuration change (research R1).

## Phase 2: Foundational (the plumbing, on the facets)

- [ ] T002 Move `FacetCount`, `NamedFacetCount`, `Facet` and `FacetResponse` from `projects/website-angular/src/model/search.model.ts`, and `IconCategory`, `IconFacet` and `IconFacetResponse` from `icon.model.ts`, into `projects/contract/search.ts`.
  - The site's model files re-export them.
  - `tools/content-node/search-core.ts` and `search-endpoints.ts` import them from the contract.
  - Show a rename of `FacetCount.count` failing in the service and the site, then undo it.
- [ ] T003 Add `projects/contract/contract.spec.ts`. It holds that the contract declares no value and imports nothing outside itself. Show it failing on an `export const` and on an import from `projects/website-angular`.
- [ ] T004 Extend `tools/content-node/boundaries.spec.ts` so that every import leaving `tools/` is `import type`.
  - It reads the syntax tree; `ts.preProcessFile` cannot tell a type import from a value import.
  - Show it failing on one changed import. This closes the service image's gap (research R1).
- [ ] T005 Point `tools/api-types/calls.ts` `TYPES` at the contract for the moved types, and extend the `tools/**/*.ts` lint block (type imports; no enum, namespace or class) to `projects/contract/**/*.ts`.

**Checkpoint**: the contract works on every side, and no answer has changed.

## Phase 3: User Story 2 - The search entry, once (P1)

**Goal**: one `SearchEntry`, a union of six kinds, replacing four reader types.

**Independent test**: the search routes' known problems fall, and every recorded entry matches exactly one kind ([quickstart.md](quickstart.md) §3).

- [ ] T006 [US2] Write `EntryBase` and the kinds `EventEntry`, `EntityEntry`, `IconEntry`, `PersonEntry`, `InteractorEntry` and `DeletedEntry` in `projects/contract/search.ts`, as in [data-model.md](data-model.md).
  - Recheck each "required" field against the indexer's builders in the scratch clone of reactome/search-indexer.
  - Non-deleted kinds carry `deleted?: never`.
  - Each field's comment names its source, and the comments carry no personal data.
- [ ] T007 [US2] Write the entity kind's `type` list from the indexer's `getType` and `getReferenceTypes`, plus the classes they pass through, taken from the domain snapshot. Add a spec that reads the snapshot and fails when a class is missing; show it failing by removing one.
- [ ] T008 [US2] Make `searchEntry` in `tools/content-node/search-core.ts` build a `SearchEntry`, with no `unknown` and no `DraftEntry` index signature.
  - Drop the six never-written fields from what it reads, keeping the field order and output byte-identical: `regulator`, `regulatedEntity`, `regulatorId`, `regulatedEntityId`, `instanceTypeExplanation`, and `reason` (read as `deletedReason`).
  - Leave a comment on `reason` naming the mismatch with the index field.
  - Confirm byte-identity with the search unit specs, the parity comparison and beta.
- [ ] T009 [US2] Add `PathwayOfEntry`, the projection `/search/pathways/of/{dbId}` answers, to `projects/contract/search.ts`. Point the pathway browser's `selectedResultPathways` at it.
- [ ] T010 [US2] Make the site's `SearchEntry` and `IconEntry` re-export the contract's, and narrow by kind where `search.component.ts`, `interactor-detail.component.ts`, `icon-lib.component.ts` and `icon-detail.component.ts` read kind-specific fields.
  - Escape or render `Highlighted` fields as each reader does today, with no change visible on the page.
  - Check the search page and an icon page in a browser.
- [ ] T011 [US2] Make the pathway browser's `Search.Entry` and `Search.Icon.Entry` re-export the contract's, keeping the value `EMPTY_RESULTS` in the namespace. Adjust `viewport/search/search.component.ts`, `services/icon.service.ts` and `details/tabs/description-tab/icon/icon.component.ts`, and check the diagram search in a browser.
- [ ] T012 [US2] Recount `tools/api-types/known-problems.json`. Record what remains on the search routes, each item with its reason, in this task's PR and here.

## Phase 4: User Story 3 - The search answers (P1)

**Goal**: every search route's answer is in the contract. This closes spec 013 T019.

**Independent test**: every search route's known problems are at zero or explained.

- [ ] T013 [US3] Write `ResultGroup<E>`, `GroupedResult` (with `numberOfGroups`), the diagram and species-overview result types and `IconResult` (with `rowCount` and `typeName`) in `projects/contract/search.ts`, and point their writers in `search-endpoints.ts` and `search-diagram-endpoints.ts`, and their readers, at them.
- [ ] T014 [US3] Add `/search/icon/{id}` to `tools/api-types/calls.ts` as `IconEntry`, recording an answer through the e2e suite if it has none (record rewrites three HARs: check the diff). Type its writer.
- [ ] T015 [US3] Tick spec 013 T019 in `specs/013-server-types/tasks.md` with T002–T014's PR numbers.

## Phase 5: User Story 1 - A change fails on both sides (P1)

**Goal**: the guarantee is shown, not assumed, for everything in the contract so far.

- [ ] T016 [US1] Add a spec that fails when a contract answer is also declared in `projects/website-angular/src/model` or `projects/pathway-browser` (the "no second description" check). Show it failing on a re-added local `interface SearchEntry`.
- [ ] T017 [US1] Record in this file, with the commands, a rename of one field per moved family failing the writer and every reader ([quickstart.md](quickstart.md) §1).

## Phase 6: User Story 4 - The description, generated (P2)

**Goal**: an OpenAPI 3.1 document generated from the contract, committed and kept current.

**Independent test**: [quickstart.md](quickstart.md) §5.

- [ ] T018 [US4] Add ts-json-schema-generator 2.9.0 as a dev dependency (check the lock's diff by name and version at every depth) and write `tools/contract/generate.ts`.
  - It generates the route table's answer types (`discriminatorType: 'open-api'`, `skipTypeCheck: true`) and rewrites the refs to `#/components/schemas/`.
  - It writes `projects/contract/openapi.json`.
  - `tools/load.spec.ts` lists it under `RUN_ON_LOAD` if it writes when loaded.
- [ ] T019 [US4] Write `projects/contract/routes.ts`, the route table, as types. `tools/contract/generate.spec.ts` checks it against `tools/content-node/registry.ts` both ways, and marks registry routes not yet in the contract `x-contract: "not yet"`. Show it failing on a row for a route the registry lacks.
- [ ] T020 [US4] Add the up-to-date check in `tools/contract/generate.spec.ts`: regenerate in memory and compare with the committed file. Show it failing on a contract change made without regenerating.
- [ ] T021 [US4] Add ajv 8.20.0 as a dev dependency and `tools/api-types/schema.spec.ts`, which validates the recorded answers of contract routes against `openapi.json`.
  - Use ajv 2020-12, with `discriminator: true` where a type has one, and register the `int64` format.
  - Read exact longs with a JSON.parse reviver.
  - Count one problem per failing value, so a union failure counts once.
  - Show it failing by removing one entry kind.

## Phase 7: User Story 5 - The rest, family by family (P3)

**Goal**: the remaining shared types, then the remaining families, move in.

**Independent test**: for each family, known problems are at zero or explained, and readers and writers use only the contract's types.

- [ ] T022 [P] [US5] Content lists and schema tables (`content.model.ts`: SimplePerson, TocSubpathway, TocPathway, DoiPathway, Contributor, SchemaNode, SchemaAttribute, SimpleDatabaseObject, InstanceReferrals) into `projects/contract/content.ts`. Writers: `content-endpoints.ts`, `schema.ts`, `snapshot-schema.ts`, `schema-endpoints.ts`, `data-query-endpoints.ts`.
- [ ] T023 [US5] Interactors. First split the pathway browser's `Interactor` into the answer type and a client extension (`existingNodes`); the file's enum and class stay. Then move `CustomInteraction`, `Interactor`, `InteractorEntity`, `PsicquicResource` and the site's `InteractionWithEntities` into `projects/contract/interactors.ts`.
- [ ] T024 [P] [US5] Person events (`SimpleEvent`), locations (`PathwayBrowserNode`), flags (`DiagramFlagResult`, `SpeciesOverviewFlagResult`) and the citation (`PathwayCitation`) into their contract modules.
- [ ] T025 [US5] The enhanced query (2,659 known problems): graph objects as a union on `className`/`schemaClass` with an OpenAPI discriminator, starting from the classes the site reads.
- [ ] T026 [US5] An entity's other forms (1,660), then the interactors' details (1,560), then the remaining families by known problems.
- [ ] T027 [US5] The render service's types (`tools/render`), then the analysis service's, splitting the analysis model's values (`TYPES`) from its types first.

## Phase 8: Polish

- [ ] T028 Publish the generated description from the content service, and move the site's API page (`swagger-page.component.ts`) to it from Java's live description. This needs its own routes in nginx and the dev proxy, checked by `deploy/nginx/routes.spec.ts`, and a site rebuild with the user's OK.
- [ ] T029 Raise the suspected `reason` / `deletedReason` mismatch with the search team, as an issue on the content service's search code, after checking Java's source. The answer stays as Java writes it.
- [ ] T030 Update `CLAUDE.md` with the contract's rule: answer types live in `projects/contract/`, types only, and the description is regenerated with any change.

## Dependencies

- **Setup and foundation.** T001 → T002–T005 (foundation) → every story.
- **The search entry.** T006 and T007 come before T008–T011, and T012 follows them.
- **The search answers.** US3 (T013–T015) needs US2.
- **Showing both sides fail.** US1 (T016, T017) needs T002 and US2, and is re-run as families move.
- **The description.** US4: T018 → T019 → T020 → T021. It can start after US3.
- **The rest.** US5 needs the foundation and US4's checks; T022 and T024 can run side by side. T025 onward follow known-problem order.
- **Polish.** T028 needs US4.

## Parallel examples

- **The entity type list and the entry kinds:** T007 alongside T006, in different modules.
- **Two families at once:** T022 and T024 in parallel, since they touch different model and service files. Port PRs conflict at shared anchors, so merge one, rebase the other, and keep both sides.

## Implementation strategy

- **MVP.** Phases 1–3 (T001–T012): the contract's plumbing and the search entry, the largest share of known problems.
- **Then.** US3 closes spec 013, US1 records the guarantee, US4 publishes the description, and US5 widens coverage family by family, each change deployed and verified before the next.
