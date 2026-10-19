# Feature Specification: Types in the server-side services

**Feature Branch**: `spec/013-server-types`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Types in the server-side node services, before porting more endpoints: the content service, the render service, the analysis gateway and the small tools beside them, untyped today. Every module type-checked in CI under the site's strictness, so a wrong field, a missing case or a value of the wrong kind in the services is a compile error rather than a production bug. Types describe real data: graph rows, the domain snapshot's classes, the Java answer shapes the service writes, Solr answers, the render service's requests; one definition per shape, shared with the site's where they describe the same answer. No behaviour change: every answer stays byte-identical to Java. Mechanical conversion first, then types tightened module by module, one module or small group per pull request, the services running on beta after each. Out of scope: porting more endpoints, changing any answer, the site's own types."

## Background

Decided by awright, 19 Oct 2026: "I feel like we first add in types as much as possible to the serverside node services code", before the remaining endpoints are ported (the held exporters, the events hierarchy, the endpoints Java does not publish, and ORCID last).

The services that now answer most of the content API are untyped, measured 19 Oct 2026:

| Service          | Modules | Lines        | Test files |
| ---------------- | ------- | ------------ | ---------- |
| Content service  | 22      | about 14,000 | 43         |
| Render service   | 6       | about 2,100  | 4          |
| Analysis gateway | 1       | about 330    | 1          |

One module carries type annotations; nothing checks them. The site's own code is checked under strict settings, and that check has repeatedly caught real faults before they shipped (spec 012's first run found a filter that would throw). The services, which write the answers the site reads, have no such check. Their correctness rests on tests and on byte-for-byte comparison with Java, which shows that an answer differs, not where in the code a value of the wrong kind came from.

## User Scenarios & Testing _(mandatory)_

The "users" are the developers changing the services and, through them, everyone the services answer: a mistake caught by a type check never reaches an answer.

### User Story 1 - Every service module is checked (Priority: P1)

A developer changes a service. Before the change can merge, every module of the services is checked for values of the wrong kind, missing cases and fields that do not exist, under the same strictness as the site, and a failure names the file and line.

**Why this priority**: until the services are checked at all, no type says anything. This is the instrument.

**Independent Test**: introduce a deliberate mistake in a service module (a field that does not exist, a string where a number is needed): the check fails, naming it. Undo it: the check passes.

**Acceptance Scenarios**:

1. **Given** the services, **When** the check runs in CI and before a push, **Then** every service module is checked, and none is silently left out.
2. **Given** a deliberate mistake in any module, **When** the check runs, **Then** it fails, naming the file and line.
3. **Given** the conversion of a module, **When** it is deployed, **Then** every answer it gives is byte-identical to before, as the parity comparison with Java and the end-to-end suite show.

---

### User Story 2 - The data the services read is described (Priority: P1)

What the services read from the graph database, the search index and the domain snapshot is described by types, so code reading a row or a document uses only fields that exist, with the kinds they have.

**Why this priority**: most of the services' code transforms rows into answers. An undescribed row is where a wrong field or kind goes unseen.

**Independent Test**: rename a field a query returns in its type: every reader of it fails the check.

**Acceptance Scenarios**:

1. **Given** a query the content service runs, **When** its rows are read, **Then** they are read through a type that names each column and its kind.
2. **Given** the domain snapshot, **When** the service reads a class description from it, **Then** it reads it through a type that matches the snapshot's structure, checked against the snapshot file itself.
3. **Given** a search index answer, **When** the service reads it, **Then** it reads it through a type of the fields it uses.

---

### User Story 3 - What the services answer is described, once (Priority: P2)

The answers the services write (the Java shapes the content service reproduces, the render service's results, the gateway's error) are described by types. Where the site reads the same answer (spec 012), it is one definition, used by both, so the service and the site cannot disagree about an answer's shape without the check saying so.

**Why this priority**: it joins the two halves. Spec 012 checks the site's types against recorded answers; this makes the service's own output follow the same definition.

**Independent Test**: change a field in a shared answer type: both the service code that writes it and the site code that reads it fail the check.

