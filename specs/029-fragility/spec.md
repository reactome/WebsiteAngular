# WA specs/029: the structural-fragility note (deltasignal specs/157)

**Created**: 2026-11-15 · **Engine side**: deltasignal specs/157, merged and
served 2026-11-15 (gate PASSED: a structurally fragile drug-record call was
right one time in five, a robust one five times in six).

## The problem

The engine now serves, per readout with a call, `fragility {rate, n}` — the
share of recorded ensemble pairs in its class whose call flipped under at
least one of twenty recorded near-equivalent rule variants. The panel shows
nothing of it.

## User story 1 — a fragile class is named under the row (P1)

A readout row whose served `fragility.rate` is at or above a display floor
(0.05 — below it the note is noise: the record's typical class is under 1%)
shows, under the predicted level beside the confidence and range notes:
"Structurally fragile class: calls like this flipped under contested model
rules in {rate}% of the record ({n} cases)". Rendered from the response,
never computed; absent field → no note (honest absence); the explainer dl
gains one entry naming what the rate is and is not (stability across recorded
near-equivalent structure, never correctness).

**Acceptance**: rows carry the note exactly when the served rate ≥ 0.05; no
field change elsewhere; service spec pins the passthrough and the floor with
a mutation-proven test.

## Non-goals

No client-side computation; no new requests; no UI for the table status
string beyond the existing protocol-note pattern; no claim of correctness.
