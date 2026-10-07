# UI Contract: what each fix promises a reader

Each row is the visible behaviour the fix commits to. It is the thing tested, and the
thing a curator would check.

| Item | Where                                | Promise                                                                                     |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| 1a   | /about/digital-preservation          | Heading "Digital Preservation"; the word "Untitled" appears nowhere                         |
| 1b   | /about/logo                          | Every option saves a file (never opens a page); each is the named size and format           |
| 1c   | /content/reactome-research-spotlight | Intro explains spotlights; newest first; each article once; includes 22 May and 6 July 2026 |
| 1c   | / (home)                             | Spotlight tile shows the newest article                                                     |
| 1e   | news V97, V96                        | Every "other news" link opens a real page                                                   |
| 1e   | legacy paths                         | An old reactome.org path with a clear new home lands there                                  |
| 1f   | /documentation/inferred-events       | Chart names the current release                                                             |
| 1g   | /ContentService/, /AnalysisService/  | _Pending decision_ — site header and API docs, no legacy menu                               |
| 2a   | pathway browser top bar              | _Pending decision_ — tour and layout controls present and working                           |
| 2c   | R-HSA-9909396                        | Illustrated diagram fully coloured: filled pills, arrows, labels                            |
| 2d   | EHLD + hierarchy                     | Hovering a subpathway row highlights its region; clears on leave; selection unaffected      |
| 2e   | ELV + hierarchy                      | _Colour pending decision_ — hovering a subevent row highlights it in the diagram            |
| 2f   | Details panel                        | GO biological process shown, linked, when the event has one; absent otherwise               |
| 2g   | Details panel                        | Human events list orthologous events by species; inferred events say so                     |
| 3a   | qualitative analysis form            | Every example button's name readable at 1280×720 and above                                  |
| 3b   | analysis results                     | An unloadable result says so, never shows nothing                                           |
| 3c   | analysis results                     | No previous analysis's summary visible; a summary can be closed                             |
| —    | whole site                           | No internal link leads to a missing page                                                    |
