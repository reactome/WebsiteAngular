# Quickstart: the analysis report, made and downloaded in place

## What it proves

A reader asks for the report on the Download tab, stays on the page, sees it queued, then
made stage by stage with an estimate, and gets the PDF; failures show their own words.

## Setup

1. **pdf-export** with the status (its spec 002 task) running as beta's service does
   (`deploy/pdf-export`), or locally: `pdf-export serve --analysis <this host's Analysis
Service> --render <the render service> --files <the release's folder>`.
2. **A token:** an analysis made on this host's own Analysis Service (never production):
   an over-representation of a few hundred identifiers, so its report takes minutes.
3. **The site** built to a scratch folder, served against beta's services (never beta's
   `dist/`), or beta itself once deployed.

## Scenarios

| #   | Do                                                               | Expect                                                                                    |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | Open the token's results, the Download tab; ask for the report   | No new tab; "Starting…" within 1 s; then making with stages and counts; the PDF downloads |
| 2   | Ask for two other reports first (another species), then this one | "Queued: 2 ahead"; the number falls                                                       |
| 3   | Ask again for the report just made                               | It downloads at once                                                                      |
| 4   | Ask, then Cancel                                                 | The line clears; nothing downloads                                                        |
| 5   | Leave the tab while it is made, come back                        | The line shows the same report's state                                                    |
| 6   | Ask with an expired or made-up token                             | "No longer available", no retry                                                           |
| 7   | Open the report's address directly in a browser                  | Today's page that asks again, then the file                                               |
| 8   | Watch the requests (browser tools)                               | Every request with the token goes to the site's own origin                                |

## Measuring SC-004

Ten reports of release 98 tokens (25 and 50 pathways, over-representation and expression),
one at a time with nothing else queued; record each first `estimate` and the time to the
200; within 50% in at least eight of ten.
