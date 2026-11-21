# Data model: the analysis report, made and downloaded in place

## Report request

What the reader asked for; its address is its key.

| Field     | Meaning                                                                                 |
| --------- | --------------------------------------------------------------------------------------- |
| `token`   | the analysis's token (sent to Reactome's own services only, FR-014)                     |
| `species` | the species chosen                                                                      |
| settings  | `resource`, `number`, `importableOnly`, and the rest the report's address carries today |
| `address` | `analysisReportUrl(...)` as today: the key of the page's entry and pdf-export's job     |

Two requests with one address are one report (pdf-export joins them).

## Report status (from pdf-export's 202)

As contracts/report-status.md: `state` (`queued` or `making`), `place` (when queued),
`stage` (`reading`, `figures`, `printing`, when making), `done` and `total` (for
`figures`), `estimate` (seconds left, when known). Absent fields are unknown, never zero.

## The page's entry for a report (`ReportDownloads`)

One per address, for the page's life.

| Field     | Meaning                                                                               |
| --------- | ------------------------------------------------------------------------------------- |
| `phase`   | see the states below                                                                  |
| `status`  | the last Report status read, while waiting or making                                  |
| `file`    | the PDF as a Blob, once fetched, with its name                                        |
| `failure` | its kind (`gone`, `busy`, `failed`, `unreachable`) and `retryAfter` where given       |
| `asked`   | when the request started (for "taking longer than expected" and the 2-minute silence) |

### States and their moves

```text
idle ──ask──▶ starting ──202 queued──▶ queued ──202 making──▶ making ──200──▶ saved
                 │                       │                      │
                 ├──200──────────────────┴──────────────────────┴──────────────▶ saved
                 ├──404/410──▶ failed(gone)        (no retry; run the analysis again)
                 ├──503──────▶ failed(busy)        (retry after Retry-After)
                 ├──500──────▶ failed(failed)      (retry; how to report)
                 └──no answer 2 min──▶ failed(unreachable) (retry)
queued/making ──cancel──▶ idle        (the request in flight aborted; pdf-export keeps going)
saved ──download again (within the hour)──▶ saved   (from `file`, no request)
saved ──download again (past the hour)──▶ starting
failed(busy|failed|unreachable) ──retry──▶ starting
```

## Kept report

pdf-export keeps a finished report an hour (its spec 002). The page keeps its own copy in
`file` for the same hour; after it, "download again" asks pdf-export afresh.
