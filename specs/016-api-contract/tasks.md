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

- [x] T001 Create `projects/contract/` with `package.json` (`{"type":"module"}`), `README.md` (types only; relative `import type` paths ending in `.ts`; named type arguments; writer helpers stay in `tools/content-node/answers.ts`) and `scalars.ts` (`Long` tagged `@asType integer` `@format int64`, `EpochMillis`, `Highlighted`), and confirm the type, lint, dead-code and test checks see the directory with no configuration change (research R1). — #684, with T002. `scalars.ts` waits for its first reader (T006, T008): alone, its types would be unused exports, which the dead-code ratchet counts. The checks see the directory: `check:dead` reported the new module's unused exports with no configuration change (two re-exports nothing read were dropped, leaving 131, the baseline).

## Phase 2: Foundational (the plumbing, on the facets)

- [x] T002 Move `FacetCount`, `NamedFacetCount`, `Facet` and `FacetResponse` from `projects/website-angular/src/model/search.model.ts`, and `IconCategory`, `IconFacet` and `IconFacetResponse` from `icon.model.ts`, into `projects/contract/search.ts`.
  - The site's model files re-export them.
  - `tools/content-node/search-core.ts` and `search-endpoints.ts` import them from the contract.
  - Show a rename of `FacetCount.count` failing in the service and the site, then undo it.
  - Done in #684. The site re-exports only the types its readers use (`Facet`, `FacetResponse`, `NamedFacetCount`; `IconCategory`, `IconFacetResponse`); `calls.ts`'s `TYPES` names the contract for the two answers it checks. The rename failed `tools/content-node/search-core.ts:80` (the facet counts' writer), `search-endpoints.ts:96` and the site's `search/search.component.ts:339`, and passed again once undone.
- [x] T003 Add `projects/contract/contract.spec.ts`. It holds that the contract declares no value and imports nothing outside itself. Show it failing on an `export const` and on an import from `projects/website-angular`. — #685. Its cases cover each kind of value (variable, function, class, enum, namespace), a value import, a package, a re-export and an `import()` type from outside; on the real tree, an `export const` and an import of the site's search model appended to `search.ts` failed it, naming both.
- [x] T004 Extend `tools/content-node/boundaries.spec.ts` so that every import leaving `tools/content-node/` is `import type` (the image copies nothing else, so a value import from a sibling `tools/` directory fails there too).
  - It reads the syntax tree; `ts.preProcessFile` cannot tell a type import from a value import.
  - Show it failing on one changed import. This closes the service image's gap (research R1).
  - Done in #685. Every form is read: an import whose clause is not `import type` (`import { type X }` included, which leaves `import {}` behind), a side-effect import, a re-export, `import()` and `import x = require()`; types in type positions and packages pass. Changing `search-core.ts`'s `import type { FacetCount }` to `import` failed it. From #685's and #686's reviews, #687 reads what that missed: a template-literal path, an `import()` whose path is not written out (refused), `require()`, `import.meta.resolve()`, and a file read relative to the module (`new URL('../…', import.meta.url)`, which fails in the image as an import does); a `../` read added to `domain.ts` failed it, and a path not written out is refused in every form; `.`, the directory itself, passes (it read as outside before). The contract's check (T003) now reads every file in the directory, declaration files and subdirectories included, refuses a module in a subdirectory and a reference directive; a `sub/x.ts` with a constant failed it.
- [x] T005 Point `tools/api-types/calls.ts` `TYPES` at the contract for the moved types, extend the `tools/**/*.ts` lint block (type imports; no enum, namespace, `import =` or parameter properties) to `projects/contract/**/*.ts`, and add `../projects/contract/**/*.ts` to `tools/tsconfig.json`'s `include`, so a contract module no reader imports yet is type-checked (show it: a type error in an unimported contract file fails `tsc -p tools/tsconfig.json`). — `TYPES` in #684; the rest in #685: an unimported `projects/contract/probe.ts` with an unknown name failed `tsc -p tools/tsconfig.json` (TS2304), and with an enum failed lint.

**Checkpoint**: the contract works on every side, and no answer has changed.

## Phase 3: User Story 2 - The search entry, once (P1)

**Goal**: one `SearchEntry`, a union of six kinds, replacing four reader types.

**Independent test**: the search routes' known problems fall, and every recorded entry matches exactly one kind ([quickstart.md](quickstart.md) §3).

