# Feature Specification: Content API types checked against real answers

**Feature Branch**: `spec/012-content-api-types`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "ContentService response types checked against real answers (follows spec 010 Story 5 / PR #540, which did this for the AnalysisService). Add the types now, because they help identify unintended behaviour. Every ContentService call the site makes reads its answer as a type that is checked against real answers, so an undeclared field, a missing required field or a wrong kind is a failing test rather than a silent bug. Sources of truth: the answers recorded in the end-to-end recordings plus a small recorded corpus, and the domain snapshot of what Java writes for every graph class. Needs an inventory of call sites, the check itself, one definition per shape, a type per projection where they differ, and empty answers said in the types. Each type changed only on the evidence of a real answer; a guard on API data is never removed on the word of a type. Out of scope: changing any answer, GraphQL, the AnalysisService, GSA."

## Background

The site reads the content API (`/ContentService/…`) in 28 source files, and each call names the type it expects the answer to have. Nothing checks those types against what the service really sends. A type that is wrong does not fail anywhere: the code that reads a missing field gets `undefined`, and the reader sees a blank where data should be. That is how a blank view shipped for an analysis type missing from a list (spec 010), and how guards that looked unnecessary on the word of a type turned out to be needed: in October's strictness work roughly a third of them were, and removing two broke the reaction page.

Decided by awright, 19 Oct 2026: add the types now, rather than after the port, "it could easily help us identify unintended behaviour". The AnalysisService's types were checked this way first (#540). Its first run found a field typed as always present that one kind of answer leaves out.

What there is to check against, measured 19 Oct 2026:

- **The end-to-end recordings** hold 3,953 content API requests across 57 route families, with 349 distinct JSON answer bodies. They are real answers from the service.
- **The domain snapshot** (`tools/content-node/domain-snapshot.json`) records, for each of 110 graph classes, the properties the Java service writes, read from its own libraries. It covers classes that no recording happens to contain.

## User Scenarios & Testing _(mandatory)_

The "users" here are the site's developers and, through them, its readers: a reader is never shown a blank because a type promised a field the answer does not have.

### User Story 1 - Every recorded answer is checked against the type the site reads it as (Priority: P1)

A developer changes a type, or the service changes an answer. Every real answer on record is checked against the type the site reads it as, and a field the type does not declare, a field it requires that the answer lacks, or a value of the wrong kind fails the check, naming the route and the field.

**Why this priority**: this is the instrument. Everything else in this feature is fixing what it finds.

**Independent Test**: run the check on the recordings. Remove a field the site reads from one recorded answer: it fails, naming that answer. Add an undeclared field: it fails. Change a field's kind in a type: it fails.

**Acceptance Scenarios**:

1. **Given** the recordings, **When** the check runs, **Then** every successful content API answer whose route the site reads is checked against that route's type, and none is skipped silently: an answer whose route nothing reads is listed.
2. **Given** a recorded answer without a field its type requires, **When** the check runs, **Then** it fails, naming the route and the field.
3. **Given** a recorded answer with a field its type does not declare, **When** the check runs, **Then** it fails, naming the route and the field.
4. **Given** the check passes, **When** a type is made stricter than the answers allow, **Then** it fails.

---

### User Story 2 - Every call names a real type (Priority: P1)

Each place the site asks the content API for something is listed: the route it calls, and the type it reads the answer as. A call that reads its answer as "anything" (`any`, `unknown`, an unchecked cast) gets the real type of what comes back.

**Why this priority**: a call typed "anything" is invisible to the check in Story 1, so the check covers only what is typed.

**Independent Test**: the list of calls is compared with the site's source; a call missing from the list, or one typed "anything", fails.

**Acceptance Scenarios**:

1. **Given** the site's source, **When** a new content API call is added without an entry in the list, **Then** a check fails.
2. **Given** the list, **When** it is read, **Then** each call has a route, the type its answer is read as, and whether recorded answers cover it.
3. **Given** a call typed "anything" today, **When** this feature is done, **Then** it reads a named type checked by Story 1.

---

### User Story 3 - The graph types agree with what the service writes for each class (Priority: P2)

The site's types for the graph's classes (pathways, reactions, physical entities, literature references and the rest) are checked class by class against the domain snapshot: each property the type declares exists in what Java writes for that class, and each property Java always writes is declared. This covers classes no recording contains.

**Why this priority**: recordings cover the pages the tests visit. The snapshot covers every class, so a class rarely seen (a polymer, a drug, a book) is checked too.

**Independent Test**: rename a property in one class's type: the check fails naming the class. Remove a class from the snapshot: the check fails for the type that models it.

**Acceptance Scenarios**:

1. **Given** a graph class the site has a type for, **When** the type declares a property Java never writes for that class, **Then** the check fails.
2. **Given** a property Java writes for a class, **When** the site's type leaves it out, **Then** it is listed (as not read by the site), not silently ignored.
3. **Given** a class the site models, **When** it is not in the snapshot, **Then** the check fails.

---

### User Story 4 - A type says what each endpoint really sends (Priority: P2)

The same class comes back in different shapes from different endpoints: in full from one, as a projection without its events or references from another. Some lists are left out when empty, and some endpoints answer an empty body for an identifier they do not know. Each type says this, measured on real answers: where shapes differ by endpoint, each endpoint is read as its own shape; where a field can be absent or the answer empty, the type says so.

**Why this priority**: these are the cases that broke pages before (the reaction page twice, an empty body reaching code that assumed an object).

**Independent Test**: for an endpoint that sends a projection, a recorded answer is checked against the projection's type, and against the full type it fails. For an endpoint that sends an empty body, the type admits it.

