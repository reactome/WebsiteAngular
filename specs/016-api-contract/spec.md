# Feature Specification: One API contract for the content service and the site

**Feature Branch**: `spec016/api-contract`

**Created**: 2026-10-26

**Status**: Draft

**Input**: User description: "End-to-end API types for the content service and the site, agreed with the user on 22 Oct 2026 as the spec after spec 013. One shared API contract module of answer shapes: the content-node handlers declare their answers as the contract's types and the site's services read the same types, so a field renamed or retyped on either side fails the build on both. Graph objects are discriminated unions on `schemaClass`/`className`, which the JSON already carries: nothing on the wire changes. Generate the OpenAPI description FROM the shared types, not the reverse. Runtime validation in tests only, never in production. Spec 012's recorded-answer check stays as the backstop. Spec 013's T019 work is the starting point and moves into the contract module. First target: the search entry, defined once from the search indexer's document classes as a union by kind; then the icon entry, the search results and facets, which closes spec 013's last item. Where the site's type and the written answer disagree, the type follows what is written. Later targets: the rest of the content service's answers, then the analysis service's. Keep the contract shaped so a schema could generate it later; no work on that now."

## Background

Decided 22 Oct 2026: after the services are typed (spec 013), one contract for the answers, shared by the service that writes them and the site that reads them, with the API description generated from it.

Spec 013 made the content service write some answers through the site's own model types (T019: the contents lists, the schema tables, the facets, the interactors, the person event lists and others). That joins the two halves answer by answer, but the types still live in the site, are imported by the service from there, and cover only what was converted. The API description the service publishes is still Java's, which describes most answers as a generic object: nothing can be generated from it, and nothing checks it against what is written.

The search answers show the cost, measured 26 Oct 2026:

- **One answer, four descriptions.** A search entry is described by the site's `SearchEntry` and `IconEntry` and by the pathway browser's `Search.Entry` and `Search.Icon.Entry`, each partial, each overlapping the others. The service builds the entry field by field from the search index with every value untyped (45 fields, each written only when it holds something).
- **They disagree with what is written.** The recorded-answer check (spec 012) holds 23,616 known problems across 24 route and type pairs; 11,452 of them (48%) are on the search routes (five routes, six route and type pairs), 8,959 on the main search alone. One example: the site's type says `icon` is text, and the service, like Java, writes `true`.
- **The authority is elsewhere.** What a search entry can hold is decided by the search indexer's document classes (the general document, 56 fields; the icon document, 12 more; the deleted document, 11; the person and interactor builders), as Java's search code turns them into an entry. None of the four descriptions is derived from it.

## User Scenarios & Testing _(mandatory)_

The "users" are the developers changing the content service or the site, and anyone reading the published API description; through them, every visitor whose page reads an answer.

### User Story 1 - A shape changed on one side fails on both (Priority: P1)

A developer renames or retypes a field of an answer, in the service that writes it or in the site that reads it. The build fails on both sides, naming the writer and every reader, before anything is merged.

**Why this priority**: this is the point of the contract. Today a field can be renamed in the service and the site keeps compiling against its own copy until a page shows nothing.

**Independent Test**: rename one field of a contract type: the service module that writes it and each site and pathway-browser reader fail the check. Undo it: both pass.

**Acceptance Scenarios**:

1. **Given** an answer in the contract, **When** its type is read, **Then** there is exactly one definition, and the service's writer and every reader in the site and the pathway browser use it.
2. **Given** a field renamed or retyped in that definition, **When** the checks run, **Then** the service and every reader that uses the field fail, naming file and line.
3. **Given** the service's writer, **When** it writes a field the contract does not have, **Then** the check fails.

---

### User Story 2 - The search entry is defined once, from its authority (Priority: P1)

A search answer's entry is one type: a union by kind (event, physical entity, icon, person, deleted, interactor), each kind carrying the fields the search indexer can give it, as Java's search code writes them. The service builds it through that type and the site and the pathway browser read it through that type.

**Why this priority**: it is the first target, the largest share of known problems, and the case that has four descriptions today.

**Independent Test**: the recorded search answers checked against the new type: every entry matches one kind, and the search routes' known problems fall to zero or to a recorded, explained remainder.

