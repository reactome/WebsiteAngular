# Research: Curator email review, 25 September

Every finding here was produced by investigation and then **re-verified** before being
written down — the load-bearing claim of each (the API field, the line of code, the
behaviour on beta) was checked independently of the report that first made it. Where
something could not be confirmed, it says so.

Each item carries an **ease/certainty rank** that orders the tasks, as the user asked:

| Rank | Meaning                                                          |
| ---- | ---------------------------------------------------------------- |
| 1    | Cause certain, fix small, verification unambiguous               |
| 2    | Cause certain, one small judgement in the fix                    |
| 3    | Mechanics easy, needs a user decision on behaviour or appearance |
| 4    | Needs an infrastructure or cross-service decision                |
| 5    | Not this site's code — classified, with an owner                 |

---

## 2c — The "Circadian clock" EHLD renders broken · rank 1

**Root cause.** `ehld.component.ts:105` inserts the SVG with `innerHTML`, which runs the
**HTML** parser. This Figma export fakes angular gradients with
`<foreignObject><div xmlns="…/xhtml" style="background:conic-gradient(…)"/></foreignObject>`.
HTML does not self-close a `div`, so it swallows every sibling after it — including the
`<defs>` holding 174 gradients, clip paths and masks, which end up nested inside a
`<path>`. Nothing that refers to them renders: empty molecule pills, missing arrows and
label, and an unclipped blue square.

**Evidence.** The file is valid (560 kB, every `url(#…)` resolves) and renders correctly
standalone. In beta's live DOM `<defs>` is a child of `path#Vector_191`, not of `<svg>`.
Re-inserting the same text via `DOMParser` on beta rendered it fully. Cell Cycle
(R-HSA-1640170) has no `foreignObject` and renders correctly.

**Decision.** Parse as XML — `DOMParser` with `image/svg+xml` — and insert the parsed
node; surface a `parsererror` rather than inserting a broken document.
`render.component.ts:676` already parses glyphs this way.

**Rationale.** SVG is XML. `innerHTML` only appeared to work because most exports happen
to contain nothing the HTML parser treats differently.

**Alternatives.** Rewriting `<div/>` to `<div></div>` by regex before insertion: rejected
— it repairs one construct and leaves the wrong parser in place for the next.

**Scope.** All 220 EHLDs in release 97 checked; one live pathway affected today. Any
future Figma export using angular gradients would be.

**Related.** EHLD SVG/PNG export (`svg-exporter.service.ts:157`, `ehld.service.ts:468`)
and the headless render service (`render.component.ts:59` embeds `EhldComponent`) clone
or rasterise the same live DOM, so their Circadian clock output is broken too. To be
confirmed after the fix, not assumed.

**Verify on beta.** R-HSA-9909396 shows filled pills (CLOCK, BMAL1, CRY1), arrows and the
"Regulation of the circadian clock" label, no blue square; `#ehld svg > defs` exists.

---

## 3c — Analysis summary outlives its analysis, and cannot be closed · rank 1

**Root cause.** Reproduced on beta. The guard added in #278 (`analysis-summary.component.ts:219-222`)
clears the summary only when the `token` input changes **while the component stays
mounted**, tracked in a per-instance `let previous = null`. But opening the Analyze
dropdown sets `detailVisible` false (`viewport.component.ts:254`), and
`@if (detailVisible())` (`viewport.component.html:348`) destroys the whole details panel,
rebuilding it when the result lands. Each new analysis therefore gets a **new component
instance**, whose first run sees `previous === null` and never clears. `SummaryService`
is `providedIn: 'root'`, so analysis A's text renders over B.

**That fix was effectively dead code for real use.** Running any analysis through the form
goes through the dropdown, so the one path it covered is one a reader does not take. The
Clear-analysis button and switching away from the Results tab re-create the panel the
same way.

**No close control** — confirmed from the template.

**Decision.** The service records which analysis its state belongs to (it already sets
`_lastToken` in `summarise()`); the component clears whenever the service holds a
different one. This holds across re-creation, because it compares against state that
outlives the component rather than state that dies with it. Add a close button calling
`clear()`; the service's cache makes asking again instant.

