# Feature Specification: DeltaSignal perturbs through the validated pin protocol

**Feature Branch**: `deltasignal-pins`
**Created**: 2026-11-06
**Status**: Draft
**Input**: DeltaSignal specs/140 (deltasignal repo): the engine now serves
`POST /api/pins`, resolving a perturbation to the nodes the benchmarked
protocol pins. The Pathway Browser must consume it.

## Background

Every accuracy figure DeltaSignal can cite was measured by perturbing only
ROOT nodes that are, or contain, the entity — downstream copies are computed,
never set. The drawer instead pins **every** logic node whose `reactome_id`
matches the selected entity (`matchingNodes` → `buildObservations`), a retired
protocol whose answers were never validated. The engine's `/api/pins` now
answers "which nodes do I pin for this entity?", including the honest `none`
("this entity has no perturbable starting form here").

## User Scenarios & Testing

### User Story 1 — A perturbation pins what the benchmarks pinned (P1)

A user selects an entity on the diagram. The drawer resolves it through
`/api/pins` and shows what a perturbation will do: "pins N starting form(s)".
Adding the perturbation pins exactly those nodes; the solve request contains
no other observation.

**Acceptance**:

1. Selecting an entity sends one `/api/pins` query for its stable id and
   shows the pinned forms; the answer is cached per network and entity, so
   re-selecting does not re-ask.
2. Add is enabled only when resolution succeeded with at least one pin;
   the observations sent to `/api/solve` are exactly the returned pins at the
   chosen activity.
3. An entity whose starting form is a complex containing it resolves to that
   complex (it may have no exact-id node at all) and can be perturbed.

### User Story 2 — "Not perturbable here" is said, not papered over (P1)

A user selects an entity that has occurrences but no pinnable starting form
(`basis: "none"`). The drawer says so and why, and does not offer Add.

**Acceptance**:

1. `basis: "none"` renders an explanation (its copies here are produced by
   the pathway, so there is no starting form to perturb) and Add stays
   disabled.
2. A backend without `/api/pins`, or a failed resolution, disables Add with
   the error shown — the drawer never falls back to pinning every matching
   node, because that is the retired protocol this feature removes.

### User Story 3 — The queue says what each perturbation does (P2)

Each queued perturbation names the pinned forms and their count, so what the
solve was given is on the record in the UI, as the bench logs its `Pinned:`
line.

## Requirements

- **FR-001**: Selection resolution through `POST /api/pins`
  `{network_id, queries: [{id, stable_ids: [selected stable id]}]}`, cached
  per `(network_id, stable id)`, with the solve path's existing
  re-parse-on-unknown-network retry.
- **FR-002**: `addPerturbation` builds the perturbation from the resolved
  pins (uuid + name + basis), never from `reactome_id` matching. The exact-id
  match remains only as display context ("N matching logic nodes").
- **FR-003**: `basis` surfaced: `root` silently, `root_cycle` as "its cycle's
  starting form", `none` as not perturbable with the explanation.
- **FR-004**: No silent fallback on error (US2.2).
- **FR-005**: Unit tests (vitest + HttpTestingController) cover US1 and US2,
  including the exact observation set sent to `/api/solve`.

## Non-goals

- Gene-level resolution (union over every form of a gene): the drawer sends
  the selected entity's stable id; the engine's is-or-contains index covers
  complexes and member leaves. Gene grouping is a later feature.
- Readout-side protocol (entity aggregation of results, total-protein
  abundance): DeltaSignal's usability programme item 2.
- Dose guidance (validated doses are 0 and 80): the presets already match.
