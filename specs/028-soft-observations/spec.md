# WA specs/028: a measured level conditions the solve (deltasignal specs/156)

**Created**: 2026-11-15 · **Engine side**: deltasignal specs/156, merged and
served 2026-11-15 (`DS_SOFT_OBS=blend` on the dev API; the registered korkut
gate passed at every weight, best +0.032 balanced accuracy at weight 0.5).

## The problem

The engine now accepts soft observations — a measured level with a weight that
the solve reconciles with the network instead of pinning it hard — but the
Pathway Browser has no way to enter one. The measured use case (the engine's
registered arm): a user perturbs a drug's targets and ALSO knows what some
readouts measured; conditioning on those improves held-out prediction, and the
traced mechanism (the rapalog AKT feedback) is exactly a loop outside the
curated pathway that measurements carry in.

## User story 1 — enter a measured level on a solved readout (P1)

After a solve, a readout row resolved from entity nodes (basis `direct` or
`set_members`) can take a measured level: a fold (×baseline) and a weight
(default 0.5 — the strongest weight on the engine's record). The next solve
sends each measurement as `soft_observations` over the row's resolved node
uuids (the union of its groups) minus any hard-pinned uuid, and the result
line reports what the SERVER says it did: how many soft observations were
applied (`soft_observed`) and which were overridden (`soft_overridden`,
with reasons). A proxy-basis row takes no measurement (its groups are
reaction flux nodes, not entity levels) and says so; this is honest absence,
not a hidden default.

**Acceptance**:

1. Adding a measurement and solving again sends `soft_observations`
   {uuid: [fold, weight]} for exactly the row's unpinned group uuids.
2. A solve without measurements sends NO `soft_observations` field — the
   request is byte-identical to today's (the engine's FR-001 mirrored).
3. The result line shows the server-reported applied count and overridden
   reasons, never a client-side assumption; if the server applied fewer than
   were sent (a reparse minted new uuids), the line says so.
4. On a server with the feature off (the 400 naming DS_SOFT_OBS), the solve
   error surfaces the server's message verbatim.

## User story 2 — nothing moves without measurements (P1)

With no measurements entered, every request and rendering is unchanged.
Measurements clear with the result state they conditioned (clear/reset/
remove-perturbation), because their uuids belong to that network and solve.

## Requirements

- FR-001: `soft_observations` only present when measurements exist; model
  fields optional; no existing field changes.
- FR-002: weight fixed to [0,1], fold to [0,100] client-side (the server
  enforces its own 400s); entering a measurement for an already-measured
  entity replaces it.
- FR-003: the solve response's `soft_obs_rule` / `soft_observed` /
  `soft_overridden` are rendered from the response, never recomputed.
- FR-004: service specs via HttpTestingController pin the request shape (with
  and without measurements), the overridden rendering, and the 400 path;
  failure proven by mutation per constitution III.

## Non-goals

- No pre-solve measurement entry (resolution needs a solve's readout groups).
- No weight fitting or persistence; no e2e; no diagram overlay change.
- No client-side blending — the engine owns the reconciliation.