**Acceptance Scenarios**:

1. **Given** an answer both the service writes and the site reads, **When** its type is read, **Then** there is one definition.
2. **Given** an answer only the service writes (an endpoint the site does not call), **When** its type is read, **Then** it is defined once, beside the service.

---

### User Story 4 - The checks tighten module by module (Priority: P2)

Each module moves from "converted, loosely typed" to "strictly typed" in its own small change. A module's loose spots (values typed as "anything") are counted, and the count may only go down.

**Why this priority**: 16,000 lines cannot be typed strictly in one change that anyone can review; a counted, falling number shows progress and stops regressions.

**Independent Test**: add a value typed as "anything" to a module that has none: the count check fails.

**Acceptance Scenarios**:

1. **Given** the count of loosely typed values per module, **When** a change adds one, **Then** the check fails.
2. **Given** a module with none, **When** it is read, **Then** it is checked as strictly as the site's code.

### Edge Cases

- A value whose kind Java decides at run time (a field that is sometimes a list, sometimes one object, measured in spec 012): described as either, never as "anything".
- Code the services share with the site (helpers imported both ways): checked once, in both settings.
- A test helper or fixture that builds deliberately malformed input: allowed to say so explicitly, and counted.
- A third-party library without type descriptions: described locally for the parts used, or counted as loose.
- Stack traces from a converted service still point at the right file and line, so a failure in production is still traceable.
- A deployment image built before and after a conversion runs the same entry point, so nothing outside this repository needs to change.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Every module of the content service, the render service, the analysis gateway and the tools beside them MUST be type-checked in CI and before a push, under the strictness the site's code uses.
- **FR-002**: The check MUST fail on a deliberate mistake in any module, naming the file and line; it MUST be shown failing before it is trusted.
- **FR-003**: No answer any service gives may change: each converted module is deployed and compared with Java (where Java answers) and with its previous answers, and the end-to-end suite passes.
- **FR-004**: The services MUST keep running from the same entry points, with no separate build step to deploy them.
- **FR-005**: Rows read from the graph database, documents from the search index and entries of the domain snapshot MUST be read through types naming their fields and kinds.
- **FR-006**: An answer shape both a service writes and the site reads MUST have one definition, used by both.
- **FR-007**: Values typed as "anything" MUST be counted per module, and the count MUST NOT go up.
- **FR-008**: A failure in a converted service MUST still report the right file and line.
- **FR-009**: Conversion MUST happen one module or a small group per change, each change deployed and verified before the next.
- **FR-010**: Lint and dead-code counts MUST NOT go up.

### Key Entities

- **Service module**: one source file of a service, with its loose-value count.
- **Data type**: the description of something a service reads: a query's row, an index document, a snapshot entry.
- **Answer type**: the description of something a service writes, shared with the site when the site reads it.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of service modules (35 today: the content service 22, the render service 6, the gateway 1, the type-check tools 6; plus their tests) are checked before every merge.
- **SC-002**: A deliberate mistake in any module is caught before merge every time it is tried.
- **SC-003**: Every converted module's answers are byte-identical to before, shown by the parity comparison and the end-to-end suite for each change.
- **SC-004**: The count of values typed as "anything" across the services falls with each change, and reaches zero in modules that read graph rows or write answers.
- **SC-005**: Every answer shape the site and a service both use has exactly one definition.
- **SC-006**: Lint and dead-code counts are no higher at the end than at the start.

## Assumptions

- The services run on the same runtime version in development, CI and their deployment images, and that version can run typed source directly; research confirms this before any module is converted.
- Spec 012's recorded answers and checks are the evidence for answer types; this feature reuses them and does not record new answers.
- The domain snapshot and other snapshots are regenerated by their own tooling; this feature types how they are read.
- Porting further endpoints waits for this feature, by the user's decision; corrections to the port plan raised alongside it (the species overview image is the Reacfoam map, not Fireworks; the events hierarchy and the held exporters can be ported) are recorded in spec 006, not here.
