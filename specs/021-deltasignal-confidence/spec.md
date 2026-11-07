# Feature Specification: Per-Result Confidence in the Panel

**Feature Branch**: `deltasignal-confidence`

**Created**: 2026-11-07

**Status**: Draft

**Input**: Adam, 2026-11-07: "how certain we are of each result would be good to have." The engine half is deltasignal specs/146: every valued readout carries `confidence` (the measured share of same-stratum validation-record calls that matched the curators) and `confidence_stratum`; an untouched readout (fold exactly 1.0) is served `confidence: null`, stratum `"untouched"`, because the record shows such a "no change" is mostly wrong against experiments that expected a change (the lost-route class).

## User Stories

### US1 - Every result says how often results like it were right (P1)

The results table gains a Confidence column: "92%" rendered from the served `confidence`, with column help explaining it is a measured agreement rate on the validation record, not a model self-estimate. The selection detail shows the same beside the predicted level.

### US2 - An untouched readout says "not reached", never "no change" (P1)

A row whose `confidence_stratum` is `untouched` shows "not reached here" in place of a fold and call: the perturbation has no route to this readout in this network. The old presentation (1.00×, "no change") was the exact misleading answer the engine's record exposed.

### US3 - The solve's convergence sharpens the strata (P2)

The batch and on-demand readout requests pass the solve's `converged` flag, so the engine resolves finer strata.

## Requirements

- **FR-001**: `confidence`/`confidence_stratum` consumed verbatim; no client-side computation or wording that implies probability of experimental truth (the help text states what was measured and on what).
- **FR-002**: `untouched` rows present "not reached here"; they sort to the bottom (no departure) and are excluded from the "furthest from 1×" truncation count language.
- **FR-003**: Requests carry `converged` from the solve result.
- **FR-004**: Tests: the request body includes `converged`; a served confidence lands in the row; an untouched result maps to the not-reached presentation; a null `confidence` with a non-untouched stratum renders as "—" (table unavailable), never invented.

## Non-goals

- No confidence for pins or the logic-graph view (follow-ups if wanted).
- No local copy of the confidence table.