- [x] T006 [US2] Write `projects/contract/scalars.ts` (`Long` tagged `@asType integer` `@format int64`, `EpochMillis`, `Highlighted`; T001 left it for its first reader), `EntryBase` and the kinds `EventEntry`, `EntityEntry`, `IconEntry`, `PersonEntry`, `InteractorEntry` and `DeletedEntry` in `projects/contract/search.ts`, as in [data-model.md](data-model.md).
  - Recheck each "required" field against the indexer's builders (reactome/search-indexer at 5cea4d6) and against `searchEntry` itself, which leaves out a name or summation with no snippet and a summation the document lacks. Confirm that an entity entry built from a reference entity always carries an `stId`, or make it optional.
  - Done in #689, with T007 and T008, since the kinds alone would be exports nothing reads. Rechecked against the builders: an entity's `species` is always written ("Entries without species" when it has none), an icon's `species`, `iconName` and `iconCategories` may be absent, a reference entity's `isDisease` too; reference entities carry stable ids in release 97, so an entity's `stId` stays required. data-model.md follows.
  - Non-deleted kinds carry `deleted?: never`.
  - Each field's comment names its source, and the comments carry no personal data.
- [x] T007 [US2] Write the entity kind's `type` list from the indexer's `getType` and `getReferenceTypes`, plus the classes they pass through, taken from the domain snapshot. Add a spec that reads the snapshot and fails when a class is missing; show it failing by removing one. — #689. Its list, from each concrete class's ancestors in the snapshot: the physical entities that are neither a set nor genome-encoded (Cell, ChemicalDrug, Complex, OtherEntity, Polymer, ProteinDrug, RNADrug, SimpleEntity); every reference-entity class has a type of its own. Dropping `'Cell'` from the contract failed it. It also holds that every reference-entity class is one `getReferenceTypes` names. It reads `search.ts` by a plain path: read through `new URL(…, import.meta.url)`, knip took the read for a use of every export, which hid the unused ones (#688's review); the kinds are exported as their readers take them (T009–T011), so the dead-code count stays at its baseline, and an unused export in `search.ts` raises it.
- [x] T008 [US2] Make `searchEntry` in `tools/content-node/search-core.ts` build a `SearchEntry`, with no `unknown` and no `DraftEntry` index signature.
  - Drop the six never-written fields from what it reads, keeping the field order and output byte-identical: `regulator`, `regulatedEntity`, `regulatorId`, `regulatedEntityId`, `instanceTypeExplanation`, and `reason` (read as `deletedReason`).
  - Leave a comment on `reason` naming the mismatch with the index field.
  - Exact longs: declare `JSON.rawJSON` as returning a branded `RawJson`, declared in a shared leaf module (or `declare global`) that `answers.ts` can import under spec 014's layering, never exported from `server.ts`, and write the entry through a writer-side mapping in `answers.ts` in which a `Long` field accepts `RawJson` (research R4).
  - Confirm byte-identity with the search unit specs, the parity comparison and beta.
  - Done in #689. `searchEntry` builds a `WrittenEntry`: the contract's fields and kinds (`SearchEntryFields`, derived from the union), the replacement dbIds as `RawJson`; which kind a document is stays the indexer's, held by the recorded answers, so nothing claims the kind (`/search/pathways/of` writes projections with no `type`, T009). Values are read as Java casts them, `(String)` and `(Boolean)`, a value of another class failing as its `ClassCastException` does (Solr's schema gives none); the six fields no document can give are not read (the schema has none of them and no dynamic field). `RawJson` is declared with `JSON.rawJSON` in the global declaration. Byte-identity: the search family's specs (383 tests), and on beta 68 search requests (every distinct one the recordings hold, and one icon), captured twice before to show the capture stable, then again with the branch deployed: all 68 identical, status, type and body. Java's reading of `deletedReason` is confirmed from its bytecode (search-core 1.4.13), for T029.
