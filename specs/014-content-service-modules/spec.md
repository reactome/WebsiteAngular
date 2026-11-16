# Feature Specification: The content service in modules, then on Express 5

**Feature Branch**: `spec/014-content-service-modules`

**Created**: 2026-10-20

**Status**: Draft

**Input**: User description: "Split the node content service into modules behind a typed endpoint registry, then move it to Express 5." Decided on 20 Oct 2026 in place of adopting a framework. Byte parity with Java decides everything, and every answer is already written by hand. A framework's serialisation, validation and error pages would be bypassed. Decorator-based frameworks would bring back a build step, which spec 013 R1 ruled out. Routing is not the bottleneck.

## Context (measured)

- **Size.** The node content service is one module of 8,982 lines. Its 88 endpoints sit in one array, alongside 206 top-level functions they share: the Java-faithful writers, the Spring parameter binders, Solr reading, graph queries and id resolution.
- **Who pays for that.** Every port, review and typing change edits that one file:
  - Parallel pull requests have repeatedly conflicted at the same anchors.
  - Spec 013's Phase 5 (no implicit any, loose values to zero) has 535 of its 912 remaining errors in this file alone.
- **The endpoints are untyped object literals.** The tools that read them cast them: the parity harness, the invalid-input corpus and several specs.
- **Express 4.22.3 does not wait on an async handler.** A rejected promise in one is unhandled. The service works around this with `void (async () => …)()` wrappers, and the review of #556 recorded the gap. Express 5 forwards rejections to the error handler. It also changes how paths are matched and how queries are parsed.

## User Scenarios & Testing _(mandatory)_

The people served are the maintainers who port, review and type the service. Through them, the readers of the site are served too: they must notice nothing.

### User Story 1 - Work on one family of endpoints without touching the rest (Priority: P1)

A maintainer porting, fixing or typing the search endpoints opens the search module. That module holds those endpoints and the helpers only they use. Their pull request touches no other family's module, so another maintainer typing the schema endpoints at the same time does not conflict with them. A reviewer reads one family, not a slice of a nine-thousand-line file.

**Why this priority**: every other piece of work on the service, spec 013's remaining phases included, is slower and more conflict-prone until this is done, and it changes no answer.

**Independent Test**: one family is moved out on its own. Its answers on beta are byte-identical before and after, every test passes, and a change confined to that family touches only its module (and the registry, if an endpoint is added).

**Acceptance Scenarios**:

1. **Given** the service as one module, **When** one family is moved into its own module, **Then** every answer of every endpoint (that family's and the others') is byte-identical to before, and the moved lines are the same lines (no logic edited in the move).
2. **Given** two families in their own modules, **When** two pull requests each change one of them, **Then** they do not conflict.
3. **Given** all families moved, **When** the registry assembles them, **Then** the order in which a request is matched to an endpoint is the order it was before, and the nginx and dev-proxy route tables still agree with it.

---

### User Story 2 - An endpoint's declaration is checked (Priority: P1)

A maintainer declaring an endpoint gets a compile error for a misspelled field ("sampel"), a wrong kind ("differs" given a string), or a missing handler. The parity harness, the invalid-input corpus and the specs read the endpoints through the same declared shape, with no casts.

**Why this priority**: it is what makes the registry a registry rather than a list. It also retires the casts spec 013 left in the tools that read endpoints.

**Independent Test**: a deliberately misspelled or mistyped endpoint field fails the type check, and the tools that list endpoints compile with no cast on them.

**Acceptance Scenarios**:

1. **Given** the typed endpoint shape, **When** an endpoint misspells a field or gives one a wrong kind, **Then** the type check fails, naming it.
2. **Given** the tools that read the endpoint list, **When** they are compiled, **Then** none casts it.

---

### User Story 3 - The service on Express 5, answering exactly as before (Priority: P2)

After the split, the service moves to Express 5. A handler whose promise rejects is answered by the service's error handling, not left unhandled. The wrappers that existed only to silence that disappear. Every URL form the service answers is answered as before, byte for byte, and as Java answers it:

- trailing slashes (301),
- matrix parameters (404),
- encoded slashes (400),
- doubled slashes (404),
- malformed escapes,
- repeated query parameters,
- odd characters in a path.

