# Specification Quality Checklist: The interactor overlay, as built

**Purpose**: Validate this record is usable by someone who was not here
**Created**: 2026-09-16
**Feature**: [spec.md](../spec.md) · [research.md](../research.md)

## Content Quality

- [x] No implementation details in the spec itself — they are in research.md,
      where a decision needs them to be understood
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders (spec.md; research.md is for
      whoever maintains this next)
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic
- [x] All acceptance scenarios are defined, and each names the spec that holds it
- [x] Edge cases are identified — each is one a released bug actually hit
- [x] Scope is clearly bounded: this records shipped behaviour, not future work
- [x] Dependencies and assumptions identified

## Record Quality

This checklist adds items the standard one does not, because this document's
purpose is to be believed later.

- [x] Every figure is attributed to a measurement and a date
- [x] Every decision names what was rejected, not only what was chosen
- [x] Decisions that match the old browser cite the source file
- [x] Open decisions are recorded as open (D10: the control's position, and the
      badge colour) rather than omitted
- [x] Where a measurement contradicted an assumption, that is said
- [x] Figures that describe a third-party list say so, and are not written as if
      they were constants. Reviewing this document against its own standard
      caught one: "five of the thirteen PSICQUIC servers" had no date, and on
      re-measuring there were twelve, not thirteen. The five was right.

## Notes

- D7 is the one to read first if something in this area misbehaves: two released
  bugs came from the same cause and a third of the same shape is plausible.
- The numbers here describe third-party data on a particular day. Tests assert
  invariants rather than these figures, deliberately; do not "fix" a test to
  match a number in this document.
