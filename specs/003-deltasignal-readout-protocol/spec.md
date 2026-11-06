# Feature Specification: The DeltaSignal drawer reads entities through the measured readout protocol

**Feature Branch**: `deltasignal-readouts` (stacked on `deltasignal-pins`)

**Created**: 2026-11-06

**Status**: Draft

**Input**: Usability programme gap 2, consuming side (deltasignal `specs/141-readout-protocol-api`; the engine endpoint is merged and parity-gated: 983/983 curator readout resolutions, 272/272 korkut abundance cases on the frozen build).

## The problem

After a solve, the drawer's results table shows, per Reactome entity, the flat
mean of every matching node copy's activity and a `change = activity − baseline`
difference on the display scale (`aggregateRowsByReactomeId`). No published
DeltaSignal figure was measured that way. The protocol of record resolves an
entity (direct match, else its proxy reactions' flux grouped by output entity,
else its set members), weighs each curated entity once, and makes the
direction call on the fold over rest at the validated 0.85 / 1.15 cutoffs —
all served by `POST /api/readouts` since deltasignal specs/141. Two readout
classes the protocol handles display **nothing** today: a curated species
expanded into variants (no node of its own) and a set.

This is the readout-side twin of the pins change (specs/002): the UI must
consume the endpoint, never reimplement the rules, and must refuse honestly
rather than fall back to the retired display rule.

## User Scenarios & Testing

### User Story 1 - The results table shows the measured values (Priority: P1)

After a solve, each entity row shows the protocol's entity-mean predicted
level as a fold over rest and the validated direction call, resolved by the
engine from the same solve's activities.

**Acceptance Scenarios**:

1. **Given** a successful solve, **When** the results render, **Then** the
   service has asked `/api/readouts` once, with one query per distinct
   Reactome id among the network's nodes, the solve's `node_activities`
   verbatim, and the observation uuids as `pinned`.
2. **Given** an entity whose copies the engine groups per curated entity,
   **Then** the row's value is the endpoint's `value`/`fold` — never a flat
   mean computed in the browser.
3. **Given** the endpoint fails, **Then** the table says the measured readout
   is unavailable — it must NOT fall back to browser-side aggregation.
4. **Given** a row, **Then** it shows the call (`up` / `down` / `normal` at
   the served cutoffs) and marks perturbed entities (any resolved copy
   pinned).

---

### User Story 2 - A selected entity with no node of its own still reads (Priority: P2)

Clicking a diagram entity that the generator expanded into variants (no
direct node) shows its predicted level through its proxy reactions, as the
benchmarks read it, instead of showing nothing.

**Acceptance Scenarios**:

1. **Given** a ready result and a selected entity absent from the batch,
   **When** the selection changes, **Then** the service asks `/api/readouts`
   for that one id (same activities and pins) and shows `basis: "proxy"`
   values with a note that it is read from its producing reactions.
2. **Given** `basis: "none"`, **Then** the panel says the entity is not
   readable in this network — no fallback, no invented number.

### Edge Cases

- A re-parse (network id lost) invalidates the readout batch with the result.
- Readout rows carry `influence` from the solve's `influence_scores` (max
  over resolved copies, as the old aggregate did) — a display aid, not part
  of the protocol.
- The diagram overlay (per-copy gradient) is unchanged: it deliberately shows
  every copy's own computed change, which is honest; the protocol governs the
  per-entity VALUE a user reads.

## Requirements

- **FR-001**: Entity values and calls come from `/api/readouts` only;
  `aggregateRowsByReactomeId` is removed, not kept as a fallback.
- **FR-002**: The request carries the solve's `node_activities` verbatim and
  the observations' uuids as `pinned`; the display states the served
  protocol's cutoffs (from the response), never hardcodes them.
- **FR-003**: Failures and `basis: "none"` are stated; no browser-side
  aggregation path remains.
- **FR-004**: Unit tests cover the exact batch request body, row construction
  from a response, the no-fallback failure path, and the selection readout
  for a non-node id.

## Non-goals

- Set readouts need member stable ids (the engine takes them from the client
  by design; the bench resolves them from Neo4j). Resolving members via the
  ContentService is a recorded follow-up — in the benchmark 81 readouts
  resolve by proxy and 5 by set members, so this slice ships the larger class
  and the set case stays an honest `none` with its explanation.
- Abundance ("total protein X") queries: no UI affordance asks that question
  yet; the endpoint serves it when one does.
- Honesty surfacing (converged/residual, rails) and the scope statement are
  programme gaps 3 and 4, not this spec.