**Acceptance Scenarios**:

1. **Given** the indexer's document classes and Java's conversion, **When** the entry type is read, **Then** each field names its source and its kind, and each kind holds only the fields that kind can carry.
2. **Given** the recorded answers of every search route, **When** they are checked against the entry type, **Then** each entry matches exactly one kind.
3. **Given** the site's two entry types and the pathway browser's two, **When** this story is done, **Then** they are gone, replaced by the contract's type (or a named view of it).
4. **Given** the service's entry builder, **When** it is read, **Then** no value it writes is untyped.
5. **Given** any search request, **When** it is answered after the change, **Then** the answer is byte-identical to before.

---

### User Story 3 - The search results, facets and icon entry follow (Priority: P1)

The search results (grouped and flat), the diagram and species-overview search results, the facets, the icon library's results and the icon entry (`/search/icon/{id}`) are in the contract, built on the entry type. This closes spec 013's last open item (T019's icon entry).

**Why this priority**: the entry alone leaves the answers that carry it described four ways; finishing the family ends the search routes' share of known problems.

**Independent Test**: every search route's recorded answers checked against the contract's types: zero known problems, or each remaining one recorded with its reason.

**Acceptance Scenarios**:

1. **Given** each search route the site or the pathway browser calls, **When** its answer type is read, **Then** it is the contract's.
2. **Given** spec 013's tasks, **When** this story is done, **Then** T019 is ticked with this work's pull requests.

---

### User Story 4 - The API description is generated from the contract (Priority: P2)

The published description of the API (the OpenAPI document) is generated from the contract's types, so it says what is actually written: the kinds of a union, the fields each holds, which are optional. Java's hand-maintained, loose description is no longer the source.

**Why this priority**: it gives readers outside this repository (other tools, other teams) a description that cannot drift from the service, but it depends on the contract existing first.

**Independent Test**: change a field in the contract: the generated description changes in the same build, and a check fails if the committed description is out of date.

**Acceptance Scenarios**:

1. **Given** the contract, **When** the description is generated, **Then** each answer in the contract appears with its fields and, for a union, its kinds and the field that tells them apart.
2. **Given** a contract change without the regenerated description, **When** the checks run, **Then** they fail.
3. **Given** an endpoint not yet in the contract, **When** the description is read, **Then** it says so rather than presenting a generic object as if it were checked.

---

### User Story 5 - The rest of the content service, then the analysis service (Priority: P3)

The remaining answers move into the contract family by family, the families with the most known problems first (after search: the enhanced query, an entity's other forms, the interactors' details), then the analysis service's. The search family's types that the service already writes through the site's (spec 013's T019: the facets) move in first, as the smallest change that proves the contract works on every side; the other T019 types follow the search entry, family by family.

**Why this priority**: the value grows with coverage, but each family is independent and can wait.

**Independent Test**: for a family moved in, its recorded answers check against the contract with the family's known problems at zero or explained, and the family's writers and readers use only the contract's types.

**Acceptance Scenarios**:

1. **Given** a family moved into the contract, **When** its known problems are counted, **Then** the count is zero or each remaining one is recorded with its reason.
2. **Given** the count of known problems overall, **When** a family moves in, **Then** the count does not go up.

### Edge Cases

