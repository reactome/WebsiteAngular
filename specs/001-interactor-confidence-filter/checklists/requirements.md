# Specification Quality Checklist: Interactor confidence filtering and download

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-10
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

Two iterations were needed.

**First pass** left one `[NEEDS CLARIFICATION]`: the old browser's default threshold, on the grounds that matching it matters for curator parity and guessing at it would be worse than asking. Rather than put the question to the user, it was answered by reading `reactome/pwp-diagram` at
`src/main/java/org/reactome/web/diagram/data/InteractorsContent.java`:

- `static final double DEFAULT_SCORE = 0.45;`
- `static Map<String, Double> interactorsThreshold = new HashMap<>();` — keyed by **resource**

That resolved the marker and also **corrected an assumption the first pass had got wrong**: it assumed one global threshold, when the old browser holds one per interaction resource. FR-004a and the Key Entities section were added, and the assumption rewritten to cite the source rather than reason from the single control beneath the diagram.

**Second pass** caught two edge cases still written against the superseded "no threshold by default" assumption — a malformed threshold falling back to "showing everything", and the multi-entity case deferring to Assumptions for a scope that is now settled. Both corrected.

Two figures in the spec are measured, not estimated, and are re-measurable:

- score range 0.482–0.98 across 33 interactions, from
  `/ContentService/interactors/static/molecule/Q13158/details`
- default 0.45, from the source above

Per constitution principle V, any number in this spec has to be one someone measured. These two are.

### Deliberately not resolved here

The download's file format is left to `/speckit-plan`. It is a design decision constrained by how the site's other tabular exports behave, not a requirement a curator would state, and pinning it in the spec would be the implementation detail this checklist forbids.
