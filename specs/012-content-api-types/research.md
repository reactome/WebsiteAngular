# Research: content API types checked against real answers

All findings below were measured on 19 Oct 2026, from the code, the end-to-end recordings (`e2e/har`) and `tools/content-node/domain-snapshot.json`. No service was queried. "Recordings" means the HARs; "snapshot" means the domain snapshot.

## R1. The site's calls (inventory)

**Decision**: the list of calls is a checked-in table (`tools/api-types/calls.ts`): file, method, HTTP method, route pattern, the type the answer is read as, and its coverage. A source scan (the TypeScript compiler API, over `projects/**/src` without specs) finds every `HttpClient` call and `fetch()` whose URL is built from `CONTENT_SERVICE` or a literal `/ContentService`, and fails on one the table does not name, or one the table names that no longer exists.

**Measured**: 75 call sites (pathway-browser 41, website-angular 34). The other projects make none: `reactome-diagram-element` reuses pathway-browser's services; the table and GSA libraries call other services.

- 71 read JSON, 3 read text (`/citation/static`, `/data/query/{id}/normalPathway`, `/data/query/{dbId}/stId`), 1 reads a blob (the exporter downloads).
- 57 distinct JSON route patterns; 47 distinct answer types.
- **4 typed `any`**: the entity popup's two `/data/query*` reads and its interactor details read, and the instance browser's `/data/query/enhanced/{id}`.
- **18 read as a graph type**, which carries `[key: string]: any` (R4), so an undeclared field is accepted and reads as `any`.
- **13 pass the answer through an `as` cast** (the JSOG flatten and `catchError` fallbacks).
- **2 have no callers**: `DatabaseObjectService.fetchSimpleData` and `SpeciesService.getOrtholog`. They are removed (the dead-code count goes down).
- No answer type comes from another repository's package: the two installed Reactome packages hold styling only.
- The URL base is `CONTENT_SERVICE` (`projects/pathway-browser/src/environments/environment.ts`), except the two citation reads, which build `environment.host + '/ContentService'` and so ignore a profile's `contentService`/`contentServicePath`. That is fixed with them (R6).

**Checked, not a bug**: the search page sends its paging offset as a parameter named `Start row`. That is the name Java's published API declares for `/search/query`, and the node port's parameter record pins it (`tools/content-node/parameters.spec.mjs`).

**Alternatives**: a grep for `ContentService` finds 28 files but not the calls (URLs are built across lines and through helpers); a runtime trace in e2e sees only the calls the tests make.

## R2. What the recordings cover

**Measured**: 3,953 content API requests in 413 HARs; 57 route families (stIds, dbIds, accessions, tokens and classes normalised; the query string ignored); 349 distinct JSON bodies. The spec's first count (67 families, 367 bodies) used a coarser normalisation and is corrected in the spec.

Covered with successful JSON answers: every route the site reads except the gaps below. The largest families: `query/enhanced/v2/{id}` (977 requests, 86 bodies, 74.5 MB), `eventsHierarchy/{taxId}` (92, 12 bodies, 49.4 MB), `event/{id}/ancestors` (447, 41 bodies).

**Gaps (no successful recorded answer)**:

- `/data/entity/{id}/in-depth` and `/data/event/{id}/in-depth`: never recorded. They are the endpoints said to answer an empty body for an unknown identifier.
- `/search/fireworks/flag`: recorded only as aborted requests.
- `/data/orthology/{id}/species/{dbId}`: its only reader has no callers (R1).
- `/interactors/token/{token}`: recorded only as a 404; `/interactors/upload/*`: never (uploads are stored for good, so they are not recorded).
- `/interactors/static/molecule/{acc}/details` (GET, read as `any`): not recorded.
- `/citation/pathway/{id}`: not recorded.

**Empty answers seen**: `[]` from the four person event lists for a person with none, from interactor details for two accessions, from spellcheck (always, in the recordings) and suggest. No successful answer anywhere has a zero-length or `null` body. Error answers are JSON `{code, reason, url, messages, targets}`, except a Tomcat HTML page for an encoded slash.

11 successful recorded answers have no body (the recorder dropped them; eventsHierarchy 6, species 2, others 3). They are skipped as stubs are in #540, and counted.

## R3. The check: compile each answer as its type

