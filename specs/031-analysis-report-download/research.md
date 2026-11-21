# Research: the analysis report, made and downloaded in place

Read from the code on 21 Nov 2026: WebsiteAngular main (the Download tab, the managed
downloads, the analysis gateway) and pdf-export main (spec 002's contract,
`src/report/jobs.ts`, `src/serve.ts`).

## Today

- **The site:** the Download tab's report button (`download-button` with `opens`) opens
  `analysisReportUrl(...)` (`/AnalysisService/report/{token}/{species}/report.pdf` with the
  report's settings) in a new tab; the managed-download directive is off for it
  (`crManagedDownload` false), as a fetch would save the waiting page.
- **The gateway** (`tools/analysis-gateway/gateway.ts`) sends `/AnalysisService/report/…`
  to pdf-export, not queued, setting `X-Reactome-Client` itself; a report in flight counts
  in the client's share (PER_CLIENT).
- **pdf-export** (spec 002, contracts/service.md): a request starts the report for its key,
  or joins the one queued, being made or kept, and waits up to 30 s. Ready: 200, the PDF.
  Not ready: 202, `Retry-After: 10`, JSON `{code, reason, messages}`, or for `Accept:
text/html` a page that asks again after 10 s. Errors: 404/410 (token), 500 (failed), 503
  (busy, unreachable, past budget; `Retry-After`). Kept an hour; two made at once, eight
  waiting, two of those per client; a joining request never counted.
- **Its jobs** (`src/report/jobs.ts`) already hold a state, `queued | making | ready |
failed`, and the queue in order; no stage or progress is recorded.
- **Measured times** (pdf-export spec 002 research, SC-203): an over-representation report
  alone, cold, 102 s at 25 pathways and 184 s at 50, most of it drawing figures (4–7 s
  each, two at a time); printing and the analysis's reads a few seconds each.

## R1. The status answer

- **Decision:** pdf-export adds a `status` object to the JSON 202 it already gives a caller
  that does not ask for HTML: `state` (`queued` or `making`), `place` (reports ahead, when
  queued), `stage` (`reading`, `figures`, `printing`, when making), `done` and `total` (for
  `figures`), and `estimate` (seconds left, when it has one). A request may ask to be held
  less than the 30 s with `Prefer: wait=<seconds>` (RFC 7240), at most 30, so a poll
  answers within a few seconds. Nothing else changes: the address, the 200, the errors,
  the browser's page, and a request without `Prefer` (held 30 s as today). Recorded as a
  task in pdf-export's spec 002 (contracts/report-status.md here is the proposal).
- **Rationale:** the smallest change to pdf-export's contract: no new address, no new
  route in nginx or the gateway; the fields are additions to an answer callers already
  read, so a caller that ignores them is unaffected (FR-013). The 30-second hold would
  break FR-006's 10 seconds; `Prefer: wait` is the standard way to ask for less, and a
  header leaves the address, and its cache keys, alone.
- **Alternatives:** a status address beside the report's (a second route through nginx and
  the gateway, and a second key to keep in step); a pushed stream (server-sent events) —
  the gateway would hold a connection per reader for minutes, counted in its share, for
  no gain over a poll every few seconds; a query parameter for the hold (changes the
  address).
- **The failures** keep their status codes; their JSON already says which (404, 410, 500,
  503 with `Retry-After`), so no failure field is added.

## R2. The estimate

- **Decision:** pdf-export keeps, in memory, the seconds per figure (render and inlining)
  and the seconds of everything else (reads, printing) of its last 20 reports, and
  estimates: making, `figures left × seconds per figure ÷ figures at once + other seconds
left`; queued, the reports ahead `÷ reports made at once ×` a report's mean time, plus
  this one's. With no past report yet (after a start), no estimate (spec: no guess).
- **Rationale:** figures are most of a report's time (R0's measurement) and their count is
  known when the report starts making, so the estimate scales with the report; a rolling
  window follows the render service's current speed. Kept in the process, as jobs are
  (one instance; a restart loses them, and the first reports after give none).
