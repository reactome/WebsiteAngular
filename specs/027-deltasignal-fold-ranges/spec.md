# Feature Specification: Measured Fold Ranges in the Panel

**Feature Branch**: `deltasignal-fold-ranges`

**Created**: 2026-11-14

**Status**: Draft

**Input**: The UI half of deltasignal specs/155 (served 2026-11-14). `POST /api/readouts` now serves, per readout with a call whose class the validation record covers, `measured_fold_ranges`: a list of `{axis, share, lo, hi, n}` — on that axis's record, the middle `share` of MEASURED folds for answers in this class landed between `lo`× and `hi`× over `n` recorded pairs. The top level carries `fold_ranges` ("ok: <version>" or the refusal reason) and `fold_ranges_min_cell`. The engine's gates found the model's magnitudes overshoot measured reality (a confident strong-down call measured 0.64–0.95× half the time on the drug-RPPA record); the panel should put that beside the point fold.

## User Story — A predicted level carries what the record measured for answers like it (P1)

After a solve, a readout row's predicted level gains, per covered axis, a labelled line: "on the drug-RPPA record, answers like this measured 0.87–1.07× half the time (232 cases)". The user reads the point fold as a model state and the range as what measurement did. The fold, call, confidence, railed and switch renderings are untouched.

## Requirements

- **FR-001**: The served `measured_fold_ranges` are carried onto rows verbatim — no client-side computation, threshold or pooling; the rendered numbers are the served `lo`/`hi`/`n` exactly. A row renders the 50%-share entry per axis (the compact line); other shares are carried on the row but not rendered in the table.
- **FR-002**: Honest absence: an entry without the field (untouched, call-less, uncovered class, refused table) renders nothing new; the field's absence is never substituted. The columns explainer gains the range entry, stating "a share of the record, never a probability" and that the thresholds and provenance are the engine's.
- **FR-003**: Axis names render through a small display map (`korkut_rppa` → "the drug-RPPA record", `decryptm_phospho` → "the drug-phospho record"); an unknown axis renders its raw name rather than being dropped.
- **FR-004**: Tests (service level, the house pattern): served ranges land on the row verbatim; an entry without the field yields an empty list; rendering inputs (the 50%-share selection) are covered at the row level.

## Non-goals

- No range in the main columns; no overlay coloring from ranges.
- No client-side quantiles, no probability language.
- No consumption of `fold_ranges_min_cell` beyond display-availability (the engine serves or refuses; the client never re-derives).
