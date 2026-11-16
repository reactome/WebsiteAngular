# WA specs/030: what moves this entity (deltasignal specs/158)

**Created**: 2026-11-16 · **Engine side**: deltasignal specs/158, merged and
served 2026-11-16 (`POST /api/inverse` — every row bit-equal to the forward
product; honest counts; measured cap).

## User story 1 — ask the inverse question from the panel (P1)

With a network loaded and an entity selected, the user can ask "what moves
this entity?". The service posts the entity's stable id as the inverse target
(direction `any`, the server's default cap and doses) and renders the
response's ranked rows — perturbation name(s), dose (knockout /
over-expression), predicted fold and call — plus the counts line verbatim
("N candidates, M reachable, K solved, L moved; capped" when `capped > 0`),
so a capped answer is never presented as exhaustive. Errors surface the
server's message. Nothing is computed client-side; rows and counts are
rendered from the response.

**Acceptance**:

1. The request body is exactly `{network_id, target: {stable_ids: [id]},
direction: "any"}` — server defaults are not restated client-side.
2. Rows and counts render verbatim; `capped > 0` is called out.
3. A server error surfaces its message; the panel never invents rows.
4. Service specs pin the request shape and rendering with a mutation proof.

## User story 2 — nothing else moves (P1)

No existing request or rendering changes; the action is new UI only. The
inverse state clears with the network (reset/pathway change).

## Non-goals

No direction/cap/dose controls in v1; no client-side ranking; no diagram
overlay of inverse results; no polling or async job UI.