- [x] T009 [US2] Add `PathwayOfEntry`, the projection `/search/pathways/of/{dbId}` answers, to `projects/contract/search.ts`. Point the pathway browser's `selectedResultPathways` at it. — #691, with T010–T012; the pathway browser names it `Search.PathwayOf`, and the call table follows.
- [x] T010 [US2] Make the site's `SearchEntry` and `IconEntry` re-export the contract's, and narrow by kind where `search.component.ts`, `interactor-detail.component.ts`, `icon-lib.component.ts` and `icon-detail.component.ts` read kind-specific fields.
  - Escape or render `Highlighted` fields as each reader does today, with no change visible on the page.
  - Check the search page and an icon page in a browser.
  - Done in #691. The site's `SearchEntry` is the contract's `SearchEntryView`: any kind, what every kind carries required, the rest optional (FR-003's view, since the search page shows every kind side by side and a template cannot read a field one kind lacks); `IconEntry` is the contract's kind. Two readers changed: the protein forms' key drops a fallback `id` already covers (`id` is the stId, or the dbId, never empty), and an icon's image is found by `id`, the same value as `stId` but never highlighted. From #690's review, the icon library too (#691): its search is highlighted, and asking beta's service for `R-ICO-012449` there answers `stId` as `<span class="highlighting" >R-ICO-012449</span>`, `id` plain, so its image, link, fetch and shown id were built from markup; they take `id` now, as does the pathway browser's icon load. From #691's review (#697): the search page printed a highlighted reference identifier as text, `PTEN (<span class="highlighting" >P60484</span>)` for a search of P60484, seen in the browser against beta's services; it is rendered as its neighbours are (`[innerHTML]`) and reads `PTEN (P60484)`. An icon's alt text and the pathway browser's icon link take `id`, and the interactor page strips a highlighted name as it strips the identifier. Nothing else visible changes; the search, search-error and icon-library end-to-end specs passed for #691 (46 and 78 tests with the specs below). The single icon page reads only type changes; no recording opens one (the `gap` T014 closes).
- [x] T011 [US2] Make the pathway browser's `Search.Entry` and `Search.Icon.Entry` re-export the contract's, keeping the value `EMPTY_RESULTS` in the namespace. Adjust `viewport/search/search.component.ts`, `services/icon.service.ts` and `details/tabs/description-tab/icon/icon.component.ts`, and check the diagram search in a browser.
  - Done in #691. `Search.Entry` is the view, `Search.Icon.Entry` the icon kind, and an icon query's groups hold any kind (three of the five recorded answers are proteins, compounds or drugs), so `fetchIcon` takes an entry only when it is an icon, not deleted, besides its group's name. Its unit spec's icon is now one as the search writes it, and a deleted icon in an icon group gives none (failing without the check). The flag button takes `id`. The in-diagram search, flagging, pathway-browser, entity popup, structures and pathway-data specs pass; their recordings answer the icon query with icons (R-ICO-013990, R-ICO-012536) and with other kinds.
- [x] T012 [US2] Recount `tools/api-types/known-problems.json`. Record what remains on the search routes, each item with its reason, in this task's PR and here.
  - #691: the search routes fall from 11,452 known problems to 16, the whole from 23,616 to 12,180. Left: 12 on `/search/query` as SearchResult, the result's `numberOfGroups`, which the site's `SearchResult` lacks; 4 on `/search/icon/query` as IconResult, its `rowCount` and `typeName` (two answers each). Both are the result types, T013's.

## Phase 4: User Story 3 - The search answers (P1)

**Goal**: every search route's answer is in the contract. This closes spec 013 T019.

**Independent test**: every search route's known problems are at zero or explained.

- [x] T013 [US3] Write `ResultGroup<E>`, `GroupedResult` (with `numberOfGroups`), the diagram and species-overview result types and `IconResult` (with `rowCount` and `typeName`) in `projects/contract/search.ts`, and point their writers in `search-endpoints.ts` and `search-diagram-endpoints.ts`, and their readers, at them.
  - Done in #703. The contract's `ResultGroup<Entry>`, `GroupedResult<Entry>`, `DiagramResult<Entry>`, `TargetResult` and `IconResult`, each taking its entry type as a named argument: the service writes them with its `WrittenEntry`, a reader reads them with the view. A group's `entries` is optional (an ungrouped page past the end has none) and so is its `typeName` (a group Solr names with nothing); the search page settles both once when the answer arrives (`ShownGroup`), and the pathway browser's search shows only named type facets, as the site's does. A target's empty term or resource is left out, so both are optional. A grouping without `matches` is skipped, as SolrJ's `QueryResponse.extractGroupedInfo` skips it (read from its bytecode, from #700's review): the first grouping that has its matches is read, and none is no result, Java's 500 (a spec of two groupings, the first without matches, fails on the first-grouping reading). The search routes' known problems are 0, the whole 12,164. From #697's review, the pathway browser's icon tooltip takes `iconName`, never highlighted.