- **SC-004** (within 50% at the start, four reports in five, alone in the queue): checked in
  the plan's measurement task by making ten reports of release 98 tokens at 25 and 50
  pathways, over-representation and expression, and comparing the first estimate with the
  time taken. Expected to hold for over-representation (figures dominate); expression's
  extra per-figure overlay time is in its own per-figure mean.

- **SC-004, measured 21 Nov 2026: met, eight of ten.** Ten over-representation reports of
  release 98 through beta's analysis gateway, one at a time, tokens made on this host's own
  Analysis Service; the first estimate each report's status gave (5 s after asking, in the
  reading stage) against the time from then to its PDF:

  | Pathways | First estimate | Took  | Ratio |
  | -------- | -------------- | ----- | ----- |
  | 25       | 95 s           | 129 s | 0.74  |
  | 50       | 109 s          | 176 s | 0.62  |
  | 25       | 110 s          | 112 s | 0.98  |
  | 50       | 106 s          | 107 s | 0.99  |
  | 25       | 100 s          | 95 s  | 1.05  |
  | 50       | 99 s           | 130 s | 0.76  |
  | 10       | 38 s           | 22 s  | 1.74  |
  | 40       | 68 s           | 98 s  | 0.69  |
  | 50       | 57 s           | 79 s  | 0.72  |
  | 10       | 37 s           | 20 s  | 1.89  |

  The two outside 50% are the smallest reports (10 pathways), over-estimated: in the
  reading stage the estimate is a past report's mean time, before this report's figures
  are counted. Since reactome/pdf-export#246 the reading stage's estimate takes the figures
  the report is likely to draw (a pathway's each and the overview) at the past pace.

## R3. The site: polling and saving

- **Decision:** a root-provided `ReportDownloads` service holds one entry per report
  address (the report request's key) for the page's life: its state, the last status and
  the file once fetched. Asking for a report fetches its address with `Accept:
application/json, application/pdf` and `Prefer: wait=5`, and asks again as soon as each
  202 arrives (the hold paces it: an answer at least every 5 s plus the round trip, under
  FR-006's 10). A 200 is read as a Blob and saved as the managed downloads save
  (`FileDownloadService`), under the report's file name, and kept for "download again" for
  the hour; a 404/410 is "result no longer available", 503 "busy, try again" (after its
  `Retry-After`), 500 "could not be made". Cancel aborts the request in flight and stops
  asking; the service goes on making the report (another tab may want it) and keeps it.
- **Rationale:** reuses the site's download feedback (the managed-download look and the
  saving) so the report reads like the tab's other files; a service rather than component
  state, so leaving the tab and coming back finds the report (FR-012). After a reload the
  entry is gone, but asking again joins pdf-export's report or its kept file at once.
- **Alternatives:** keep the new tab and improve pdf-export's page (still a new tab; the
  user asked to stay on the page); poll on a fixed timer without a hold (more requests,
  each counted by the gateway).

## R4. The gateway

- **Read:** it forwards a report request's headers but its own client header, and streams
  pdf-export's answer back with its headers. `Prefer` and the JSON body pass through
  unchanged. A poll is one request in flight at a time per tab, held at most 5 s: well
  inside the client's share (PER_CLIENT), and joining requests are never counted by
  pdf-export.
- **Decision:** no change to the gateway beyond a test that a 202's JSON body and a
  request's `Prefer` pass through unchanged (spec 010's report route).

## R5. Tests

- **Unit:** the polling state machine (`ReportDownloads`) against a stub fetch: each status
  shown with its words; the pacing (a new request after each 202, none after cancel);
  each failure kind and its action; download again without a request; re-entry finding the
  entry. Each seen failing with its rule undone (constitution III).
- **e2e:** the Download tab with the report's address answered by a route handler in the
  test (202 queued, 202 making with counts, 200 PDF; and a 410): no new page opens
  (Playwright's context counts pages), the line's text follows the states, and the
  download event fires with the report's name.
- **SC-006:** the e2e records every request the page makes while getting a report and
  checks that the token appears only in requests to the site's own origin.
- **pdf-export's part** is tested in pdf-export (its spec 002 task): the status fields for
  queued and making, `Prefer: wait` honoured and capped, the browser's page unchanged.
