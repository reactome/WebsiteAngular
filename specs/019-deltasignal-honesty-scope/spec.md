# Feature Specification: DeltaSignal Honesty Signals and Scope Statement

**Feature Branch**: `deltasignal-honesty` (stacked on `deltasignal-readouts`)

**Created**: 2026-11-06

**Status**: Draft

**Input**: Usability programme gaps 3 and 4, UI side (the programme is listed in deltasignal `specs/140-pin-protocol-api/spec.md`; the engine halves are deltasignal specs/142 — the `railed` flag and served rail stops — and specs/143 — `GET /api/scope`). The panel currently presents every fold as a measured magnitude and never says what the system is validated for.

## User Scenarios & Testing

### User Story 1 - A railed readout is presented as a stop, not a magnitude (Priority: P1)

A user solves a perturbation and reads the results table. A readout the engine flags `railed` is a switch pinned against the model's bound (deltasignal specs/108/054/142), so the table and the selection detail say "at the model's bound" with the direction call, instead of presenting the fold as a precise level.

**Acceptance Scenarios**:

1. **Given** a readout response with `railed: true`, **When** the table renders, **Then** the row's predicted level reads as at-bound (wording derived from the served `protocol.rail_low` / `rail_high`, never hardcoded), the direction call is still shown, and the column help explains what a rail means.
2. **Given** `railed: false`, **Then** the row renders exactly as before this feature.

### User Story 2 - A non-converged solve says so (Priority: P1)

The solve response already reports `converged` and `residual`. When `converged` is false, the results area shows a notice that the answer is cap-decided, not a steady state, with the residual.

**Acceptance Scenarios**:

1. **Given** a solve response with `converged: false` and a residual, **When** results render, **Then** a visible notice says the solve did not reach steady state and shows the residual; with `converged: true` no notice appears.

### User Story 3 - The scope statement is one click away (Priority: P2)

A user deciding whether to trust a number can open "What is this validated for?" and read the served scope statement: summary, validated axes with provenance, limitation classes. If the statement was measured on a different catalog than the one served, that is shown. If the endpoint fails, the view says the statement is unavailable — no local copy ever substitutes (the engine's file is the single source).

**Acceptance Scenarios**:

1. **Given** `GET /api/scope` succeeds, **When** the user opens the scope view, **Then** summary paragraphs, each validated axis (statement + value + provenance line), and each limitation render from the response.
2. **Given** `measured_on_served_catalog: false`, **Then** a warning line names both builds.
3. **Given** the request fails, **Then** the view states the scope statement is unavailable and shows nothing else.

## Requirements

- **FR-001**: The readout table and selection detail MUST consume `railed` and the served `rail_low`/`rail_high`; no stop value may be hardcoded in the client.
- **FR-002**: The non-convergence notice MUST come from the solve response's `converged`/`residual` fields, shown whenever results are shown and `converged` is false.
- **FR-003**: The scope view MUST render only what `GET /api/scope` returns, fetched at most once per session, with an honest unavailable state and the catalog-mismatch warning.
- **FR-004**: No behavioural change to pinning, solving or readout resolution; this is presentation of served signals only.
- **FR-005**: Tests (amendment 1, 2026-11-06: pinned at the service/model level, where this repo's deltasignal suites live — the templates are compiled by the CI build and the at-bound wording reads only served fields by FR-001): a readout served `railed: true` carries it into its table row and an un-railed one does not; the scope state machine reaches `ready` with the served statement, `error` on failure with nothing substituted, and never fetches twice.

## Non-goals

- No client-side computation of rails (the engine serves the flag; a client recomputing it is a second protocol).
- No editing or local copy of the scope statement.
- No set-member resolution via ContentService (recorded follow-up from specs/003).
