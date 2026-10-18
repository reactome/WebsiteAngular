# Feature Specification: ContentService answered by node

**Feature Branch**: `port/*` (one branch per endpoint family)

**Created**: 2026-10-17, written after the fact — see the note below

**Status**: In progress — 52 of 98 published operations answered by node

**Input**: Move ContentService, endpoint by endpoint, from the Java service to the node content service in this repository (`tools/content-node`), byte-identical, so the site's API is built, tested and deployed with the site. Decided 21 Aug 2026, revisited 18 Sep; the reasoning is [research.md](research.md).

> **Written after the fact.** The work ran from August to October 2026 against [research.md](research.md) alone, without a spec, plan or task list, so what had been done and what remained was recorded only in pull requests. This spec, [plan.md](plan.md) and [tasks.md](tasks.md) were written on 17 Oct 2026 from those pull requests and a comparison of Java's published operations with node's, and are kept current from now on.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The site's pages work the same, answered by node (Priority: P1)

A reader using the website or the Pathway Browser — detail pages, search, the diagram, interactors, the species selector, citations — sees exactly what they saw when Java answered.

**Why this priority**: it is the point of the work: the API the site depends on is built and tested with the site.

**Independent Test**: for each ported operation, the same requests to Java and to node give byte-identical answers, errors included; the page that uses it is checked on the deployed site and its requests are seen answered by node.

**Acceptance Scenarios**:

1. **Given** an operation node answers, **When** any valid or invalid request is made, **Then** status, body and the headers clients read match Java's, unless a difference is declared with its rule (research D11, D19).
2. **Given** a page that calls the operation, **When** it is opened on the deployed site, **Then** it renders as before and the call is answered by node.

---

### User Story 2 - Integrators' URLs keep working (Priority: P2)

Scripts, partner sites and old links that call ContentService paths get the same answers at the same addresses, whichever process answers.

**Why this priority**: ContentService is public; external consumers depend on its paths and shapes (research D3).

**Independent Test**: the routing tests send every ported path — with a trailing slash too, as Spring accepts one — to node, and every unported path to Java.

**Acceptance Scenarios**:

1. **Given** a ported path, **When** it is requested with or without a trailing slash, **Then** node answers it.
2. **Given** a path not yet ported, **When** it is requested, **Then** Java answers it; a ported path is never answered by Java.

---

### User Story 3 - Each operation has a known home and state (Priority: P3)

Anyone can see, for every published operation, whether node answers it, which pull request moved it, or where it is going.

**Independent Test**: [tasks.md](tasks.md) lists all 98 operations; each is ticked with its pull request, or assigned to node, the exporter plan, or the Java side ([spec 010](../010-java-services/spec.md)).

### Edge Cases

- Ids in every form Java reads: stable ids, dbIds with versions, old `REACT_` ids, Unicode digits, percent-encoded segments, ids past Java's `long` range.
- Errors are Java's: the same status, envelope and message, for missing parameters, bad ids, unknown routes and wrong methods.
- Answers Java caches are cached by node the same way (research D9, D10).
- An unordered answer is declared by sorting, not by a wildcard (D15).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Each ported operation MUST answer byte-identically to Java for the same request, compared live before it is routed.
- **FR-002**: Each port MUST be test-first, with each behaviour shown failing by mutation.
- **FR-003**: Routing MUST be per operation, in nginx and the dev proxy alike, kept in agreement by a test; every node route MUST accept a trailing slash.
- **FR-004**: A route node answers MUST never fall back to Java.
- **FR-005**: Operations whose substance is a Java library or Java numerical work MUST NOT be ported; they go to the Java side ([spec 010](../010-java-services/spec.md)).
- **FR-006**: Each port MUST be reviewed adversarially before merge, deployed, and verified on the deployed site by what a reader sees.

## Success Criteria _(mandatory)_

- **SC-001**: Every operation the site calls that is not homed in Java is answered by node.
- **SC-002**: Zero unexplained differences from Java across each operation's parity corpus.
- **SC-003**: 100% of the 98 published operations have a recorded home in [tasks.md](tasks.md).

## Assumptions

- Java keeps serving every operation not yet ported, until the Java side of [spec 010](../010-java-services/spec.md) replaces it.
- The ORCID endpoints are ported last (decided 15 Oct 2026); they are not among the 98 published operations.