**Why this priority**: it removes a real gap (an unhandled rejection) and dead workarounds. But it changes path matching and query parsing underneath every endpoint, so it comes only once the code is split and the endpoints are typed.

**Independent Test**: the parity harness and the invalid-input corpus, run against Java, give the same result before and after the upgrade. A handler made to reject is answered by the error handling, not left unhandled.

**Acceptance Scenarios**:

1. **Given** the service on Express 5, **When** every endpoint's sample and every invalid-input URL is asked of it and of Java, **Then** the answers agree exactly as they did before the upgrade (the same differences, which are only the ones each endpoint declares).
2. **Given** a handler whose promise rejects, **When** it is asked, **Then** the answer is the service's own error answer, and no unhandled rejection is logged.
3. **Given** the URL forms listed above, **When** each is asked, **Then** the answer (status, headers that matter, body) is what it was before.

---

### User Story 4 - The render service on Express 5 too (Priority: P3)

The render service, the other Express service in this repository, moves to Express 5 the same way. Its figures and its refusals answer as before.

**Why this priority**: same dependency, same reasons, and it should not lag behind; but it has fewer routes and no Java to match.

**Independent Test**: the render service's tests pass, and a small set of figure and refusal requests on beta answer as before.

**Acceptance Scenarios**:

1. **Given** the render service on Express 5, **When** its routes are asked (a figure, an unknown parameter, a repeated parameter, an out-of-range value), **Then** they answer as before.

### Edge Cases