**Rationale.** The search-answer panel already does exactly this and its comment records
the same class of bug fixed there (`search-answer.component.ts:285-293`).

**Alternatives.** Scoping the service to the component (non-root provider): rejected — it
would discard a summary on every tab switch and re-spend a rate-limited model call.

**Verify on beta.** Run the UniProt example and summarise; run Gene Name; the Results tab
shows a fresh "Summarise this result" with none of A's text. A close control hides it.
A unit test creates a second instance against a service holding another token, and is
shown failing against the current code first (constitution III).

---

## 2f — GO biological process missing from Details · rank 1

**Root cause.** Never implemented. `/data/query/enhanced/v2/{id}` returns
`goBiologicalProcess` (R-HSA-109582 → _blood coagulation_, GO:0007596) and
`description-overview.component.html` never reads it.

**Decision.** Render it in the overview with the existing `cr-ontology-term` component,
which already links QuickGO and shows the definition as a tooltip. Label
"GO biological process". The field is on `Event`, so reactions gain it too.

**Related.** `/content/detail/{id}` reuses `cr-description-tab`, so one change fixes both.

**Verify on beta.** R-HSA-109582 shows "blood coagulation (GO:0007596)" linked to QuickGO;
R-MMU-1640170 shows "cell cycle (GO:0007049)".

---

## 3a — Example dataset button names truncated · rank 1–2

**Root cause.** The labels are in the markup; CSS hides them. At laptop heights the
`@container (max-height: 600px)` rule (`qualitative-analysis.component.scss:176-186`)
switches the column to two, and `nowrap` + `ellipsis` cuts the names.

| Viewport  | Label area | Shown                   |
| --------- | ---------- | ----------------------- |
| 1920×1080 | full       | readable                |
| 1366×768  | 41px       | "UniP…", "Gen…", "KEG…" |
| 1280×720  | 33px       | worse                   |

**Decision.** Only go two-column when the column is also wide enough; let labels wrap;
give each button its full name as a tooltip.

**Rationale.** The trigger is a short _height_ squeezing the _width_ — a laptop, which is
what curators use.

**Related.** `species-analysis.component.scss:120-125` truncates species names the same
way; check and fix in the same pass.

**Verify on beta.** At 1366×768 and 1280×720 all nine example buttons show full names.

---

## 2g — "Computationally predicted event" missing · rank 2

**Root cause — wider than reported.** The "Inferences" section
(`description-tab.component.ts:670-674`) keys on `inferredTo`, a _physical-entity_
property. Events carry `orthologousEvent` instead (R-HSA-109582 has 14), so **no event
on the site — pathway or reaction — has ever shown its computationally predicted
orthologues.** The opposite direction, "Inferred From", already works (R-MMU-1640170).
Nothing in the overview says an event is inferred.

**Decision.** Both, since each is small:

1. An "Orthologous events" section keyed on `orthologousEvent`, grouped by species,
   linking each to its stable id — GWT called this "View computationally predicted
   event in".
2. An overview line on inferred events: "Computationally inferred", from `isInferred`
   and `evidenceType`.

**Rationale.** It is not certain which display the curator means; the GWT label points at
(1) and the spec's FR-013 at (2). Doing both covers either reading.

**Verify on beta.** R-HSA-109582 lists 14 species linking to R-MMU-109582 etc.;
R-MMU-1640170 shows "Computationally inferred" and keeps "Inferred From".

---

## 2d — Hierarchy hover does not highlight in the EHLD (#297) · rank 2

**Root cause.** Hierarchy hover is never emitted. `event-hierarchy.component.ts:523-530`
only sets a local `isHovered` for styling. `ehld.component.ts` has effects for selection
and flags, none for hover. The shadow mechanism itself works — hovering the region
directly applies it.

**Decision.** One shared hover signal, set by the hierarchy on mouse enter/leave and read
by the EHLD, reusing its existing shadow logic.

**Related.** The same signal serves 2e, and would serve Reacfoam hover and the reverse
direction (diagram hover → tree row), both of which reactome.org has. Those two are
raised, not built, unless they fall out of the same change cheaply.

**Verify on beta.** Hover "Cell Cycle Checkpoints" on R-HSA-1640170: its region glows;
the glow clears on mouse-out; a selected region keeps its outline.