- **A field that is sometimes a list and sometimes one value** (measured in spec 012): described as either, never as "anything".
- **A field Java leaves out when empty** (empty text, empty list, null) while still writing `false`: optional in the type, and the empty-is-absent rule stays the writer's, not the reader's guess.
- **A union kind whose distinguishing field is missing or unexpected** in a recorded answer: the recorded-answer check reports it; the service does not start rejecting or rewriting answers.
- **Highlighting**: a name or summation written from a search highlight carries markup; its kind is still text, and the type does not promise plain text.
- **Large numbers** written exactly (the replacement ids, written as whole numbers beyond safe integer range): described by what a reader can rely on, not by what a parser rounds them to.
- **The species-overview searches** add a field (the entry's species there) only on those routes: described on those routes' types, not on every entry.
- **A reader's type with client-only fields** (the pathway browser's interactor holds a drawing library's node collection): split into the contract's answer type and a client extension of it; only the answer type is in the contract.
- **A field the indexer has and Java's conversion never writes** (six of the 45, one of them a deleted entry's reason, read under another name than the index's): not in the contract, since nothing writes it; a suspected fault is recorded and raised with the team, and the answer stays as Java writes it.
- **An answer only the service writes** (no reader in this repository): in the contract if it is published in the description, beside the service otherwise (spec 013's T020).
- **Runtime validation**: a validator built from the contract runs in tests (the recorded answers, the parity comparison) and never in a served request.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: There MUST be one contract of answer shapes, readable by the content service, the site and the pathway browser, with exactly one definition per answer shape it holds.
- **FR-002**: The service's writer for an answer in the contract MUST be checked against the contract's type, so writing a field the type lacks, or of another kind, fails the check.
- **FR-003**: Every reader of an answer in the contract, in the site and the pathway browser, MUST use the contract's type (or a view derived from it), and no second description of that answer may remain.
- **FR-004**: Graph objects and search entries MUST be described as unions told apart by a field the answer already carries (`schemaClass`, `className`, or the entry's kind fields); nothing written may change to make a union work.
- **FR-005**: No answer may change: every route whose writer is moved onto the contract MUST answer byte-identically before and after, shown by the parity comparison and the end-to-end suite.
- **FR-006**: Where the contract's type and what is written disagree, the type MUST follow what is written, measured on the recorded answers; a ported endpoint keeps answering exactly as Java does.
- **FR-007**: The search entry MUST be derived from the search indexer's document classes as Java's search code converts them, each field naming its source, and grouped by kind.
- **FR-008**: The search results, facets, icon library results and icon entry MUST be in the contract, closing spec 013's T019.
- **FR-009**: The API description MUST be generated from the contract, and a check MUST fail when the committed description is out of date with the contract.
- **FR-010**: Validation of answers against the contract MUST run only in tests (recorded answers, the parity comparison), never in serving a request.
- **FR-011**: Spec 012's recorded-answer check MUST stay, read the contract's types, and its count of known problems MUST NOT go up.
- **FR-012**: Each new check MUST be shown failing before it is trusted (constitution III).
- **FR-013**: The contract MUST be kept in a form a schema could later generate, with nothing in it that only hand-writing can express without a recorded reason.
- **FR-014**: Moving types into the contract MUST happen one family per change, each deployed and verified before the next; lint, dead-code and loose-value counts MUST NOT go up.

### Key Entities

- **Contract**: the set of answer shapes, one definition each, that writers and readers share.
- **Answer type**: what one route (or family of routes) writes, in the contract.
- **Search entry**: a union of kinds (event, physical entity, icon, person, deleted, interactor); each kind's fields come from the indexer's document classes.
- **Known problem**: a place where a recorded answer does not match the type its reader uses; counted per route and type, never allowed to rise.
- **API description**: the published, generated document of the contract.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A field renamed in any contract type fails the check in the service and in every reader, every time it is tried.
- **SC-002**: The search entry has one definition, down from four.
- **SC-003**: The search routes' known problems fall from 11,452 to zero, or to a remainder in which each is recorded with its reason.
- **SC-004**: Total known problems fall from 23,616 and never rise at any merge.
- **SC-005**: Every search answer is byte-identical before and after each change.
- **SC-006**: The published API description lists, for the search entry, each kind and its fields, where today it lists a generic object, and it is regenerated in the same change as any contract change, every time.
- **SC-007**: No served request runs a validator.

## Assumptions

- The recorded answers from spec 012 and the end-to-end recordings are the evidence; this feature records new answers only where a kind has none.
- The search indexer's source (reactome/search-indexer) at the release in use is the authority for what an entry can hold; Java's search code is the authority for how it is written; the service already reproduces it byte for byte.
- Where the contract module lives, and how the site, the pathway browser and the service import it, is a planning decision; it must not need a separate build step to run the services (spec 013).
- The shared library (ngx-reactome-base) holds only styling types and reads no answer (measured 26 Oct 2026), so it is outside this feature.
- The schema project (reactome/reactome-schemas) may later generate graph types; no work on that here.
- Public repository: no internal host names, paths or people's names in the contract, the description or the specs.