- **A helper used by two families.** It goes to a shared module by concern (writers, binders, Solr, id resolution), not to one of the families, so neither family depends on the other.
- **Routes whose order matters.** Some endpoints match only because a more specific route is tried first (Java's `/query/enhanced/{id}` before `/query/{id}/{attribute}`, for example). The registry must keep that order, and a test must show it does.
- **Generated endpoints.** Some endpoints are produced from a list: the in-depth family, the person lists, the species lists. They move with their family as the generator that makes them, not unrolled.
- **Module-level state.** Caches, the PSICQUIC list, the release, the deep-query share: each lives in exactly one module after the move, and is created at the same moment (start, or first use) as before.
- **The health fingerprint.** It hashes the service's modules. New modules must be in it, and its value changes, as it should when the code's files change.
- **The ratchets when code moves.** A module's lint, loose and implicit-any counts move with its code. They must not be read as a rise in the destination or a fall in the source.
- **Express 5 query parsing.** Its default is the simple parser, where Express 4 used the extended one. The service reads queries from the raw URL (Spring's way), so the difference must be shown not to matter, not assumed.
- **Express 5 path syntax.** It has no regular-expression characters in paths, and its wildcards are named. Any route written with them must be rewritten to match exactly the same URLs.

## Requirements _(mandatory)_

### Functional Requirements

**Part 1: the split**

- **FR-001**: The content service MUST be divided into one module per endpoint family:
  - data and query;
  - pathways and events;
  - schema;
  - search;
  - interactors;
  - exporters;
  - citation;
  - person;
  - species, mapping and the rest.

  Each family module MUST export its endpoints.

- **FR-002**: Helpers used by more than one family MUST live in shared modules by concern, and MUST NOT live in a family module. The concerns are:
  - Java-faithful writing;
  - Spring parameter binding;
  - Solr reading and shaping;
  - graph id resolution;
  - the server's routing and error answering.
- **FR-003**: One registry MUST assemble the families' endpoints in the order requests are matched today. A test MUST show that the order is unchanged and that the route tables kept by nginx and the dev proxy still agree with it.
- **FR-004**: Each move MUST be a move. A line that changes in a move pull request MUST be one that has to change because the code moved (imports, exports, a module boundary), and the pull request MUST say so. No logic edit MAY be mixed in.
- **FR-005**: Endpoints MUST be declared through one typed shape. It covers:
  - path, method, handler;
  - sample values, path samples and sample body;
  - parity options: unordered key, normalisation, declared differences;
  - warming;
  - the endpoint's parameter record.

  A misspelled or mistyped field MUST fail the type check.

- **FR-006**: The parity harness, the invalid-input corpus and every spec that lists endpoints MUST read them through that shape without a cast.
- **FR-007**: Every answer MUST stay byte-identical. That means status, the headers the caching and download guards set, and the body.
- **FR-008**: The deployable image MUST still contain only the content service's own directory. Every new module MUST:
  - load under Node without a build, as the load test checks for each one;
  - be included in the health fingerprint.
- **FR-009**: Each family MUST move in its own pull request, deployed to beta and verified there before the next family moves. The least-coupled families move first.
- **FR-010**: The ratchets MUST follow moved code. In a move:
  - the counts of the modules involved are compared as one total, before against after;
  - that total MUST NOT rise;
  - the per-module baselines are then rewritten to the new per-module counts.

  This applies to lint warnings, loose values and implicit anys. Outside a move, the existing per-module rule stands. The dead-code count MUST NOT rise.

**Part 2: Express 5**

- **FR-011**: After Part 1, the content service MUST move to Express 5. A handler's rejected promise MUST reach the service's error handling. The wrappers that existed only because Express 4 did not wait MUST be removed.
- **FR-012**: Every route MUST match exactly the URLs it matched before. Shown by:
  - the route-table agreement test;
  - the invalid-input corpus, against Java;
  - the URL forms in User Story 3.
- **FR-013**: The parity harness, run against Java over every endpoint's samples, MUST report the same result after the upgrade as before.
- **FR-014**: The render service MUST move to Express 5 in its own pull request, its answers unchanged.
- **FR-015**: No framework is adopted. Express stays, at version 5, and so does the hand-written serialisation.

### Key Entities

- **Endpoint**: one route the service answers. It has:
  - its path and method;
  - the handler that answers it;
  - the samples the parity harness and the invalid-input corpus use;
  - the parity options that say how it is compared with Java;
  - whether it is warmed at start;
  - the record that says which query parameters it declares and how its answers are cached.
- **Family module**: the endpoints of one area of the API, and the helpers only they use.
- **Shared module**: helpers more than one family uses, grouped by concern.
- **Registry**: the ordered list of every endpoint, assembled from the families, which routing, the parity harness, the route tables and the specs all read.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: No module of the content service is longer than 1,500 lines, against one module of 8,982 lines today.
- **SC-002**: 100% of the answers compared before and after each move and the upgrade are byte-identical, apart from values that change on every request (a timestamp). Two sets are compared:
  - the beta captures, covering every family;
  - the parity harness against Java over every endpoint's samples.
- **SC-003**: Two pull requests that change endpoints in different families do not conflict. It is shown once, with two such changes made in parallel.
- **SC-004**: There are zero casts on the endpoint list in the tools and specs that read it, against several today.
- **SC-005**: There are zero `void (async () => …)()` wrappers left in the services after the upgrade. A handler made to reject produces no unhandled rejection.
- **SC-006**: Spec 013's remaining Phase 5 work, which is no implicit any per module and loose values to zero, can proceed one family module at a time. No family module's typing pull request touches another family's module.
- **SC-007**: The ratchets never rise at any point. Lint warnings stay at 1,329 or fewer, and loose values, implicit anys and dead code may only go down, compared as FR-010 says.

## Assumptions

- The order of work:
  - Part 1 comes before spec 013's Phase 5 work on the content service. Typing is easier, and conflicts are rarer, in small modules.
  - Spec 013's work on the other modules may continue alongside.
  - Part 2 comes after Part 1.
- The existing checks are enough to show behaviour is unchanged. They are:
  - the parity harness;
  - the invalid-input corpus;
  - more than 1,100 unit tests;
  - the end-to-end suite;
  - before-and-after captures on beta.

  New tests are added only where a requirement needs one: the route order, and an endpoint whose handler rejects.

- Verification against the shared graph database stays light: small runs, sequential and spaced, as before.
- The analysis gateway uses Node's own HTTP server, not Express, and is out of scope.
- Porting further endpoints, changing any answer, and adopting a framework (Fastify included) are out of scope. Fastify is reconsidered only if a need appears that Express 5 cannot meet.
- This repository is public. Nothing internal goes into it.
