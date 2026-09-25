# Quickstart: verifying the curator fixes on beta

How to confirm each item on beta after deployment. Every check is the **visible outcome**
from [the UI contract](./contracts/ui-contract.md) — never an HTTP status, because this site
answers 200 for pages that do not exist.

## Before checking anything

Confirm beta is serving the change, not an older build:

```sh
curl -s https://beta.reactome.org/health
```

The `bundle` and `built` fields must postdate the merge. Three changes this week were
merged and never deployed; their checks passed against code that was not running.

## Checks

| Item | Do this                                                                        | Expect                                                          |
| ---- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 1a   | Open About → Digital Preservation                                              | Heading "Digital Preservation"                                  |
| 1b   | Click each logo option                                                         | A file downloads; Medium and Large positive PNGs open as images |
| 1c   | Open Content → Research Spotlight                                              | Intro paragraph; first card 6 July 2026; no title twice         |
| 1e   | Follow each "other news" link in the V97 item                                  | Each opens a real page                                          |
| 1f   | Open Docs → Computationally inferred events                                    | Chart titled "Reactome Version 97"                              |
| 2c   | Open `/PathwayBrowser/R-HSA-9909396`                                           | Coloured pills, arrows, labels; no blue square                  |
| 2d   | On `/PathwayBrowser/R-HSA-1640170`, hover "Cell Cycle Checkpoints" in the tree | Its region glows, then clears                                   |
| 2f   | Open `/PathwayBrowser/R-HSA-109582?tab=description`                            | "blood coagulation (GO:0007596)"                                |
| 2g   | Same page                                                                      | Orthologous events listed by species, e.g. Mus musculus         |
| 2g   | Open `/PathwayBrowser/R-MMU-1640170?tab=description`                           | "Computationally inferred"; "Inferred From: Cell Cycle"         |
| 3a   | Resize to 1366×768; open the qualitative form                                  | Every example button's full name visible                        |
| 3c   | Run the UniProt example, summarise; run Gene Name                              | No trace of the first summary; a close control works            |

## Automated

```sh
npm test && npm run check:types && npm run check:lint && npm run check:dead && npm run format:check
npm run e2e
```

Each code fix adds a test shown failing against the code before the fix.