**Acceptance Scenarios**:

1. **Given** two endpoints sending the same class in different shapes, **When** each is checked, **Then** each passes against its own shape.
2. **Given** an endpoint that answers an empty body for some identifiers, **When** its type is read, **Then** it admits the empty answer, and the code reading it handles it.
3. **Given** a list Java leaves out when empty, **When** its type is read, **Then** the field is optional.

---

### User Story 5 - One definition for each shape (Priority: P3)

Each answer shape is defined once. A shape copied by hand into another file or project is replaced by the one definition.

**Why this priority**: two copies drift apart, and the check in Story 1 only proves the copy it checks.

**Independent Test**: a search for each shape's fields finds one definition; the check from Story 1 covers it.

**Acceptance Scenarios**:

1. **Given** two definitions of one answer shape, **When** this feature is done, **Then** there is one, and both readers use it.

---

### User Story 6 - Shapes the recordings never reach are recorded (Priority: P3)

Where a route the site reads has no recorded answer, or a kind of answer the recordings never contain (an empty answer, a rare class), a small corpus of real answers is recorded from our own service and checked too.

**Why this priority**: it closes gaps Story 1 lists; the recordings already cover most routes.

**Independent Test**: the list from Story 2 shows each route as covered by the recordings, by the corpus, or as a named gap.

**Acceptance Scenarios**:

1. **Given** a route with no recorded answer, **When** the corpus is recorded, **Then** its answers are checked like the recordings'.
2. **Given** the corpus is recorded again, **When** it runs, **Then** it reads one request at a time, a bounded number of requests in all.

### Edge Cases

- An answer whose route the site never reads (the recordings capture what pages load, including other services): listed, not checked, never a failure.
- A recording made against an older release: a difference is reported against the route, and a recording is only made again from our own service.
- A union the answers never exercise in full (a value the type allows that no answer has): the check cannot prove it either way, and it is listed rather than removed.
- A field typed loosely on purpose (an open string where a list of known values degrades better): kept, with a separate check that every recorded value is a known one, as #540 did for analysis types.
- A type shared with another repository's library: checked here; changed there through that repository's own review.
- An answer too large to keep in the repository: recorded as one page or a bounded sample, as the site itself asks for it.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Every successful content API answer in the recordings and the corpus, on a route the site reads, MUST be checked against the type the site reads it as.
- **FR-002**: The check MUST fail on a field the type does not declare, a field it requires that the answer lacks, and a value of the wrong kind, naming the route and the field.
- **FR-003**: The check MUST list, not fail on, recorded answers on routes the site does not read.
- **FR-004**: There MUST be one list of the site's content API calls: route, the type its answer is read as, and its coverage. A call in the source missing from the list MUST fail a check.
- **FR-005**: No content API call MUST read its answer as "anything" once its story is done.
- **FR-006**: The site's graph class types MUST be checked against the domain snapshot class by class: a declared property Java never writes fails; a written property the type leaves out is listed.
- **FR-007**: Where an endpoint sends a class in a different shape from another, measured on real answers, it MUST be read as its own shape.
- **FR-008**: A field that can be absent, and an answer that can be empty, MUST be said so in the type, on the evidence of a real answer.
- **FR-009**: A type MUST be widened or narrowed only on the evidence of a real answer, and the change MUST say which answer.
- **FR-010**: A guard in the site's code on API data MUST NOT be removed because a type says it is unnecessary.
- **FR-011**: Each answer shape MUST be defined once; hand-copied duplicates MUST be replaced by it.
- **FR-012**: Recording the corpus MUST read our own service one request at a time, with a bounded total, and record nothing that is not public data.
- **FR-013**: Every check MUST be shown failing on a deliberate mistake before it is trusted.
- **FR-014**: No answer from the service may change: this feature changes types and the site's code only.
- **FR-015**: Lint and dead-code counts MUST NOT go up.

### Key Entities

- **Call**: a place in the site's source that asks the content API for something: its route pattern, method, and the type it reads the answer as.
- **Recorded answer**: a real answer from the service, from the end-to-end recordings or the corpus: route, status, body.
- **Answer shape**: the type an answer is read as; one per projection where shapes differ.
- **Class description**: what the Java service writes for one graph class, from the domain snapshot.
- **Gap**: a route or shape with no real answer to check it against, named in the list.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Every content API call the site makes is in the list, and none reads its answer as "anything".
- **SC-002**: Every successful recorded answer on a route the site reads (349 distinct JSON bodies today, plus the corpus) is checked, and the check passes.
- **SC-003**: Every graph class the site has a type for is checked against what the service writes for it.
- **SC-004**: Each check, given a deliberate mistake (a removed field, an undeclared field, a wrong kind), fails and names where.
- **SC-005**: Every difference the check finds between a type and the answers is resolved by changing the type or the site's handling, never by changing an answer, and each is recorded with the answer that showed it.
- **SC-006**: The site's own tests and end-to-end suite pass, and lint and dead-code counts are no higher than before.

## Assumptions

- The recordings are real answers from the service as it runs on beta; the corpus is recorded from our own service, never from production, with one request at a time.
- The domain snapshot is kept current by its own tooling when the Java libraries change; this feature reads it, and does not regenerate it.
- The approach of #540 (each answer compiled as a value of its type, with the project's own compiler settings) carries over; it caught missing, undeclared and mistyped fields there.
- Types from another of Reactome's repositories are checked here; changes to them go through that repository.
- The exporters' binary answers (images, PDFs, documents) and plain-text answers are not JSON shapes; they are listed as such, not checked. Search answers are JSON and are in scope.
