# Specification Quality Checklist: Cache headers for the content API

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-18
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

- The feature is itself about HTTP caching in front of an existing service, so it names things that would be implementation detail elsewhere: Cloudflare, GET/POST, the API's paths, and the node content service. That is the subject, not leakage; no language, library or code structure is named.
- The one clarification, release-day refresh, was answered by awright on 18 Oct 2026: Cloudflare keeps answers until cleared, the cache is cleared at each release, browsers keep them briefly, and an optional warm-up refills the most-used URLs.

## Success criteria, as built (19 Oct 2026)

- **SC-001 (met).** `parameters.spec.mjs` fails unless the record's keys equal node's GET endpoints, in route order (#530).
- **SC-002 (met).** Checked on the deployed node, every GET endpoint by its own sample:
  - Every one with `?utm_source=x` is `no-store`.
  - Every one answered 200 in standard form is public `standard`, except those marked never cached: the PSICQUIC list, the citations, and the exporter, which is private.
  - Tokens are covered by `cache-headers.spec.mjs` (#531).
  - The check found icon ids are zero-padded (`R-ICO-013748`), which standard form had refused; fixed in the closing PR.
- **SC-003 (met).** Every endpoint's sample compares with Java exactly as before the labels: 75 identical, plus the declared differences, which are unchanged (#531).
- **SC-004 (met).** 328 invalid inputs: 309 identical, and the rest the two declared differences (research R12, #530).
- **SC-005 (waits on #527).** It needs the Cloudflare Cache Rule (T030, then T031).
- **SC-006 (met in e2e).** 420 of 426 standard, and the six left reviewed (R14, #533). On beta only after its site build is renewed (T026).
- **SC-007 (waits on a release).** It needs the Cache Rule and a release: purge, then `warm.mjs` (#534).
