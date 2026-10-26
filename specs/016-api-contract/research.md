# Research: One API contract for the content service and the site

Measured 26 Oct 2026 from the repository, the recorded answers (`e2e/har/`, read the way `tools/api-types/answers.ts` reads them) and the search indexer's source at 5cea4d6 (26 Mar 2026). No request reached the graph database or any Reactome service.

## R1. Where the contract lives

**Decision**: `projects/contract/`, holding types only: `export type` and `export interface`, imported with `import type` by relative paths that end in `.ts`. It has its own `package.json`, `{"type":"module"}`.

**Rationale**, measured in a throwaway worktree with a probe type:

- **Both checks see it, and Node loads it.** `tsc -p tools/tsconfig.json` and `tsc -p tsconfig.app.json` both pass. Node loads the service, because a type import is stripped. The load, boundary and search specs pass.
- **A rename fails both sides.** Renaming `FacetCount.count` in the probe failed both `tools/content-node/search-core.ts:80` and `projects/website-angular/src/app/search/search.component.ts:339`.
- **No configuration change.** `projects/**` is already covered by vitest's `include`, eslint, prettier and knip; knip reported an unused export there with no change.
- **Nothing in Angular changes.** `angular.json` and `tsconfig.app.json` need nothing: `projects/website-angular` and `projects/pathway-browser` are not Angular projects, but folders the `reactome` project reaches by relative import. The contract is the same.
- **How the service imports the site's types today.** All 14 of `tools/content-node`'s imports from `projects/` are `import type`, by relative path with `.ts` (checked by parsing every module).

**Why types only:**

- **A value would fail the site's build.** A value import with a `.ts` extension fails it (TS5097: the root tsconfig has no `allowImportingTsExtensions`).
- **A value would fail in the service's image.** That image copies only `tools/content-node/` and `tools/package.json` (`deploy/content-node/Dockerfile`), so it would pass `tools/load.spec.ts` locally and fail in the image. Nothing catches that today.

So the contract holds no values (no enum, no namespace, no constant), and a new boundary check holds two rules:

- The contract imports nothing outside itself.
- Every service import that leaves `tools/` is `import type`.

The check needs the syntax tree. `boundaries.spec.ts` uses `ts.preProcessFile`, which cannot tell a type import from a value import, and it ignores imports that leave `tools/content-node`.

**Alternatives considered**:

- **A top-level `contract/`.** It works, but knip and vitest's `include` need widening.
- **A path alias (`@reactome/contract`).** A value import fails at run time (`ERR_MODULE_NOT_FOUND`) while vitest's path resolution hides the failure, and `load.spec`'s script check skips non-relative specifiers.
- **`package.json` `imports` (`#contract`).** It resolves against `tools/package.json`, and that can't point at `../`.
- **An npm workspace.** It changes the lockfile and the image, and adds nothing a module of types needs.

## R2. The search entry: kinds, fields and sources

**Decision**: the entry is a union of six kinds, as in [data-model.md](data-model.md). Each field comes from the indexer's documents, read through the Solr schema (`solr-conf/reactome/schema.xml`) and the service's `searchEntry` (`tools/content-node/search-core.ts`), which reproduces Java's `SolrConverter.buildEntry`.

**Measured**:

- **`dbId` is text.** It is a string in all 8,603 recorded entries, checked twice, because Solr stores it as a `StrField`. An interactor's `dbId` is its accession. The site's `number` is wrong.
- **Six of the 45 fields are never written.**
  - `regulator`, `regulatedEntity`, `regulatorId` and `regulatedEntityId` are in neither the indexer nor the Solr schema.
  - The builder never sets `instanceTypeExplanation`.
  - `reason`: the service reads Solr's `deletedReason`, as Java does, but the field is named `reason`, so it is never written. It is recorded as a suspected fault; the wire stays as it is.
  - None of the six is in the contract.
- **The authored and reviewed counts and `orcidId` are text.** They are Solr text fields, written as stored. No person entry is recorded.
- **`date` is a number** (epoch milliseconds).
- **`replacementDbIds` is a list of whole numbers** written exactly. Only one is recorded (`192781`), well inside the safe range.
- **`id` equals `stId`** in all 8,603 entries, and `disease` equals `isDisease`.
- **Search highlights carry markup** (`<span class="highlighting" >…</span>`). Among distinct entries: name 954, referenceName 517, summation 117, referenceIdentifier 23.

**What tells the kinds apart**, from the builders and confirmed over the recorded entries (no entry matched no kind or two):

| Kind            | Marker                                                                                                                   | Recorded (distinct entries) |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| deleted         | `deleted: true`. Its `type` reuses the live values, so `type` alone cannot pick it out.                                  | 3                           |
| icon            | `type: "Icon"`, with `icon: true`                                                                                        | 40                          |
| person          | `type: "Person"`                                                                                                         | 0                           |
| interactor      | `type: "Interactor"`                                                                                                     | 69                          |
| event           | `type` is `"Pathway"` or `"Reaction"`. A reaction's `exactType` is its category (binding, transition, …), not its class. | 450                         |
| physical entity | any other `type`                                                                                                         | 1,580                       |