- [x] T014 [US3] Record an answer for `/search/icon/{id}` (already in `tools/api-types/calls.ts` as `IconEntry`, with a `gap`) through the e2e suite and remove the `gap` (record rewrites three HARs: check the diff). Type its writer. — #704. `e2e/content-pages.spec.ts` opens `/community/icon-lib/R-ICO-012449`, recorded against beta's services (`CONTENT_NODE_TARGET` at its port): the single-icon answer holds to the contract's `IconEntry`, and a contract `iconName` made a number fails on it, so the check reads it.
- [x] T015 [US3] Tick spec 013 T019 in `specs/013-server-types/tasks.md` with T002–T014's PR numbers. — #704.

## Phase 5: User Story 1 - A change fails on both sides (P1)

**Goal**: the guarantee is shown, not assumed, for everything in the contract so far.

- [x] T016 [US1] Add a spec that fails when a contract answer is also declared in `projects/website-angular/src/model` or `projects/pathway-browser` (the "no second description" check). Show it failing on a re-added local `interface SearchEntry`. — #706. `projects/contract/one-description.spec.ts` takes the contract's exported names and the names the readers re-export them as (the site's `SearchEntry` is the contract's `SearchEntryView`), and refuses an interface or an object type under any of them in the site's or the pathway browser's code, anywhere (a namespace's too); an alias of the contract's type is a name, not a description. A re-added `interface SearchEntry` in the site's search model failed it, naming the file. From #705's review: the readers' own aliases are protected too (the pathway browser's `Search.Entry`, `Search.Result` and the rest, the site's `SearchResult`), by a written list the spec holds to the code both ways, so an alias turned into an interface is caught (shown on `Search.Entry`); and a shape written as `Readonly<{…}>`, a mapped type, in parentheses, as an array or as a class is a description too.
- [x] T017 [US1] Record in this file, with the commands, a rename of one field per moved family failing the writer and every reader ([quickstart.md](quickstart.md) §1). — #706. The search family, by its three moves, each a field renamed in `projects/contract/search.ts` and the two programs checked (`npx tsc -p tools/tsconfig.json --noEmit`, `npx tsc -p tsconfig.app.json --noEmit`), then undone:
  - the facets (#684): `FacetCount.count` failed `tools/content-node/search-core.ts:80`, `search-endpoints.ts:96` and the site's `search/search.component.ts:339`;
  - the entry (#689): `exactType` failed the writer, `search-core.ts:257`, and the site's `search.component.ts:672` (the pathway browser reads it in its templates, which the site's production build checks);
  - the answers (#703): `GroupedResult.numberOfMatches` failed the writers, `search-endpoints.ts:287` and `:298`, and the site's `search.component.ts:326`, `:408`, `:415` and `:454`.

## Phase 6: User Story 4 - The description, generated (P2)

**Goal**: an OpenAPI 3.1 document generated from the contract, committed and kept current.

**Independent test**: [quickstart.md](quickstart.md) §5.

- [x] T018 [US4] Add ts-json-schema-generator 2.9.0 as a dev dependency (check the lock's diff by name and version at every depth) and write `tools/contract/generate.ts`.
  - It generates the route table's answer types (`discriminatorType: 'open-api'`, `skipTypeCheck: true`) and rewrites the refs to `#/components/schemas/`.
  - It writes `projects/contract/openapi.json`.
  - `tools/load.spec.ts` gains `'contract'` in `SERVICES`, and lists `generate` under `RUN_ON_LOAD` if it writes when loaded.
  - Done in #708, with T019 and T020 (the generator reads the route table). The lock gains the generator, `commander`, `safe-stable-stringify` and a hoisted `glob`, whose copy of `brace-expansion` resolves to 5.0.12 where the two nested copies had 5.0.9 (in its range). It writes only when run as a script (`import.meta.main`), so loading it does nothing and it is not in `RUN_ON_LOAD`. A generic instance's name (`GroupedResult<SearchEntry>`) becomes an OpenAPI component name (`GroupedResult_SearchEntry`); the search entry's union is written as `oneOf` of its six kinds (research R4); `Long` is `integer`, `int64`. In 1.7 s, the same bytes on every run. Prettier leaves the file alone (`.prettierignore`); the up-to-date check holds it.
- [x] T019 [US4] Write `projects/contract/routes.ts`, the route table, as types. `tools/contract/generate.spec.ts` checks it against `tools/content-node/registry.ts` both ways, and marks registry routes not yet in the contract `x-contract: "not yet"`. Show it failing on a row for a route the registry lacks.
  - Done in #708. `projects/contract/routes.ts` is the interface `Routes`, each `"METHOD /path"` as the registry has it to its 200 answer: twelve search routes. The description lists all 91 routes the service serves (90 paths; one is both GET and POST), 79 marked `x-contract: "not yet"`, each templated path's variables declared as OpenAPI requires (from #707's review; Redocly's spec rules then pass). Component names that would clash once made valid fail the generator; the order is by code unit, the same in every locale. A row for a route the registry lacks failed the check.
- [x] T020 [US4] Add the up-to-date check in `tools/contract/generate.spec.ts`: regenerate in memory and compare with the committed file. Show it failing on a contract change made without regenerating.
  - Done in #708. A contract field renamed without regenerating failed it.
- [x] T021 [US4] Add ajv 8.20.0 as a dev dependency and `tools/api-types/schema.spec.ts`, which validates the recorded answers of contract routes against `openapi.json`.
  - Use ajv 2020-12, with `discriminator: true` where a type has one, and register the `int64` format.
  - Read exact longs with a JSON.parse reviver.
  - Count one problem per failing value, so a union failure counts once.
  - Show it failing by removing one entry kind, and by making two kinds overlap (an entry that matches two must fail: `oneOf`).
  - Done in #710, replacing #709 after its review. **ajv 8.18.0, not 8.20.0:** a root 8.20.0 is hoisted over the 8.18.0 that `@angular-devkit/core` pins exactly, so ajv-formats, ng-packagr and the MCP SDK would move to 8.20.0 while the devkit kept 8.18.0. Pinning the 8.18.0 already in the tree leaves every lock entry as it was and only adds the root dependency.
  - 195 recorded answers of 10 described routes are checked, with no problem. `/search/facet` and `/search/query/paginated` have no recording: the first is not in the recordings, which always search with a query (`calls.ts` names the gap), and no call of the site reads the second. The test lists both, both ways.
  - No type in the description has a discriminator yet, so `discriminator: true` does nothing for now. `int64` is not registered as a format, though the task asked for it: the only `int64` in the description is the `Long`, which the check reads its own way, so a registered format would never run (#709's review showed it accepting anything with no test failing). Unregistered, an `int64` written anywhere else is refused in strict mode, as a test shows. The description's `Long` is checked as a keyword that also takes a bigint, since ajv's `integer` is a JS number. A bigint fails anywhere else, and a description whose `Long` is not `{type: integer, format: int64}` is refused.
  - Removing a kind fails the recorded entries of every kind but PersonEntry, which no recording has. Deleted entries are recorded. Adding a copy of a kind fails the entries it now describes twice.
  - An answer is matched among every route the description lists, described or not yet, so an answer of a not-yet route that fits a described template (`/search/diagram/summary` fits `/search/diagram/{diagram}`; none is recorded) is not checked against the template's schema. From #709's review, with a test.
  - A union's branch errors are told by where they are, not by schema path, since a branch reached through a `$ref` has its own. So a failure beside a union, at or within its value, shows only once the union's is fixed; the answer fails either way. From #709's review, a test now holds branch errors within an array entry's union to one problem.
  - Shown failing: the reviver taken out (bigint tests), branch errors counted (both union tests), a templated path matched before a full one, every error of a value counted, nested branch errors counted, answers ranked among described routes only, `int64` registered again (the int64 test), nothing validated. The JSDoc #710 left misplaced was put back in a follow-up, from #710's review.
  - The recorded-answer tests take up to about 4.4 s each, near vitest's 5 s default, which once timed one out. They have 60 s.

## Phase 7: User Story 5 - The rest, family by family (P3)

**Goal**: the remaining shared types, then the remaining families, move in.

**Independent test**: for each family, known problems are at zero or explained, and readers and writers use only the contract's types.

- [x] T022 [P] [US5] Content lists and schema tables (`content.model.ts`: SimplePerson, TocSubpathway, TocPathway, DoiPathway, Contributor, SchemaNode, SchemaAttribute, SimpleDatabaseObject, InstanceReferrals) into `projects/contract/content.ts`. Writers: `content-endpoints.ts`, `schema.ts`, `snapshot-schema.ts`, `schema-endpoints.ts`, `data-query-endpoints.ts`.
  - Done in #713, replacing #712 after its review. The ten types (with `SchemaValueType`, which `SchemaAttribute` holds) are in `projects/contract/content.ts`. The site's `content.model.ts` re-exports the eight it reads; the service's five writers, and `schema.spec.ts`, import the contract, and `calls.ts` names it for the seven the site's calls read.
  - The route table gains eight routes: the contents, DOI and contributors lists, the schema's model, attributes, referrals and instances (`/min`), and an instance's referrers. The description has 20 operations described and 71 not yet.
  - **Schema check.** It checks 24 recorded answers of six of them, with no problem. `/schema/{id}/min` and `/instance/{id}/referrers` have no recording, as `calls.ts` says (the recordings never open a class's instances or an instance's referrers), and the schema check lists them. Shown failing: `SchemaAttribute.cardinality` retyped as a number fails the recorded attributes.
  - From #712's review, now that the comments are the description's too:
    - `TocSubpathway.doi`'s comment said the field is never sent. The service writes it when the child has one, a difference from Java that it declares. In five of the six recorded answers, 107 of 215 subpathways carry it.
    - `SimpleDatabaseObject`'s comment named the wrong writer for the referrers.
    - The type follows what is written. `compact` never writes a null, and the recordings hold none (1,290 subpathways, 204 top-level pathways, 2,676 DOI pathways). So the DOIs and `releaseStatus` lose `| null`, and `DoiPathway.doi`, present in all 2,676, stays required.
    - `dbId` and the counts stay `number`, written as `number` and not `integer`; that is a question for the scalars, not for this family.
  - From #713's review, in #714: the contents page's DOI lookup no longer filters and casts for a null that `DoiPathway.doi` cannot hold, and its comment says which service leaves a child's DOI out.
  - **Renames fail both sides.** `SimplePerson.surname` renamed fails the type check on the service's writer and on the contents, DOI and contributors pages. `Contributor.authoredPathways` renamed fails the service's type check and the site's build (its template). The contributors page used to sort through `(a as any)[key]`, which would have let the renamed count through. Its sort keys are now the contract's own count fields.
  - The two re-exports nothing on the site reads (`TocSubpathway`, `SchemaValueType`) are left out, so the dead-code count stays at 130.
- [x] T023 [US5] Interactors. First split the pathway browser's `Interactor` into the answer type and a client extension (`existingNodes`); the file's enum and class stay. Then move `CustomInteraction`, `Interactor`, `InteractorEntity`, `PsicquicResource` and the site's `InteractionWithEntities` into `projects/contract/interactors.ts`.
  - Done in #715. `projects/contract/interactors.ts` holds `InteractorEntity`, `Interactor`, `CustomInteraction`, `PsicquicResource` and `InteractionWithEntities`, with their measured comments.
  - **Client extensions get their own names,** as one-description requires:
    - The pathway browser's `existingNodes` moves to `DrawnInteractor` (the contract's `Interactor` and the diagram nodes it is drawn on), with `DrawnInteractorEntity` holding them. Its own `Interactors` holds the drawn entities; it stays in the pathway browser, since its PSICQUIC route's 1,560 known problems are a later task.
    - The pathway browser's two computed `CustomInteraction` fields (`finalGeneName`, `formattedIdentifier`) leave the type. The table adds them by a spread whose type is inferred.
    - The site's own `CustomInteraction` in the interactor page was a view model built from `InteractionWithEntities`, not an answer. It is renamed `InteractionRow`.
  - **The route table** gains the PSICQUIC services, the enhanced interactions and the interactions with entities. The schema check passes their 218, 8 and 1 recorded answers.
  - **A rename:**
    - `PsicquicResource.name` renamed fails the node writer's and the pathway browser's type checks.
    - `CustomInteraction.evidenceCount` renamed fails only the writer: the pathway browser reads it in a Material table cell, whose row Angular types as `any`. That is a limit of the table, recorded here, not fixed.
  - **Shown failing:** `PsicquicResource.active` retyped as a string fails every recorded PSICQUIC services answer.
  - From #715's review, in #716: a custom upload's interactors are built in the pathway browser from pairs of accessions, with no evidence, and a cast to `DrawnInteractorEntity[]` hid that they lacked the contract's required `evidences` and `evidencesURL`. `DrawnInteractor` makes those two optional (every reader already allows for them missing), and the cast is gone. `CustomInteraction`'s comment now names every field written as the text "null".
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
