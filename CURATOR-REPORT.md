# Curator report

Running list for the next round with the curators. What is in here: things we
need **them** to check, what has been **fixed** since their last pass and is
worth re-testing, decisions we have **made** that they should know about, things
we need them to **decide**, what is **waiting on someone else**, and the checks a
machine cannot make. Fixed-and-confirmed items get deleted rather than
accumulating — git history is the record of what was fixed.

**Found something?** Add it to the beta QA spreadsheet you have been using, or
open an issue on the WebsiteAngular repository — either reaches us. A screenshot
and the URL is usually enough; if a diagram is involved, the pathway's stable id
saves us guessing.

Last updated: 2026-08-22

## Please check on beta.reactome.org

> Note the URL. `beta.reactome.org` is the new site. `reactome.org/beta` is an
> older build sitting on the production machine and is **not** updated by our
> work — a fix will never appear there.

| #                                                             | What to check                                                                                                                                                                                        | Why we are asking                                                                                                                                                                                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#150](https://github.com/reactome/WebsiteAngular/issues/150) | Flag something, then confirm trivial molecules (H₂O, ATP…) stay visible at every zoom, and that their chemical structures never appear without the molecule underneath                               | Two real defects were fixed, but the original reports say "sometimes, but not always", and we could not make the failure happen on demand. We need someone who has seen it to confirm                                                                         |
| [#143](https://github.com/reactome/WebsiteAngular/issues/143) | Same as above, specifically while navigating between pathways with a flag active                                                                                                                     | As above                                                                                                                                                                                                                                                      |
| [#154](https://github.com/reactome/WebsiteAngular/issues/154) | Right-click a complex or set after running an analysis: components are listed and the ones in your data are marked                                                                                   | Closed on the basis that the right-click panel delivers this. **Reopen if "within a diagram" meant drawing components as nodes inside the canvas** — that is a much larger piece, and the old GWT browser does not do it either                               |
| [#81](https://github.com/reactome/WebsiteAngular/issues/81)   | Community → Events: confirm every attachment you expect is present                                                                                                                                   | All 5 "Poster" links on the page resolve, but if a specific event is missing an attachment we have not spotted it                                                                                                                                             |
| **PowerPoint**                                                | Download a diagram as **PPTX** and open it in real PowerPoint. Every compartment, connector, entity and sub-pathway tint should be its own shape you can select and move, with no conversion step    | **We cannot test the opening — there is no PowerPoint on the build machine.** The package is checked structurally, its element order matches production's own file, and 635 shapes come out of R-HSA-109606; "opens in PowerPoint" is still a different claim |
| **GIF**                                                       | Download a diagram as **GIF** with an expression analysis active. It should animate one frame per sample and look like the current site                                                              | New: it used to come from the old Java exporter, which is why it looked like the old diagrams. Also tell us whether ~1 MB for four samples is acceptable, and whether 1 second per sample is the right pace                                                   |
| [#141](https://github.com/reactome/WebsiteAngular/issues/141) | **Animated SVG**: open the downloaded file in a browser or Inkscape, then click the play/pause button, click any segment of the timeline to jump to that sample, and hover a segment to see its name | New controls. They need the file **opened as a document** — inside an `<img>`, or in a viewer that blocks scripts, the buttons are inert by design and hovering the button still pauses                                                                       |
| [#140](https://github.com/reactome/WebsiteAngular/issues/140) | Flag a gene in the **genome-wide view**, with and without an analysis running                                                                                                                        | Flagging is now an outline instead of a fill, so the analysis colours survive underneath. Previously a flagged pathway lost its result colour, and without an analysis everything else was washed out                                                         |
| **Illustration downloads**                                    | Download an illustrated pathway (Apoptosis, say) as **PNG** or **JPEG**                                                                                                                              | It was scaled twice and you got the **top-left ninth** of the illustration blown up to fill the file. Fixed, but worth one look                                                                                                                               |
| [#137](https://github.com/reactome/WebsiteAngular/issues/137) | Selecting things: in the event hierarchy, the analysis results table, and the search results. The selection should come into view without the panel jumping to the top                               | One shared implementation now. Nothing should move at all when the selected thing is already visible                                                                                                                                                          |

## Fixed since 20 August — worth re-testing

Each of these was broken when curators last looked, and each is now covered by a
test — `RELEASE-TESTING.md` names the spec for every row, and says plainly where
a check can only be made by eye.

- **Diagrams for every species other than human were blank.** One node without
  graph data threw for the whole diagram build, so switching species left an
  empty canvas with the rest of the page updated around it.
- **Every figure on entity pages was broken.** Our origin answers `/figures/*`
  with the application's own HTML, so each figure was a 200 that was not an
  image. Figures are published to the download bucket now and render.
- **33 of the 74 links on the download page were broken.** Wrong file names
  (`IUPHAR*` for what is published as `GtoP*`, `.tsv` for `.txt`, a missing
  `interactors/` directory) and two whole sections built from a bucket prefix
  that has never existed. All 74 resolve.
- **The download page and homepage advertised the previous release.** The version
  was read once before the content service answered, then kept. Both follow the
  database now, and there is no build-time release number left to go stale.
- **About → Statistics showed release 95's figures.** The number was typed into
  the page's markdown. The content asks for the current release now, so this will
  not need editing again.
- **Tissue Enrichment Analysis could not run.** It asked a hardcoded
  `127.0.0.1` for its sample data. Species comparison, gene-list and
  quantitative (GSA) analyses were checked at the same time and all work.
- **IDG: clicking a pathway showed no overlay.** Only the "overlay on the
  genome-wide view" button created an analysis, so every other link arrived
  without one. All five link kinds now carry the interactor analysis.
- **Reaction page downloads** have moved into the reaction diagram section, in the
  arrangement the current site uses, and now offer the full set (SBML, BioPAX,
  PDF, SVG, PNG at three sizes, PPTX, SBGN). The pictures come from our
  own renderer, so a download is the diagram the page shows.
- **A pathway page's figure** is drawn by the same renderer as its downloads. It
  came from the old server-side exporter, so the picture on the page was in the
  previous site's style while the download beside it was in the new one.
- **BioPAX** is a single link now, Level 3. Level 2 has been superseded for years,
  and offering both put a menu in front of the one people want.
- **The frame around the reaction diagram** no longer has its right border cut
  off, and **the statistics charts** display in full instead of scrolling inside
  their own box.
- **Release calendar cards no longer pretend to be clickable.** They lifted under
  the pointer and did nothing, which is what was reported. The 40 releases that
  have an announcement on this site are now links to it — v57 onwards, near
  continuously — and the other 57, plus anything upcoming, carry no hover
  response at all. A small document icon marks the ones that open something.
- **Icons** come from the release bucket rather than cross-origin from the dev
  machine, so the site no longer depends on that host to draw its own icons.
- **The V97 announcement** is on the site, imported verbatim. V96's text was
  corrected at the same time: it carried "Follow us on [email protected] get
  frequent updates", a sentence nobody wrote, from an earlier import.

### Where to look on beta

Each row is one thing to check and what a correct result looks like.

| Page                                                                                    | What to see                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [/content/detail/R-HSA-6805479](https://beta.reactome.org/content/detail/R-HSA-6805479) | Download links **inside** the Reaction Diagram section — `SBML BioPAX PDF` at the left, `SVG PNG▾ PPTX SBGN` at the right. Every arrow touches the reaction node, and the frame around the diagram is unbroken on all four sides. BioPAX is one link (Level 3), not a menu. A downloaded SVG is the picture on the page |
| [/PathwayBrowser/R-HSA-109606](https://beta.reactome.org/PathwayBrowser/R-HSA-109606)   | Switch Species to _M. musculus_: the diagram redraws. It used to go blank                                                                                                                                                                                                                                               |
| [/idg?gene=TANC1](https://beta.reactome.org/idg?gene=TANC1)                             | Click any pathway in the results: it opens with the overlay applied — hit counts beside the pathways, and a Results tab titled "…of TANC1 interactors"                                                                                                                                                                  |
| [/download-data](https://beta.reactome.org/download-data)                               | Badge reads **Current Release: V97**, and every link downloads a file rather than an error page                                                                                                                                                                                                                         |
| [/about/statistics](https://beta.reactome.org/about/statistics)                         | The charts say **Version 97, Panther, June 2026**                                                                                                                                                                                                                                                                       |
| [/about/news](https://beta.reactome.org/about/news)                                     | **V97 Released** at the top. Open it: the figure loads and `help@reactome.org` is a working link                                                                                                                                                                                                                        |
| [/content/detail/R-HSA-446193](https://beta.reactome.org/content/detail/R-HSA-446193)   | The Glycobiology figure appears. Figures were broken everywhere on this site until 21 Aug                                                                                                                                                                                                                               |
| [/content/detail/R-HSA-109606](https://beta.reactome.org/content/detail/R-HSA-109606)   | The diagram thumbnail is in the new style — the same picture its download gives you                                                                                                                                                                                                                                     |
| [/about/release-calendar](https://beta.reactome.org/about/release-calendar)             | Cards for v57 and later open that release's announcement; older ones and upcoming ones do not move under the pointer                                                                                                                                                                                                    |
| [/community/icon-lib](https://beta.reactome.org/community/icon-lib)                     | Icons all draw (they come from the release bucket now, not the dev machine)                                                                                                                                                                                                                                             |
| [PathwayBrowser → Tissue](https://beta.reactome.org/PathwayBrowser?analysisTab=tissue)  | Pick a tissue, move it across, Next: an overlay appears. This could not run at all before                                                                                                                                                                                                                               |

Not bugs, so as not to waste your time:

- **Ten or eleven figures are still missing** — the list is in section 1. They are
  broken on reactome.org too.
- **`/admin` returns 403.** Deliberate: the content editor is not exposed publicly.
- **`/tag/release` 404s, and that is not a missing page.** Production's version is
  a tag listing of the 21 release announcements; `/about/news` here lists all 39.
  Only the old URL is gone, and a redirect would cover that if anything links to
  it.
- **The first GIF or PowerPoint download of a given diagram can take a while.**
  It is rendered on demand and then cached; the second is immediate.

## Decisions they should know about

- **PowerPoint files are built out of shapes**, one per compartment, connector,
  entity and sub-pathway tint, editable the moment the file opens. They carried
  the diagram as a single vector image until now, on the argument that one click
  to convert it was worth not writing a second renderer. It was reported as "the
  whole pathway diagram is treated as a single item", so the renderer is written.
  The site's page still decides every position, colour, opacity, dash and font,
  and hands them over as data — so this is a spelling of the diagram, not a
  second opinion about it, which is what drifted before.
  Two things it does not carry yet: the small decorations the style draws with
  background images, so a complex loses the band that marks it as one; and edges
  with weights keep their points but not their rounded corners. **Say if either
  matters** and they go in next.
- **The slide is the size of the diagram**, as production's is — 56 by 32 inches
  for Apoptosis, with labels at 5 to 53pt. Fitting the diagram onto an ordinary
  13.3in slide instead put every label at 1.65pt.
- **GIF and PPTX now come from our own renderer**, so what you download is what the
  site draws. For **illustrated** pathways they still come from the content
  service, deliberately: it serves the same illustration file either way.
- **GIF renders at the diagram's own size** (around 6000px wide) rather than being
  fitted to 2000px. Fitting it made 8pt labels unreadable. It stays around 1 MB
  because only what changes between samples is stored.
- **Exported figures are always light.** The diagram has a full dark theme and the
  renderer can use it, but it is not offered in the download panel: the dark
  palette is designed for the screen, and as a standalone figure it reads as muddy.
  Say the word if anyone actually wants dark figures.
- **The download panel has one checkbox for sub-pathway highlighting**, which
  applies to every format including the server-rendered ones. Off leaves the tints
  and labels out of the figure.
- **If GIF or PPTX fails**, it is probably the render service rather than the
  diagram: those two are produced by a service running alongside the site. Report
  it as "GIF download failed" and we will look at the service, not the diagram.

- **DisGeNET is not being ported** ([#92](https://github.com/reactome/WebsiteAngular/issues/92)). Team
  decision, 2026-08-19: the overlay page is gone, and old links land on a
  not-found page offering the same path on reactome.org so nobody hits a dead
  end. As of 2026-08-22 the **DisGeNet button in the interactor overlay list is
  gone too** — its service returns 404 on dev and on production (DisGeNET moved
  to a commercial licence), so the button could only ever fail. The service-side
  plumbing is still in the code if this is ever revisited.
- **Right-click menu, molecules download, analysis error handling, hierarchy scrolling, compare mode** — all previously reported and now fixed. Worth a spot-check but we are not blocking on it.
- **The minimap is interactive again.** It was removed deliberately to save time; two people reported it, so pressing or dragging it now pans the diagram.

## Waiting on someone else

- **The render service runs in a container now** (`restart: unless-stopped`), so a
  reboot no longer stops GIF and PPTX. Still outstanding before this fronts
  reactome.org: rate limiting in front of it.
- **Cloudflare cache purge** — one-off, for figures cached before 2026-08-20.
  Nothing new is cached now.
- **[#139](https://github.com/reactome/WebsiteAngular/issues/139) native cytoscape
  shapes** needs the cytoscape team; it is their catalogue we would be adding to.
- **[#153](https://github.com/reactome/WebsiteAngular/issues/153) skipping the
  diagram.json conversion** touches the shared diagram library, so it needs
  beaversd and guanmingwu before anyone starts.

- **ORCID "Claim Your Work" ([#114](https://github.com/reactome/WebsiteAngular/issues/114))** — blocked on a backend deploy, not on frontend work. The person-page endpoints return real data, but `/ContentService/orcid/authenticated`, `/orcid/login` and `/orcid/claim/*` all 404: the `org.reactome.server.orcid.*` package is not in the deployed WAR. Needs that build deployed plus ORCID credentials in `service.properties`. Deferred by agreement, 2026-08-19.

## Also waiting on you

**Ten figures the database points at do not exist, and an eleventh is misnamed.** Ten are on no host we can
reach; the eleventh is a naming mismatch. They render as broken images on
reactome.org today, so this is not new with the redesign.

| Figure dbId | File the database asks for                      |
| ----------- | ----------------------------------------------- |
| 387434      | `/figures/Dunn2005-ProinsulinZnCaComplex.jpg`   |
| 387452      | `/figures/Kaufman2002-ATF6.jpg`                 |
| 387454      | `/figures/Kaufman2002-IRE1.jpg`                 |
| 387457      | `/figures/Kaufman2002-PERK.jpg`                 |
| 387436      | `/figures/Rutter2006-KinesinVesicleComplex.jpg` |
| 111218      | `/figures/linoleoylcoa.jpg`                     |
| 396956      | `/figures/striatedmuscle1.jpg`                  |
| 396954      | `/figures/striatedmuscle2.jpg`                  |
| 396953      | `/figures/striatedmuscle3.jpg`                  |
| 396952      | `/figures/striatedmuscle4.jpg`                  |
| 1028823     | `/figures/man7a.png`                            |

Two questions:

- **The five named after papers** (Dunn2005, Kaufman2002 ×3, Rutter2006) look like
  figures reproduced from publications. If they were withdrawn for licensing, the
  fix is to clear the Figure reference rather than restore the file — otherwise
  every release keeps pointing at an image that cannot be republished.
- **`man7a.png` is almost certainly a typo.** The file on disk is `man7aa.png`
  (one extra "a", dated 2018, referenced by nothing), and the rest of that series
  — `man8a`, `man8b`, `man8c` — is present and referenced. Rename the file, or
  correct the reference: either fixes it.

The other six were searched for across the whole dev host, following symlinks,
and are not on it. An old external drive is the remaining hope.

**Which structure should a protein page show?** The viewer can show an
experimental PDB entry (from the entity's cross-references) or AlphaFold's
predicted model (from AlphaFold's own endpoint), and today it shows whichever has
resolved first — BCL2 has been seen with both `5JSN` and `AF-P10415-F1`. If an
experimental structure should always win when one exists, that is a small change;
we did not want to decide it for you.

## In the old browser, not in this one

Found while turning the release checklist into tests. Neither is a regression from
a working state here -- they were never built -- but the old browser has both, so
curators will look for them:

- **No confidence threshold for interactors.** The old browser has a sliding scale
  where raising the confidence score shows fewer interactors; there is no such
  control here, and no threshold concept in the interactor services or the URL
  state. The overlay is all-or-nothing per resource.
- **No interactor download.** The old browser offers one beside that slider.

Both are small next to what they enable, and neither is on the critical path for
the release. Say if they matter to you and they go on the list.

## Known and deliberately not fixed

- [#136](https://github.com/reactome/WebsiteAngular/issues/136) node spacing / text size — already labelled `wontfix` upstream of us.

## Honest limits: what a machine cannot judge

Seven checklist items cannot be automated and still need a person each release —
the list and the reasoning are in `RELEASE-TESTING.md`. The ones curators will
notice:

- **PPTX has to be opened in PowerPoint.** Nothing here can prove a file converts
  to editable shapes; the test only proves it is a presentation.
- **Sub-pathway hover, and the animated SVG timeline.** Both are canvas
  behaviours with nothing to assert but pixels, and a screenshot comparison there
  fails on font rendering rather than on behaviour.
- **"Check that a pathway added in this release renders."** Which pathways are new
  changes every release, so no test can name them in advance. For now someone
  picks one from the release announcement — which is also how we could automate
  it, since that announcement lists the new and updated pathways as links.

---

## Process notes for whoever runs a release

- **Announcements**: `npm run import:news -- --missing` brings over anything
  published on the current site, verbatim, and refuses to write a file whose text
  does not match the source word for word. It does not write prose.
- **Figures**: `~/publish-figures.sh add` on the dev host publishes new figures to
  the bucket. Needs sudo; the credentials belong to `s3bot`.
- **Verifying a release**: `E2E_BASE_URL=https://beta.reactome.org npm run e2e:release`
  runs the checks that only a finished release can answer — every top-level pathway
  draws, every download link resolves, the version and news and statistics match
  what is being served. It also runs nightly against beta, so a data problem is
  usually found by a machine before anyone reads this document.
- **Content**: `npm run build` stages content itself now. It used to only index
  it, so a build could list a new announcement and serve an empty page for it.