**The entity's `type` is a closed set.** The indexer's `getType` and `getReferenceTypes` give "Set", "Genes and Transcripts", "Protein", "DNA Sequence", "RNA Sequence", "Chemical Compound" and "Drug", and otherwise the schema class name. So the entity kind's `type` is that list plus the physical entity and reference entity classes that fall through, taken from the domain snapshot. A literal union lets TypeScript narrow on `type`, and gives the schema an `enum`.

**A deleted entry's `type`** is drawn from the same values, and from bare class names (one recorded: "Requirement"). The deleted kind is marked by `deleted: true`. Every other kind has `deleted?: never`.

**`/search/pathways/of/{dbId}` answers a projection.** The pathway browser asks for `fields=DB_ID,ST_ID,NAME,HAS_EHLD`, so its entries carry dbId, stId, id, name and hasEHLD and no `type`. It gets a projected type of its own, derived from the event kind, rather than the union.

**Alternatives considered**:

- **One entry type with every field optional**, which is today's practice. Rejected: it is what lets four readers each require different fields (R3).
- **Telling the kinds apart by `exactType`.** Rejected: a reaction's `exactType` is its category, and a deleted entry's is its old class.

## R3. Why the search routes carry 11,452 known problems

Reproduced exactly (11,452) by running `matchAnswers` and `checkAnswers` from `tools/api-types` on the search checks.

| Route as type                                 | Not declared | Required, missing | Wrong kind |
| --------------------------------------------- | ------------ | ----------------- | ---------- |
| `/search/query` as SearchResult (8,959)       | 6,649        | 0                 | 2,310      |
| `/search/fireworks` as Search.Result (1,315)  | 755          | 560               | 0          |
| `/search/diagram/{id}` as Search.Result (744) | 396          | 348               | 0          |
| `/search/icon/query` as IconResult (200)      | 200          | 0                 | 0          |
| `/search/query` as Search.Icon.Result (144)   | 97           | 47                | 0          |
| `/search/pathways/of/{dbId}` (90)             | 9            | 81                | 0          |

**Causes**:

- **The site's `SearchEntry`:**
  - `dbId: number` (2,292) and `icon?: string` (18) give the wrong kinds.
  - These written fields are not declared: hasReferenceEntity (2,177), disease (2,159), compartmentAccession (2,036), hasEHLD (198), the icon lists, explanation and replacementDbIds.
  - `SearchResult` lacks `numberOfGroups`.
- **The site's `IconEntry` and `IconResult`:** dbId, id, type, species, hasReferenceEntity, hasEHLD and icon are not declared, and `IconResult` lacks `rowCount` and `typeName`.
- **The pathway browser's `Search.Entry`:**
  - It requires the four reference fields, which events never carry, and the compartment and disease fields, which entities often lack.
  - It declares neither id, type, hasReferenceEntity, disease, summation nor fireworksSpecies.
- **The pathway browser's `Search.Icon.Entry`:** it requires `deleted`, `date`, `isDisease` and `disease`, which icons never carry, and declares none of the icon fields.

**Gaps in the recordings:** no person entry, no `/search/icon/{id}` answer (that call is missing from `tools/api-types/calls.ts`), and no replacement id beyond the safe range. The contract's types for these follow the indexer and the converter, and the gaps are recorded where they are measured (T-tasks add recordings where the e2e suite can reach them).

## R4. Generating the description