---

## 2e — Hierarchy hover does not highlight subevents in the ELV · rank 3

**Root cause.** Same missing emission as 2d; `diagram.component.ts` has no hover effect.

**The decision inside it.** The curator says yellow; reactome.org used `#DFDF00`. This
site's light-mode hover colour is **green** (`--hover-node: #78e076`, `styles.scss:216`),
yellow only in dark mode. Either a dedicated highlight class in yellow, or change the
global hover colour. The former is narrower and does not repaint every mouse hover.

**Verify on beta.** Hover reaction R-HSA-549364 in R-HSA-1368108: its node and edges
highlight, clearing on mouse-out.

---

## 2a — Tour and layout controls · rank 3

**Correction.** The spec first called this a regression. It is not: the tour library
present in the codebase drives the _analysis form's_ guided tour; the pathway browser
never had tour or layout controls.

**What reactome.org offers.** "Tour" opens a video dialog; "Layout" is three toggles —
hierarchy panel, details panel, expand the centre view.

**Decision needed.** New top-bar UI, and that bar was partly EBI's design. Whether the
tour means the old video or a guided tour, and placement, are the user's call.

**Related.** The analysis form's guided tour is reachable only by a query parameter —
no button starts it.

**Decided (26 Sep).** Both, as reactome.org has them (read from `reactome/pwp-browser`):
Tour opens a "Pathway Browser Tour" dialog playing the same video (`rDXvQcBl3Y0`, embedded
privacy-enhanced); Layout toggles the hierarchy panel, the details panel, and "expand the
centre" (hides both if either shows, else restores both). Not kept across reloads, as
before.

---

## 3b — Quantitative results not shown; no email · rank 1 / 4 / 5

**Results not shown — beta-specific.** The GSA form sends `reactome_server: 'production'`
(`gsa-config.ts:12`), so ReactomeGSA writes the result into reactome.org's Analysis
Service. Beta asks its own, gets **410**, and `analysis.service.ts:460` silently discards
the token. One Camera run confirmed: token 200 on reactome.org, 410 on beta.

- **Rank 1, ours:** stop discarding a token silently — tell the reader the result could
  not be loaded.
- **Rank 4, decision:** point beta's GSA at a server beta can read; fall back to
  reactome.org for GSA tokens; or link out to the result on reactome.org.

