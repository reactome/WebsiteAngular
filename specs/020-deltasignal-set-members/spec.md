# Feature Specification: Set Readouts Through Their Members

**Feature Branch**: `deltasignal-set-members` (stacked on `deltasignal-honesty`)

**Created**: 2026-11-06

**Status**: Draft

**Input**: The recorded follow-up from specs/003 and specs/019 (non-goal there): a curated set entity that has no node and no proxy reaction of its own resolves through its member species — the third rung of the measured resolution ladder (deltasignal specs/141; 5 of the 983 benchmark readouts resolve this way). The engine accepts `members` per query; the bench got members from Neo4j (`neo4j_set_member_stids`: the transitive `hasMember|hasCandidate` closure of an `EntitySet`, every level, distinct). The browser has no Neo4j, but the Reactome ContentService serves the same relationships.

## User Story - A selected set entity reads through its members (Priority: P1)

A user selects a curated set (e.g. an "activated ERBB2 heterodimers" DefinedSet). The batch readout resolved it `basis: none`. The client fetches the set's member closure from the ContentService — the same closure the bench's Neo4j query produced: follow `hasMember` and `hasCandidate`, every level, collecting every descendant's stable id, deduplicated — and asks `/api/readouts` again with those `members`. If the engine resolves `set_members`, the selection shows the measured entity-mean readout ("read through its N member species"); if still `none`, the honest not-readable statement stands.

**Acceptance Scenarios**:

1. **Given** an on-demand readout that returned `basis: none`, **When** the ContentService says the entity has members (transitively), **Then** one more `/api/readouts` query carries `members` = the closure's stable ids, and a `set_members` result replaces the `none` entry.
2. **Given** the ContentService answer has no `hasMember`/`hasCandidate` (not a set), **Then** no second query is made and the `none` entry stands.
3. **Given** the ContentService fails (including its silent-404 shape), **Then** nothing changes — the honest `none` presentation stands, and the failure is not retried in a loop.

## Requirements

- **FR-001**: The member closure MUST equal the bench's: every node reachable over `hasMember`/`hasCandidate` from the set, at every level (intermediate sets included), deduplicated, cycle-safe, fetched via `GET {CONTENT_SERVICE}/data/query/enhanced/{stId}` per set node (nested member objects carry only one level). A fetch cap bounds pathological trees; hitting the cap abandons member resolution entirely (a partial closure is a different protocol — never sent).
- **FR-002**: Member resolution runs only for an entity whose readout resolved `basis: none`, at most once per entity per solve.
- **FR-003**: The selection detail names the basis: "read through its member species".
- **FR-004**: Tests: the closure walk over a nested set (members of members, a shared member deduplicated); a non-set makes no second readout query; a `set_members` merge replaces the `none` entry; a ContentService failure leaves the `none` entry and is not retried; the fetch cap abandons rather than truncates.

## Non-goals

- No batch member resolution for the whole table (the benchmark says 5 of 983 readouts need it; on-demand selection covers the user story).
- No change to the engine (it already accepts `members`).
- No local cache of Reactome content beyond the session.
