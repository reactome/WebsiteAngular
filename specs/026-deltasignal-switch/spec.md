# Feature Specification: Switch States in the Panel

**Feature Branch**: `deltasignal-switch`

**Created**: 2026-11-14

**Status**: Draft

**Input**: The UI half of deltasignal specs/154 (served 2026-11-14). The engine now detects bistable loops: `POST /api/solve` additionally returns `switch_components` (cyclic components with a second stable fixed point, as sparse alternate activities), and `POST /api/readouts`, given that list back, serves per readout `switch` (the two states produce different calls), `state` (`"high"`/`"low"`: which one this perturbation selected) and `other_state_fold`. A readout on a free switch is a basin's coordinates, not a magnitude — the panel should say so in data, the way it already says "at the model's bound" and "not reached here".

## User Story — A readout on a two-state loop says which state it is (P1)

After a solve in a pathway whose loop still holds two stable states under the user's perturbation (a BRAF knockout in RAF: the paralogs keep the ON state reachable), the readout row's predicted level gains a labelled line: "a switch: this perturbation selects its low state — the other stable state reads 4.15×". The user reads the number as one of two states, not a level on a dial. A forced loop (the perturbation drives the switch itself, the 84.6% class on the record) has one state left and shows nothing new; the existing "at the model's bound" note keeps carrying those.

## Requirements

- **FR-001**: The solve's `switch_components` are passed back to `/api/readouts` verbatim — on the main batch and on the on-demand selected-entity path — exactly when the solve carried a non-empty list; no client-side detection, floor or threshold, and no field invented when the solve served none (detection off, or a non-converged solve: no second-state claim exists).
- **FR-002**: A readout whose served entry says `switch: true` renders, under its predicted level, which state the perturbation selected and the other state's fold, both verbatim from the served fields. The main columns (Predicted level, Call, Confidence) stay exactly as served — the other state never occupies them, and sorting does not change.
- **FR-003**: Honest absence: an entry without `switch`, with `switch: false`, or missing `state`/`other_state_fold` renders nothing new. The columns explainer gains the switch entry, stating the rule in the served protocol's terms (the readouts `protocol` now names `switch_rule`, `switch_floor`, `switch_max_sweeps`) rather than hardcoding any number.
- **FR-004**: Tests (service level, the house pattern): the batch request carries `switch_components` exactly when the solve answered with them; a served switch entry lands on the row as its state pair; a solve without the field sends none and no row claims a switch; `switch: false` stays bare.

## Non-goals

- No client-side bistability detection, no flip-threshold ("how hard to flip") serving — that is a registered engine follow-up.
- No overlay or diagram coloring from the alternate state; the alternate activities are never rendered as a second result set.
- No switch consumption in the lead-composite run (specs/022): a lead is already a labelled pointer, not a magnitude.