**Email — not ours, rank 5.** This site has no mailer; ReactomeGSA sends it. Our side is
already hardened (#237, #242). **Owner: ReactomeGSA backend.**

---

## 2b — Overview node view · deferred

Fireworks was deliberately removed (`4d53f23`, closes #90) and replaced by Reacfoam.
Deferred to the end for the user's decision.

---

## 1a — Digital Preservation heading reads "UNTITLED" · rank 1

**Root cause.** `content/about/digital-preservation.mdx:2` has `title: Untitled`, and
`page.component.html:38` prints the title as the page heading. A **regression**: commit
`88aea40` ("fix: Documentation pages") changed it from "Digital Preservation Plan".

**Decision.** `title: Digital Preservation`, matching reactome.org and the navigation. The
curator's suggested sentence is already the page's first line, so it would print twice.

**Related.** The same page splits "repository" into two links —
`[GitHub](…) [r](…)epository` — fixed in the same edit.

**Verify on beta.** The heading reads "Digital Preservation"; no "Untitled" anywhere.

---

## 1b — Logo downloads open as pages; two sizes missing · rank 1

**Root cause — missing files.** The Medium and Large positive PNGs are committed as
`Reactome_Imagotype_Positive_50mm.png.png` and `…_100mm.png.png`, a doubled extension
since their first commit, so the links (`…_50mm.png`) find nothing. Confirmed: those two
return the app's HTML, not an image.

**Root cause — opening as pages.** None of the 16 anchors in
`logo-page.component.html` carries a `download` attribute. They are same-origin, so it
would work; reactome.org has one on every link.

**Decision.** `git mv` the two files to their correct names; add `download` to all 16
anchors. Delete `content/about/logo.mdx`, which the page's own route never renders and
whose 20 image links all point at files that do not exist.

**Alternative, raised not built.** reactome.org also offers EMF files. Adding them is a
scope question, not a fix.

**Related.** reactome.org's own isotype `download=` filenames are one size off (10mm saved
as `_25mm.png`) — deliberately **not** copied.

**Verify on beta.** Every option saves a file of the named size; Medium and Large both
download real PNGs. Checked by content type of the saved file, not by status.

---

## 1f — Computationally inferred events shows V95 · rank 1

**Root cause.** The release is baked into an image: `inferred-events.mdx:24` embeds a
static `inferred-events.png` titled "Reactome Version 95, Panther, December 2025".
reactome.org instead reads `download.reactome.org/{version}/stats/reaction_release_stats.png`,
which exists for 95, 96 and 97.

**Decision.** Point at the per-release chart using the `{release}` substitution the page
component already performs (`page.component.ts:59-83`). Delete the stale PNG.

**Related — found by sweeping for stale release numbers.** `curator-guide.mdx:8` ("The V95
Curator Guide") and `release-documentation.mdx:8` ("last updated V95") link V95 PDFs where
V97 ones are published. Updated to V97 **by hand**: `{release}` would break for any
release whose PDF is not yet published, which is the failure this item is.

**Verify on beta.** The chart title reads "Reactome Version 97, Panther, June 2026".

---

## 1c — Research Spotlight: duplicates, missing articles, no intro · rank 2

**Root cause — duplicates.** 82 files, 42 distinct articles. `blogpost-1.mdx`…`blogpost-40.mdx`
are leftovers from scraping the old listing page, each a copy of a numbered article with
the same title and date. `generate-index.ts` sorts but does not deduplicate. Commit
`88aea40` added the numbered files and left these in place.

**Root cause — missing.** reactome.org lists 44; this repository has 42. Missing:
`294-central-role-of-glycosylation-…-omicron-variants` (22 May 2026) and
`296-ten-common-mistakes-that-could-ruin-your-enrichment-analysis` (6 July 2026). The last
content pull (`4f2c9c8`, 22 May) predates both. Confirmed present on reactome.org.

**Root cause — no intro.** The subtitle is hard-coded as "Explore the latest research
spotlights from Reactome." (`article-page.component.ts:59`).

**Decision** (the user decided import from production).

1. Delete the 40 duplicates.
2. Import 294 and 296 **verbatim** from reactome.org, in the format of 290 and 292.
3. Use reactome.org's intro text, with its home-page link pointing at this site's `/`.
4. Make `generate-index.ts` **fail** on two entries sharing a title and date, so a future
   scrape cannot reintroduce this silently.

**Related.** The homepage spotlight tile reads the same index, so it is also stale — fixed
by the same change. The duplicates are in the site search index too.

**Verify on beta.** The intro shows; the first card is "Ten common mistakes…" (6 July
2026); 44 cards, each title once; the homepage spotlight shows the July article.

---

## 1e — V97 news "other news" links broken · rank 2 (one target rank 3)

**Root cause.** `295-v97-released.mdx`, pulled verbatim from reactome.org on 22 May, uses
reactome.org's old paths; it arrived two days after the sweep that fixed those paths
elsewhere, so it missed it.

| Link                       | Written as                  | Correct target                            |
| -------------------------- | --------------------------- | ----------------------------------------- |
| ReactomeFIViz              | `/userguide/reactome-fiviz` | `/documentation/userguide/reactome-fiviz` |
| ReactomeGSA                | `/gsa`                      | **decision** — no `/gsa` exists here      |
| redesigned Pathway Browser | `/beta/PathwayBrowser`      | `/PathwayBrowser`                         |
| User Guide                 | `/userguide`                | `/documentation/userguide`                |
| Developer's Zone           | `/dev`                      | `/documentation/dev`                      |
| website (not reported)     | `/what-is-reactome`         | `/about/what-is-reactome`                 |

**Related.** `291-v96-released.mdx` is broken identically.

**Decision — the standard answer.** Fix the links in both, **and** add redirects in the
app for the legacy paths that have a clear new home (`/userguide/**`, `/dev/**`,
`/what-is-reactome`, `/license`, `/icon-lib`, …). Moved URLs are conventionally
redirected rather than left to 404; it rescues every old bookmark and citation at once,
and it also repairs the legacy menu in 1g. The `/gsa` destination is the user's call.

**Verify on beta.** Each "other news" link opens a real page, and typing an old path such
as `/userguide` lands on its new home.

---

## 1g — Content/Analysis Service links open a page full of broken links · rank 3

**Root cause.** A full page load of `/ContentService/` or `/AnalysisService/` is proxied to
**Tomcat's legacy Swagger page** (`proxy.conf.js:88`, `routes.conf:113,122`), which carries a
copy of the old reactome.org header whose menu points at paths that do not exist here —
"Analyse gene expression" → `/gsa/home`. Confirmed: the page returns
"Reactome | Content Service API" with 21 references to `/templates/favourite/`. This
site's own API page (`SwaggerPageComponent`) works — 98 operations under the site header —
but only when reached **inside** the app, and the Tools links force a full page load
(`external: true`, `target="_blank"`).

**Decision.** Serve the app, not Tomcat, for the four exact paths `/ContentService`,
`/ContentService/`, `/AnalysisService`, `/AnalysisService/`; everything under them (data
endpoints, `v3/api-docs`) stays proxied. Drop `external`/`target="_blank"` so the links
stay in the app.

**Why rank 3.** It changes what `/ContentService/` returns for outside developers who have
it bookmarked — an improvement, but a change to a public URL, so it is the user's call.

**Verify on beta.** Typing `beta.reactome.org/ContentService` directly shows the site header
with the API docs, and no old reactome.org menu.

---

## 1d — User guide images from reactome.org · rank 5 (needs detail)

**Could not reproduce.** All 244 image, video and iframe sources across the user guide are
local, every file exists, and on beta all 11 user-guide pages load every `<img>` from
beta.reactome.org. No content or template anywhere puts a reactome.org URL in an image.
The only non-local images are two embedded Google Slides decks in the GSA guide.

**Decision.** Ask the curator which page and image. Possible explanations, none
confirmed: they viewed reactome.org/beta (a separate build), an older beta, or meant the
Slides embeds or links rather than images.

**Related — found by the sweep, and fixed regardless.** Three news items put a _web page_
URL in an image tag, so they show broken images: `286-new-publication-in-nar-2026.mdx:16`
(also a mangled host, `pubmed-ncbi-nlm-nih.gov`), `288-…-two-new-ai-focused-preprints.mdx:14`,
`273-coretrustseal-news.mdx:18`.

---

## Site-wide: broken internal links · rank 1–2

A static crawl of 2,098 links across all content, the navigation and app templates found
**73 broken internal links**, a sample of which was confirmed on beta by the "We can't
find that page" heading (not by status — the app answers 200 for missing pages). Beyond
1b and 1e:

| Target                                      | Count | Fix                                                      |
| ------------------------------------------- | ----- | -------------------------------------------------------- |
| `/community/training`                       | 13    | also 404 on reactome.org; point to `/community/outreach` |
| `/what-is-reactome`                         | 6     | `/about/what-is-reactome` (and a redirect)               |
| `/license`                                  | 3     | `/about/license`                                         |
| `/icon-lib`                                 | 3     | `/community/icon-lib`                                    |
| `/docs/training/*.pdf`                      | 5     | exist only on reactome.org — copy locally                |
| `/docs/devguide/…/reactome-interfaces.xmi`  | 1     | as above                                                 |
| `/content/contributors`                     | 1     | `/community/contributors`                                |
| `/gsa/home`                                 | 1     | same decision as 1e                                      |
| `…/diagram/js`, `…/pathways-overview/js`    | 2     | drop `/js`                                               |
| `…/dev/analysis.`, `…/dev/content-service.` | 2     | a full stop inside the link                              |
| `/user/guide/…`, `/user/reactome-fiviz`     | 3     | `/documentation/userguide/…`                             |
| `/reacfoam`                                 | 1     | needs a target                                           |

The legacy redirects in 1e fix many of these at the source; the content is corrected as
well, so no link depends on a redirect to work.

**Limits, stated rather than implied.** Links built from bound template values, `#anchor`
fragments and external links were not checked.
