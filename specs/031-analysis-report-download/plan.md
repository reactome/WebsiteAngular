# Implementation Plan: The analysis report, made and downloaded in place

**Branch**: `spec031/analysis-report-download` | **Date**: 2026-11-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/031-analysis-report-download/spec.md`

## Summary

The Download tab asks for the report itself, on the page, and follows it: it fetches the
report's address asking for JSON, reads the status pdf-export puts in its 202 (queued and
its place; making, its stage and count; an estimate), shows it beside the button, asks
again every few seconds, and saves the PDF when the answer is 200, as the tab's other
files are saved. Failures map to the spec's three kinds, each with its action; cancel stops
asking; a report fetched stays in the page to download again.

pdf-export's part, done first and in pdf-export (its spec 002): the `status` object in the
JSON 202, its stages and counts, an estimate from its own past reports, and `Prefer:
wait=<s>` to hold a poll for less than 30 s (research R1, R2). The address, the 200, the
errors and the browser's page are unchanged. The gateway passes all of it through as it is
(R4); a test says so.

## Technical Context

**Language/Version**: TypeScript: Angular 21 for the site (strictTemplates, signals); Node 24
for pdf-export (TypeScript strict, no `as` in src).

**Primary Dependencies**: none new. The site's `FileDownloadService` (saving a Blob) and the
managed-download look; pdf-export's `Jobs`.

**Storage**: none. The page holds its reports in memory for its life; pdf-export holds its
jobs, kept reports and past times in its process, as it does now.

**Testing**: the site's unit tests (Vitest) for the polling state machine; Playwright e2e
with the report's address answered in the test (no recording needed: a route handler);
pdf-export's `node --test` for the status fields and `Prefer: wait`; a measurement of the
estimate (SC-004) on beta's pdf-export with release 98 tokens made on this host's own
Analysis Service.

**Target Platform**: browsers the site supports; pdf-export's container.

**Project Type**: web application (the site) and a web service (pdf-export).

**Performance Goals**: first status within 1 s (SC-002); a status at least every 10 s
(SC-003); the estimate within 50% at the start, four reports in five (SC-004).

**Constraints**: the token only to Reactome's own services (FR-014); the report's address
and its answers to other callers unchanged (FR-013); a poll counted by the gateway as one
request in flight per tab.

**Scale/Scope**: one button's flow on one tab; a status object and a header in pdf-export.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                     | How this plan holds it                                                                                                                                                                 | Status     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| I. Verify the instrument      | The polling is checked against pdf-export's real 202s on beta, not only a stub; SC-004 is measured on the service that answers the site, with the estimate read from the answer itself | Pass       |
| II. Measure in the thing      | Report times come from pdf-export's own records (R2) and from timing real reports, not from the spec's guesses                                                                         | Pass       |
| III. Prove a test fails       | Each rule of the state machine, the status fields and the `Prefer` cap seen failing with its code undone                                                                               | Pass       |
| IV. Stable identifiers        | No identifier is shown or linked by this feature                                                                                                                                       | Pass (n/a) |
| V. Comments carry the failure | The code's comments say what failed without them (the new tab, the 30-s hold), not how                                                                                                 | Pass       |

Re-checked after Phase 1: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/031-analysis-report-download/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R5
├── data-model.md        # Report request, Report status, Kept report; the page's states
├── quickstart.md        # pdf-export with a slow report, the site against it
├── contracts/
│   ├── report-status.md # pdf-export's 202 status and Prefer: wait (proposed, its spec 002)
│   └── report-states.md # the page's states, their words and actions
└── checklists/requirements.md
```

### Source Code (repository root)

```text
projects/pathway-browser/src/app/
├── details/tabs/download-tab/
│   ├── download-tab.component.ts        # the report's button uses the new flow
│   ├── download-button/                 # `opens` no longer used for the report
│   └── report-download/                 # NEW: the status line and its actions
└── services/
    └── report-downloads.service.ts      # NEW: one entry per report; fetch, poll, save

projects/contract/analysis-report.ts     # NEW (types only): the 202's status, as pdf-export writes it

tools/analysis-gateway/gateway.spec.ts   # a 202's body and a request's Prefer pass through

e2e/report-download.spec.ts              # NEW: the tab, a stubbed report route, no new page

pdf-export (its own repository, spec 002):
├── src/report/jobs.ts                   # a job's stage, counts; queue place
├── src/report/times.ts                  # NEW: past reports' times; the estimate
├── src/serve.ts                         # status in the 202; Prefer: wait
└── specs/002-analysis-report/contracts/service.md
```

**Structure Decision**: the site's flow is a root service (state per report, so leaving and
returning to the tab finds it) and a small component for the line; the type of the status
is in the shared contract module (spec 016: one type per answer). pdf-export's part is a
task in its spec 002, merged and deployed before the site's flow depends on its fields;
the site shows queued, making, ready and failed from today's 202 alone until then.

## Order of work

1. **pdf-export:** the status in the 202 and `Prefer: wait` (contracts/report-status.md),
   with its tests; deployed on beta.
2. **Measurement:** SC-004 on beta (ten reports), recorded in research R2.
3. **The site:** the contract type; `ReportDownloads` and its unit tests; the status line;
   the Download tab using it; the gateway's pass-through test; the e2e with SC-001,
   SC-005, SC-006 and SC-007.
4. **Polish:** the declared-differences register if anything differs for a caller (nothing
   is planned to); spec 002's tasks ticked in pdf-export.

## Complexity Tracking

None: no principle is broken.