**Decision**: #540's approach (`tools/analysis-types/analysis-model.spec.mjs`): each distinct answer becomes a virtual file `const answer: <Type> = <body>`, compiled with the project's own compiler options. Generalised into `tools/api-types/`, with the AnalysisService check moved onto the shared helper.

**Measured** (TypeScript 5.9, the project's tsconfig, `types: []`):

| Run                                                          | Answers  | Size       | Time      | Memory       |
| ------------------------------------------------------------ | -------- | ---------- | --------- | ------------ |
| All distinct bodies as `unknown`, one program                | 357      | 24.6 MB    | 17 s      | 1.9 GB       |
| The same, four programs                                      | ≈89 each | ≈6 MB each | ≈5 s each | ≈0.7 GB each |
| `eventsHierarchy` against the site's type as it is (failing) | 12       | 10.8 MB    | 73 s      | 2.2 GB       |
| `eventsHierarchy` against a type that passes                 | 12       | 10.8 MB    | 11.5 s    | 1.2 GB       |

A passing check costs about 1–2 s per MB; a failing one about 7 s per MB, because the compiler reports every element. **So the check runs as one program per route group** (eventsHierarchy alone; `query/enhanced/v2`; the rest in two), each under about 1.2 GB and a 60 s test timeout when passing.

**Until a route's type passes**, its answers are checked against a ratcheted list of known problems, by route and count: a count may go down, never up, and a route at zero is checked strictly. That lets the instrument land first (Story 1) and each type be fixed in its own pull request, as the lint ratchet works.

**Naming the field** (FR-002): "missing" and "does not exist" messages name the field; a wrong-kind message does not ("Type 'string' is not assignable to type 'number'"). The check maps the diagnostic's position in the virtual file back to the JSON path of the value it points at, and reports that path.

**Types defined in component or service files** (`Search` in `search.component.ts`, `EventsHierarchy` in `reacfoam.service.ts`) pull in Angular and about 330 files when imported, and an unrelated library without declarations. They move to model files (R6), which the check imports.

**Alternatives**: JSON Schema generated from the types (a new dependency, and a second statement of each type); a runtime validator library (the same); checking only key sets in a script (misses kinds).

## R4. The index signature on every graph type

`DatabaseObject` (`projects/pathway-browser/src/app/model/graph/database-object.model.ts`) declares `[key: string]: any`, and every graph type extends it. With it, the compile check can never report an undeclared field on a graph type, and accepts the JSOG `@id` keys silently.

**Decision**: remove it. **Measured**: removing it gives 97 type errors in 11 files of the application build (templates add some, checked by the build). That is one pull request, done before the graph routes' types are tightened.

**Site-only state** mixed into the API types (never written by the service: `Event.isSelected`, `isHovered`, `ancestors`, `parent`, `hit`; `Pathway.subpathwayColor`, `hitReactionsCount`; the relationship's `index`, `moleculeView`, `highlight`; `DatabaseObject._updateCounter`, `isLoaded`; `Species.shortName`, computed by the site) moves into separate interfaces the site's own state extends, so the API type says only what the service sends.

**Alternatives**: keep the signature and walk keys separately (two checks for one question); strip it in the check with a mapped type (the site's code would still read undeclared fields as `any`).

## R5. The graph types against the snapshot

**Snapshot structure** (`tools/content-node/snapshot-domain.mjs`, expanded by `domain.mjs` `SNAPSHOT()`): `json` lists, for each of 110 concrete classes, the JSON properties Jackson writes, in order, with a view mask (1 Flatten, 2 Nested, 4 NestedAggregated) and a marker for doubles; `properties` holds the entries; `getterEntries`/`getters` give each property's Java kind; `graph` gives SDN fields and constructor defaults; `store` gives each class's labels (its ancestors). Inheritance is flattened per concrete class; abstract classes have no `json` entry.

**What is always written**: inclusion is global `NON_EMPTY` (null, empty string and empty list omitted; `false` and `0` written). So a property is guaranteed only when its value can never be empty: `schemaClass`, `className`, constructor defaults (`hasEHLD` on the pathway classes, `moleculeType` on six reference classes), a relationship's `type`, `stoichiometry`, `order` and `element`. `dbId` and `displayName` are on every node in the data. Everything else is "present when the data has it", which only the recordings measure.

**The site's graph types**: 121 interfaces in `model/graph/**`, one per Java class with the same names except `Go_Term` (GO_Term), `RnaDrug` (RNADrug) and four relationship names. All 117 checkable interfaces map to a snapshot class; none is missing.

**Decision**: a class-by-class check with the compiler API (`tools/api-types/snapshot.spec.mjs`): an explicit mapping table (TS type → Java class), each type's properties (with inheritance, optionality and resolved element declarations) against the union of its concrete Java descendants' written properties.

- Declared, never written by any mapped class in any view: **fail**.
- Declared and required, but not always written: **fail**, unless a recorded answer shows it always present (the recordings, R3, decide).
- Wrong kind (single vs list, string vs object, number vs string) or wrong element class: **fail**.
- A relationship type literal that differs from Java's `getType()`: **fail**.
- Written, not declared: **listed**, not a failure (FR-006).

**First findings** (all fixed as tasks, each shown failing first):

- `NegativePrecedingEvent.precedingEvent: Event[]` resolves to the **browser's DOM `Event`** (the file has no import).
- `Type.MODIFIED_RESIDUE = 'modifiedResident'`; Java writes `'modifiedResidue'`.
- `Book.ISBN` (Java writes `isbn`), `TranslationalModification.label` (never written), `PhysicalEntity.type` (required, never written), `Publication.authorName` (never written by this service).
- Single where Java writes a list: `name` on the external ontologies, `Affiliation` and `FunctionalStatusType`; `ReferenceSequence.description`; `Interaction.accession`; `EntityFunctionalStatus.functionalStatus`; `ReferenceIsoform.isoformParent`; `Deleted.deletedInstanceDbId`. A string where Java writes objects: `ReactionLikeEvent.reactionType`, `NegativePrecedingEvent.reason`.
- Wrong element class: `PhysicalEntity.compartment`, `componentOf`, `consumedByEvent` are typed as relationship objects, but in the Flatten view Java writes the classes themselves (the relationship forms are `hasCompartment`, `componentOfComplexes`, `inputFor`, in the nested views).
- Narrower than Java: `Event.literatureReference: LiteratureReference[]` (Java: any Publication, so a Book or URL too). Listed.

**Traps**: compare JSON names, never Java field names (`isbn`/`ISBN`, `inDisease`/`isInDisease`); never use `className` as a discriminant (it is a label: "Reaction" for every reaction-like event); resolve element types to declarations, not names (the DOM `Event`); read enum values, not their names; `exactOptionalPropertyTypes` is on, so optionality is read from the symbol, not from `undefined` in the type; relationship classes, `Default` and `SummaryEntity` have no kind information in the snapshot, so their kinds are checked by the recordings only.

**Alternatives**: generate `.d.ts` per Java class and assert key inclusion with conditional types (works, but messages are poor and the index signature must be stripped first).

## R6. Projections: one class, several shapes

**Measured in the recordings**:

- **Two views.** `query/enhanced/v2` and `ancestors` are asked for with `view=nested-aggregated`; other routes use the Flatten view. The view changes property names: v2 writes `inputs`/`outputs`, `hasCompartment`, `events`, `eventOfPathways`, `components`, `members`, `componentOfComplexes`, `memberOfSet`, `inputFor`/`outputFor` where `data/query` and v1 enhanced write `input`/`output`, `compartment`, `hasEvent`, `eventOf`, `hasComponent`, `hasMember`, `componentOf`, `memberOf`, `consumedByEvent`/`producedByEvent`.
- **`ancestors` writes other names again**: `inDisease`, `inferred`, `diagramHeight`, `diagramWidth`, `oldStId`, no `className`, `maxDepth` or `species`.
- **Root vs nested** within v2: the root object carries far more than the same class nested (Pathway: 20 always-present keys as root, 16 nested).
- **List projections**: `pathways/top` (15 keys), `pathways/low/entity` (14; no `species` or `summation`), `otherForms` (no `compartment`, `species` or `referenceEntity`), `participants/{id}/referenceEntities` (no `physicalEntity`, `referenceDatabase`, `species`), the person event lists (a different object: `authorDbId`, `dateTime`, `labels`, …), `participants/{id}` (its own DTO).
- **Identity**: v2 (and the in-depth routes) write JSOG: a repeated object is `{"@ref": "<n>"}` and objects carry `"@id"`. `JSOGDeserializer` resolves `@ref` and leaves `@id`. Other routes write a repeated object as its bare `dbId` number (in `data/query`, v1 enhanced, `pathways/top`'s `species` after the first pathway, a person's publications' `author`), and nothing on the site resolves those.
- **Omitted, never empty**: no graph object in any answer holds `null`, `[]`, `""` or `{}`. Every field that can be empty is left out (Person `orcidId` on 179 of 17,060; Reaction `catalystActivity` on 113 of 288).

**Decision**:

- The **wire type** is checked: what `HttpClient` hands the site, before any pipe. For JSOG routes, a mapped type `Jsog<T>` (every graph-valued field also admits `{'@ref': string}`, every graph object `'@id'?: string`); for Flatten routes, `ByDbId<T>` (every graph-valued field also admits `number`). The site's code reads the resolved type after `JSOGDeserializer`, which is typed `Jsog<T> → T` instead of a cast.
- Where a route's shape differs from the class type, measured, it gets **its own named projection type** (`AncestorPathway`, `TopLevelPathwaySummary`, `PersonEvent`, …), defined once.
- Fields absent in some answers are **optional**; required only where every recorded answer has them and the snapshot cannot rule out absence.
- Whether a route can answer an empty body (the in-depth routes) is measured by the corpus (R8) before its type says so; the code keeps its guard either way (FR-010).

**Alternatives**: one type per class for every route (cannot be both `input` and `inputs` without making everything optional, which says nothing); typing the resolved object only (the check cannot serialise a cyclic object back to a literal).

## R7. Duplicates

**Measured**, the shapes defined more than once (each pair is listed in the inventory):

- **Person** three times (graph model; the person page's own; `SimplePerson`), with `Affiliation.name` string vs list and `Publication.author` objects vs numbers disagreeing.
- **Search** entry four times (`dbId` a string in two, a number in two; the answers send a string), result group three times, `{name, count}` facet three times, `{selected, available}` twice, search result twice.
- **Tree node** twice (`EventsHierarchy.Data`, `PathwayBrowserNode`); **small event projections** five times; **reference entity** three times; **TocPathway/DoiPathway** near-duplicates.
- **Same route read as different types**: `query/enhanced/{id}` (two `any`, one inline), `data/query/{id}` (`any`, inline), `ancestors` (three ways), `pathways/low/entity` (two), `participants/{id}/referenceEntities` (two), `person/{id}` (two).
- **Copied code**: the entity, data-state and interactor services each exist in pathway-browser and as website providers; the JSOG flatten is written five times.

**Decision**: one definition per shape, in a model file of the project that owns the route (pathway-browser's `model/` for what both projects read). The copied services become one, read by both. A route read as two types is read as one, or as two named projections of one definition where the readers need different parts.

## R8. Recording what the recordings miss

**Decision**: `tools/api-types/record.ts`, like #540's recorder: reads our own content service (the node service on this host, never production), one request at a time with a pause, a fixed list of at most 40 requests, into `tools/api-types/recorded/`. It covers the gaps in R2 that can be read without side effects: both in-depth routes (a known event and entity, and an unknown identifier for the empty answer), the Reacfoam flag, the GET interactor details, `citation/pathway`. Uploads and tokens are not recorded (uploads are stored for good). Bodies are trimmed to one page where the site asks for one.

**Rationale**: the shared graph database was overloaded by test traffic before; a bounded, sequential list keeps this negligible.

## R9. Order of delivery

1. **The instrument** (Stories 1–2): the call table and its source scan; the compile check per route group with its ratcheted list of known problems; the AnalysisService check moved onto the shared helper. Types used by the check move to model files.
2. **The index signature** removed, site-only state split out (R4).
3. **The snapshot check** (Story 3) and the class fixes it finds (R5).
4. **Projections and identity** (Story 4): `Jsog<T>`, `ByDbId<T>`, the named projection types, the `any` calls typed, route by route until the ratchet list is empty.
5. **Duplicates** (Story 5) and **the corpus** (Story 6).

Each step is its own pull request, reviewed, with each check shown failing first.
