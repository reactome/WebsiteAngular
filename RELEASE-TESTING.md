# Release testing: the new UI

The successor to _Appendix R3: Release Database Testing_, which is a 13-page
manual pass over the old site. The point of this one is to be **shorter every
release**: every row that becomes a test is a row a curator never reads again.

Each item is marked:

- **auto** — a test asserts it. If the suite is green, this is true. The spec is named.
- **human** — cannot honestly be automated, and why.
- **gap** — should be automated and is not yet. These are the work queue.
- **missing** — the old site does this and the new one does not. Not a test gap; a feature decision.

Run everything with `npm test && npm run check:dead && npm run check:lint && npx playwright test`.

**Where it stands: 25 automated, 7 that need a person, 19 still to write, 2 not
built.** The third number is the one to drive down; the second is the honest
floor; the fourth is a decision, not work.

> Where the old document says "clear your browser cache before testing", note that
> figures are served `private, no-cache` now and the app's own assets are
> content-hashed, so a stale page is a bug rather than something to work around.

## Front page

| Item                                                                                  | Status                                                                                 |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Version number and release date at the bottom of the homepage                         | **gap**                                                                                |
| Every button links where it says, including the participating-institute links         | **auto** — `homepage.spec.ts` covers the shortcut cards; institute links are a **gap** |
| News is current, and the links inside the latest news item work                       | **gap**                                                                                |
| Search `p53` returns >1700 results, confined to Homo sapiens or species-less entities | **auto** — `release-checklist.spec.ts`                                                 |
| A newly added pathway, reaction and complex render; and an old one                    | **human** — "newly added" changes every release and comes from the project calendar    |

## Navigation bar

| Item                                                                   | Status                                                                                                |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| All six menus have dropdowns                                           | **auto** — `nav-links.spec.ts`                                                                        |
| Every link in every dropdown reaches a real page                       | **auto** — `nav-links.spec.ts` crawls all 73 and fails naming any that 404s or renders an empty shell |
| About → Statistics shows the current release and date                  | **gap**                                                                                               |
| Content → Table of Contents: NEW and UPDATED flags correct             | **human** — correctness depends on what curators released                                             |
| Content → DOI: NEW/UPDATED flags on the right pathways                 | **human** — as above                                                                                  |
| Docs → Computational Inferred Events shows the current release's image | **gap**                                                                                               |
| Download menu: every link valid and every file present                 | **gap** — the S3/CloudFront move lands here                                                           |

## Pathway Browser

| Item                                                                        | Status                                                                                                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opens with the top-level pathway list                                       | **auto** — `pathway-browser.spec.ts`                                                                                                              |
| Exactly the 16 documented species in the dropdown                           | **auto** — `release-checklist.spec.ts`                                                                                                            |
| Every top-level pathway draws a diagram                                     | **auto** — `diagram-coverage.spec.ts` walks all 29 from the content service, so a pathway promoted to top level is covered the release it appears |
| Species switch to _Mus musculus_ still draws diagrams                       | **gap**                                                                                                                                           |
| An EHLD appears for DNA repair, and unfurls                                 | **auto** — `pathway-browser.spec.ts`                                                                                                              |
| Hovering a sub-pathway lights up its reactions; selecting one highlights it | **gap**                                                                                                                                           |
| Scroll wheel zooms                                                          | **auto** — `interactive-state.spec.ts`                                                                                                            |
| Diagram key is visible                                                      | **gap**                                                                                                                                           |
| Zoom in, out, centre                                                        | **auto** — `interactive-state.spec.ts`                                                                                                            |

## In-diagram search

| Item                                                               | Status                                                                                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Searching USP10 in DNA damage bypass finds it                      | **auto** — `in-diagram-search.spec.ts`                                                                                                                      |
| Selecting a result highlights it in the diagram                    | **auto** — `in-diagram-search.spec.ts`, by asserting the selection reaches the URL, which is what the diagram, the details panel and a shared link all read |
| "All pathways" returns a larger hit count than the current pathway | **auto** — `in-diagram-search.spec.ts`                                                                                                                      |

## Details panel

| Item                                                                                         | Status                                                                |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Six tabs present and populated for a pathway                                                 | **auto** — `release-checklist.spec.ts` (presence), contents a **gap** |
| Molecules tab: counts per protein, icon cycles instances, selection shades the list          | **gap**                                                               |
| Molecules tab: filters and downloads                                                         | **auto** — `pathway-browser.spec.ts` covers the download table        |
| Structures shown for proteins                                                                | **gap**                                                               |
| Reaction: name, StableID, summation, input, output, catalyst, references, authored, reviewed | **gap**                                                               |

