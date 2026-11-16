# Feature Specification: Curator-Drawn Leads in the Panel

**Feature Branch**: `deltasignal-leads`

**Created**: 2026-11-07

**Status**: Draft

**Input**: The UI half of deltasignal specs/149 (Adam approved the label 2026-11-07). The engine serves `GET /api/leads` — which pathways have an arrow composite (parseable under `ctx-arrows_<id>`, unlisted), each curator-drawn arrow's provenance, and its measured rate class. The product's "not reached here" readouts are exactly where a lead belongs.

## User Story - A not-reached readout can show a curator-drawn lead (P1)

After a solve in a pathway that has a lead composite, the service runs the same perturbation once through the composite (`parse` → `pins` → `solve` → `readouts`, all existing endpoints) and keeps the answers for the readouts the main solve left untouched. A table row that said only "not reached here" gains, when the composite reaches it with a call, a labelled lead line: "Lead via curator-drawn connections: down — down-calls like this were right 24% on the record" (the served rate `statement`), or with "no measured rate yet" when every arrow into this pathway is unrated. The main columns (Predicted level, Call, Confidence) stay exactly as they are — a lead never occupies them.

## Requirements

- **FR-001**: The leads table is fetched once per session from `/api/leads` and consumed verbatim; no composite id, arrow name or rate is hardcoded.
- **FR-002**: The composite run starts only after the main readout batch is ready, only when the pathway has a composite, and is guarded against newer solves exactly as the readout batch is; its failure leaves the honest "not reached here" untouched (no retry loop, no substitute).
- **FR-003**: A lead renders only for rows whose main `confidence_stratum` is `untouched`, only when the composite's readout has a call, labelled with the pathway's served rate statement; `untouched` composite answers add nothing.
- **FR-004**: Tests (service level, the house pattern): the composite flow issues exactly parse → pins → solve → readouts with the main perturbation; a composite call lands on the untouched row as a lead; a composite failure changes nothing; a pathway without a composite makes no composite request.

## Non-goals

- No lead in the main call/confidence columns; no overlay coloring from leads.
- No client-side rate computation.
- No composite run for pathways absent from the leads table.
