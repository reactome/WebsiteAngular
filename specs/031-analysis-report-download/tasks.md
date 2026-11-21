# Tasks: The analysis report, made and downloaded in place

**Input**: Design documents from `specs/031-analysis-report-download/`: plan.md, spec.md,
research.md (R1–R5), data-model.md, contracts/report-status.md, contracts/report-states.md,
quickstart.md.

**Tests**: each task's tests are written with it and seen failing with its change undone
(constitution III). Each task is one pull request; its PR ticks it here with its number.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 (follow it on the page), US2 (failures), US3 (cancel, download again)

---

## Phase 1: Setup

- [x] T001 In pdf-export, add a task to its `specs/002-analysis-report/tasks.md` for the
      report's status (this spec's contracts/report-status.md, FR-015), linking here; its
      contracts/service.md gains the status and `Prefer: wait` when that task is done. (reactome/pdf-export#244: its spec 002 T029)
- [ ] T002 [P] The status's type, as pdf-export writes it, in
      `projects/contract/analysis-report.ts` (types only, spec 016), with a check that a
      recorded 202 matches it (`tools/api-types`).

---

## Phase 2: Foundational (pdf-export's part, blocks the stages and estimate)

- [x] T003 In pdf-export: a job's stage and counts (`src/report/jobs.ts`, set by the
      report's making in `src/report/report.ts`: reading, then figures with done/total,
      then printing), and its place while queued. (reactome/pdf-export#244)
- [x] T004 In pdf-export: past reports' times and the estimate (`src/report/progress.ts`,
      research R2): seconds per figure and other seconds over the last 20 reports; none
      before the first. (reactome/pdf-export#244)
- [x] T005 In pdf-export: the `status` object in the JSON 202 and `Prefer: wait`
      (`src/serve.ts`, contracts/report-status.md), with its tests; the browser's page and
      every other answer unchanged (a byte comparison of the page). (reactome/pdf-export#244)
- [x] T006 Deploy pdf-export's new commit on beta (`deploy/pdf-export`'s pin and
      `deploy/java/PINS.md`-style note), and check a real 202 there carries `status`.
      Pinned in #1029 and #1031. 21 Nov, through beta's gateway, `Prefer: wait=2` and
      `Accept: application/pdf, application/json`: a 202 with `Preference-Applied: wait=2`,
      `Retry-After: 10` and `"status":{"state":"making","stage":"printing","estimate":20}`.
- [x] T007 [P] The gateway passes a 202's JSON and a request's `Prefer` through unchanged:
      a test in `tools/analysis-gateway/gateway.spec.ts` (R4). Seen failing with `prefer`,
      and then `preference-applied`, added to the headers the gateway drops. (#1034)

**Checkpoint**: a poll of beta's report address with `Prefer: wait=5` answers within about
5 s with the status.

---

## Phase 3: User Story 1 - Ask and follow it on the page (Priority: P1) 🎯 MVP

**Goal**: the report asked for and followed on the Download tab, then saved.

**Independent Test**: quickstart scenarios 1–3 and 5.

- [x] T008 [US1] `ReportDownloads` (`projects/pathway-browser/src/app/services/report-downloads.service.ts`):
      one entry per report address; ask = fetch with `Accept: application/json,
application/pdf` and `Prefer: wait=5`; a 202 stores its status and asks again; a 200
      reads the Blob and saves it as `FileDownloadService` does, under the report's name;
      data-model's states. Unit tests against a stub fetch: the states in order, a new
      request after each 202, the 200 saved once. (#1030)
- [x] T009 [US1] The status line (`details/tabs/download-tab/report-download/`): the words of
      contracts/report-states.md for idle, starting, queued, making (each stage), past the
      estimate, saved; a polite live region; the managed-download look. (#1030)
- [x] T010 [US1] The Download tab's report button uses them, no longer `opens` a new tab
      (`download-tab.component.ts`, `download-button`); re-entry to the tab shows the
      entry's state (FR-012). (#1030)
- [x] T011 [US1] e2e (in `e2e/analysis-results.spec.ts`, beside the other result files): the report's address answered in the
      test (202 queued, 202 making with counts and estimate, 200 PDF): no new page opens
      (SC-001), the line follows the states, the download event has the report's name;
      the first status within 1 s (SC-002). (#1030)

**Checkpoint**: on beta, a real report followed and downloaded on the page.

---

## Phase 4: User Story 2 - Failures said plainly (Priority: P1)

**Goal**: each failure with its own words and action.

**Independent Test**: quickstart scenario 6, and each failure answered in the e2e.

- [x] T012 [US2] `ReportDownloads`: 404/410 → gone (no retry), 503 → busy (retry after its
      `Retry-After`), 500 → failed (retry, how to report), two minutes without an answer →
      unreachable (retry). Unit tests for each, and for a retry starting afresh. (#1030)
- [ ] T013 [US2] The line's failure words and actions (contracts/report-states.md); e2e for
      each kind (SC-005).

---

## Phase 5: User Story 3 - Cancel and download again (Priority: P2)

**Goal**: stop waiting; download again without remaking.

**Independent Test**: quickstart scenarios 3 and 4.

- [x] T014 [US3] Cancel aborts the request in flight and stops asking, the entry back to
      idle; download again from the entry's Blob within the hour, and afresh past it. Unit
      tests (no request after cancel; none for download again within the hour). (#1030)
- [ ] T015 [US3] The line's Cancel and Download again; e2e for both.

---

## Phase 6: Polish & cross-cutting

- [x] T016 SC-004: ten reports on beta (quickstart's measurement), each first estimate
      against the time taken; recorded in research R2. If under eight in ten, the estimate
      is reworked in pdf-export (T004) before this is ticked. Met, eight of ten (research R2); the small reports' estimate refined in reactome/pdf-export#246, pinned here (#1031).
- [x] T017 [P] SC-006: the e2e records every request while getting a report and fails if the
      token reaches any host but the site's own. Done in #1030's e2e: every request with the token, while a report is followed, goes to the site's own origin.
- [x] T018 [P] SC-007: a browser opening the report's address directly gets today's answers
      (202 page, 200 PDF, 410), checked against recorded answers. Checked 21 Nov on beta
      against pdf-export's contracts/service.md, with a browser's `Accept`: a report not yet
      made (asked with `Prefer: wait=1` too, since small reports are made within the 30 s
      a request is held), the page that asks again (202, `text/html`, `Retry-After: 10`, `Cache-Control:
no-store`, a refresh after 10 s, no `status`); a made one, the PDF (200,
      `Content-Disposition: attachment`); an unknown token, 404 in JSON. A 410 (a dated
      token with no result) cannot be made on purpose here; pdf-export's own tests cover
      it. (#1034)
- [x] T019 The User Guide's analysis page, where it describes downloading the report, says
      what the reader now sees (if it describes it). Nothing to change: the site's text says only that the report can be downloaded, never how it opened.
- [x] T020 pdf-export's spec 002 task (T001) ticked there with its PR; this spec's tasks
      ticked with theirs. pdf-export's spec 002 T029 ticked there in reactome/pdf-export#244.

---

## Dependencies & order

- T001 first; T003 → T004 → T005 → T006 (pdf-export, then beta).
- T002 and T007 any time.
- US1 (T008–T011) can start on today's 202 (states without stages) and gains stages once T006
  is deployed; T011's e2e uses its own answers, so it does not wait.
- US2 and US3 after T008.
- T016 after T006 and US1; T017–T018 after T011.

## Parallel opportunities

- T002, T007 beside pdf-export's T003–T005.
- T009 (the line) beside T008 (the service) once the states are agreed (data-model).
- T017 and T018 together.

## Implementation strategy

- **MVP:** US1 with today's 202 (queued or making, no stages): already ends the new tab and
  the silence. Then pdf-export's status for stages and the estimate, then US2, then US3.