## Context menus and interactors

| Item                                                           | Status                                                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Right-click an entity offers Molecule, Pathways, Interactors   | **auto** — `diagram-entity-popup.spec.ts`                                                                                                              |
| Pathways list navigates to a different diagram                 | **auto** — `diagram-entity-popup.spec.ts`                                                                                                              |
| Interactor overlay draws, and clearing removes it              | **auto** — `interactors.spec.ts`, asserted by looking at the diagram rather than at the button                                                         |
| Raising the confidence threshold reduces the interactors shown | **missing** — there is no confidence control in this UI, and no threshold concept in the interactor services or the URL state. The old browser has one |
| Interactor download                                            | **missing** — no such control exists here                                                                                                              |

## Analysis tools

| Item                                                            | Status                                                                                                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All four tools reachable, each opening on its own tab           | **auto** — `release-checklist.spec.ts`. _The old document notes the old site opened every tool on "Analyse gene list"; ours does not, and the test asserts that_ |
| Gene list analysis runs and returns results                     | **auto** — `analysis.spec.ts`                                                                                                                                    |
| GSA methods load from GSAServer                                 | **auto** — `analysis.spec.ts`                                                                                                                                    |
| Hit counts and FDR appear beside pathway names in the hierarchy | **gap**                                                                                                                                                          |
| Filters change the result set                                   | **gap**                                                                                                                                                          |
| Species comparison and tissue distribution produce an overlay   | **gap**                                                                                                                                                          |
| Analysis result downloads                                       | **gap**                                                                                                                                                          |

## Downloads and figures

| Item                                                                     | Status                                                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Every diagram format produces a file of the type it claims               | **auto** — `downloads.spec.ts` checks magic bytes, not just that a file arrived               |
| Illustrated pathways export the whole illustration                       | **auto** — `downloads.spec.ts`                                                                |
| GIF animates one frame per analysis sample                               | **auto** — `downloads.spec.ts`, skipped with a message when the render service is not running |
| PPTX opens in PowerPoint and converts to editable shapes                 | **human** — needs PowerPoint. This is the one item we cannot close                            |
| Sub-pathway highlighting checkbox changes the exported figure            | **auto** — `downloads.spec.ts`                                                                |
| Animated SVG timeline: play/pause, click to seek, hover names the sample | **gap**                                                                                       |

## Post-release

| Item                               | Status                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| New EHLDs present on the live site | **human** — depends on the release                              |
| Editorial calendar visible         | **human**                                                       |
| `/tag/release` page visible        | **gap**                                                         |
| ORCID claiming works               | **human** — blocked on a backend deploy; see the curator report |

## What a test cannot do

Worth being explicit, because "the tests pass" should not be heard as "everything
is right":

- **Scientific correctness.** A test can prove a diagram drew 431 elements. It
  cannot prove they are the right 431.
- **Whether a file opens in someone else's application.** PowerPoint is the live
  example.
- **Anything defined by what curators released this cycle** — new pathways, NEW and
  UPDATED flags, the current release's inferred-events image.
- **Aesthetics.** "The words fit in the shapes" was a real bug this month, found by
  eye. A pixel baseline could catch a regression once someone approves a
  reference image, but it cannot tell a deliberate improvement from a break.
- **Anything the edge does.** The suite runs against the dev server on
  `localhost:4200`, so Apache rules, Cloudflare behaviour and TLS are outside it
  entirely. A green suite says the application is right, not that beta is serving
  it correctly. Those need a request against `beta.reactome.org` itself.

## Two traps worth knowing before you write a test here

**Export URLs refuse requests without a Referer.** `/ContentService/exporter/*` is
allowed only when the request came from one of our own pages -- see
`protect-exporters.sh` -- because crawling those endpoints exhausted Tomcat's heap
and took the origin down. A browser clicking a download sends a Referer and gets
its file; `curl` gets a **403**, and it looks exactly like a broken feature. It is
not. Send a Referer, or drive a browser.

**Download buttons match by their label's own text, not the button's.** The button
renders its icon as a font ligature inside the same anchor, so the element's text
content is `imageSVG`, and an anchored match against the button finds nothing.
`getByText('SVG', { exact: true })` inside the container is what works.