**Decision**: ts-json-schema-generator 2.9.0 (released 4 Mar 2026; depends on `typescript ^5.9.3`, which is the repository's version), run from a script under `tools/`. Its output is wrapped in an OpenAPI 3.1 document committed at `projects/contract/openapi.json`.

**Rationale**:

- **It writes the OpenAPI discriminator.** Given `/** @discriminator type */` and `discriminatorType: 'open-api'`, it writes `oneOf` with `discriminator: {propertyName}`. I reproduced this in scratch, and ajv then rejected an unknown kind with `value of tag "type" must be in oneOf`.
- **It handles every type the site reads.** All 40 distinct types in spec 012's call table generated, 152 definitions in 2.0 s, byte-identical across two runs.
- **It handles the helpers answers are built from.** That covers `Pick`, `Omit`, `Partial`, intersections and resolved conditionals. Optional fields are left out of `required`, and objects get `additionalProperties: false`.

**Constraints that follow**:

- **Writer helpers are not generated.** `JsonWritten<T>` and `JsonMember<T>` fail generation (`Unexpected type "undefined"`, `No additional properties`), but they are writer helpers, not answer shapes. They stay in `tools/content-node/answers.ts` and take the contract's types as arguments.
- **Every type argument is named.** An anonymous argument gets a name with source positions in it (`Relationship.Has<interface--111-414--0-415>`), which would churn the committed description.
- **The search entry has no single discriminator.** Deleted entries share `type` values with live ones, so the entry is written as a `oneOf` of kinds told apart by their `const`, `enum` and `deleted` constraints, with no OpenAPI `discriminator`. Graph objects (`schemaClass`, `className`) do have one, and use it.
- **A Java long is the named alias `Long`.** It is tagged `@asType integer` and `@format int64`, which gives `{"type":"integer","format":"int64"}`, the standard OpenAPI way to say a 64-bit integer.

**Paths**:

- **The route table.** A table in the contract (`routes.ts`) lists method, route and answer type for each route in the contract, as types: a tuple type, not a value, per R1.
- **A test keeps it complete in both directions.** It checks the table against `tools/content-node/registry.ts`, as `calls.spec.ts` does for the call table. A registry route with no contract type is listed in the description as not yet in the contract (US4 scenario 3).

**Up to date**: a vitest spec regenerates the document in memory and compares it with the committed file. It takes about 2 s.

**Java's `openapi-snapshot.json`**:

- **What it is.** It holds only the parameters, which `parameters.ts` reads to put each URL in its standard form for edge caching (spec 011).
- **It stays.** The generated description covers answers, and the two sit side by side. The site's API page (`swagger-page.component.ts`) reads Java's live description today; it moves to the generated one when the service publishes it (a later task).

**Alternatives considered**:

- **typescript-json-schema 0.68.0.** It handles the helpers, but writes `anyOf` with no discriminator.
- **typia 15.2.1.** It needs a compiler transform, which breaks spec 013's rule that the service runs with no build step.
- **zod-to-openapi and TypeBox.** The schema is the source and the types come from it, which is the reverse of the agreed direction.

## R5. Checking answers in tests

**Decision**: keep spec 012's compile-based check as the backstop (FR-011), and add an ajv 8.20.0 (draft 2020-12) check driven by the generated description. It runs only in tests (FR-010).

**Rationale**:

- **Spec 012's check is the stricter of the two.** It compiles each recorded answer against the very types readers and writers compile against, so it sees what the generator approximates. It takes 48.6 s (44.1 s for `content.spec.ts`).
- **The ajv check is fast.** Over the same 423 matched answers it takes about 3 s: 2.0 s to generate, 0.76 s to compile and 0.31 s to validate.
- **Its counts agree.** It gives the same count as the compile check on 21 of 24 route and type pairs, including the main search's 8,959. It differs only in how failures inside a union are counted (ajv lists one error per failed branch).
- **It checks the published document**, so it catches what the compile check cannot see. One example is `additionalProperties: {anyOf: [{not: {}}, …]}` from an index signature intersected with named fields.
- **Union rule.** The ajv check counts one problem per failing value, with `discriminator: true` where the type has one. A failure inside a union is counted once, at the union.
- **Exact longs.** The validator reads them with a JSON.parse reviver that keeps unsafe integers exact. On Node 24, `(k, v, ctx) => Number.isSafeInteger(v) ? v : BigInt(ctx.source)` returned `9007199254740993n`. `int64` is registered as a format.

**Alternatives considered**:

- **Replacing the compile check with ajv.** Rejected: FR-011, and the generator is an approximation.
- **Validating in served requests.** Rejected: FR-010.

## R6. The shared library

**Measured**:

- ngx-reactome-base reaches this repository as two built packages, `ngx-reactome-style` and `ngx-reactome-cytoscape-style`. Its single declaration file holds styling and drawing types only: no search or answer type. That confirms spec 012's R1.
- The pathway browser's `Search` namespace holds a value (`EMPTY_RESULTS`), so it cannot move into the contract as it is. Its types become re-exports of the contract's, and the value stays in the pathway browser.

## R7. Order of work

**Decision**:

1. The plumbing, on the search facets. These are `FacetCount`, `Facet`, `FacetResponse` and `IconFacetResponse`, which the service already writes through the site's types.
   - It proves both checks, the lint and dead-code configuration, the boundary rules and the service's image, inside the family the entry joins next.
   - No answer changes.
2. The search entry, then the results, the icon results and the icon entry. This closes spec 013's T019.
3. The description: the generator, the route table and the up-to-date check, then the ajv check.
4. The rest of T019's types, family by family (content lists, schema tables, interactors, person events, locations, flags, citation).
   - The pathway browser's `Interactor` is first split into the answer and its client extension (`existingNodes`, a drawing collection). Its file also holds an enum and a class, which stay.
5. The remaining families, the most known problems first: the enhanced query (2,659), an entity's other forms (1,660), the interactors' details (1,560), then the rest. Then the analysis service.

**Rationale**: moving all 23 shared types first would touch 9 model files and 12 service modules before a single known problem falls. The facets prove the setup in one small change.

**Correction recorded in the spec**: spec 012's call table is ordered by project and file, not by how often an answer is read. The spec now orders later families by known problems.

## R8. The render and analysis types

`tools/render` imports the render service's types from `projects/` (4 imports), and `tools/analysis-types` imports the analysis model's (2). Neither is a content-service answer.

- The render service's types are a later family, as for the content service, and stay where they are until then.
- The analysis model holds values (`TYPES`), reached by one dynamic import in a spec. It is split into types and values when the analysis service's family moves (US5), not before.
