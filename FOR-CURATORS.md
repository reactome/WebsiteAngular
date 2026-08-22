# For the curators

What to tell the curators, kept up to date as work happens rather than
reconstructed afterwards. Its companion is `RELEASE-TESTING.md`, which tracks
what is _tested_; this tracks what someone needs to be _told_ or _decide_.

Add to it in the same commit as the work it describes. Two rules keep it useful:
say what changed rather than what was done, and never quietly drop an item —
either it is answered, and moves to the bottom, or it is still open.

---

## 1. Waiting on the curators

Nothing here can be settled from the code.

**Eleven figures the database points at do not exist.** Ten are on no host we can
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

**Two interactor features the old browser has and this one does not.** Both are
decisions, not bugs:

- a confidence-threshold control for interactors (no threshold concept exists in
  our interactor services or URL state)
- an interactor download

**Which structure should a protein page show?** The viewer can show an
experimental PDB entry (from the entity's cross-references) or AlphaFold's
predicted model (from AlphaFold's own endpoint), and today it shows whichever has
resolved first — BCL2 has been seen with both `5JSN` and `AF-P10415-F1`. If an
experimental structure should always win when one exists, that is a small change;
we did not want to decide it for you.

**`/tag/release` was not ported.** It 404s with "some pages have not moved across
from the previous site yet". Worth keeping, or worth dropping?

---

## 2. Fixed since the last curator pass — worth re-testing

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
- **GIF and PowerPoint exports** come from our renderer too, at the diagram's own
  size — the previous GIF was unreadable when zoomed.
- **Icons** come from the release bucket rather than cross-origin from the dev
  machine, so the site no longer depends on that host to draw its own icons.
- **The V97 announcement** is on the site, imported verbatim. V96's text was
  corrected at the same time: it carried "Follow us on [email protected] get
  frequent updates", a sentence nobody wrote, from an earlier import.

### Where to look on beta

Each row is one thing to check and what a correct result looks like.

| Page                                                                                    | What to see                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [/content/detail/R-HSA-6805479](https://beta.reactome.org/content/detail/R-HSA-6805479) | Download links **inside** the Reaction Diagram section — `SBML BioPAX PDF` at the left, `SVG PNG▾ PPTX SBGN` at the right. Every arrow touches the reaction node. A downloaded SVG is the picture on the page |
| [/PathwayBrowser/R-HSA-109606](https://beta.reactome.org/PathwayBrowser/R-HSA-109606)   | Switch Species to _M. musculus_: the diagram redraws. It used to go blank                                                                                                                                     |
| [/idg?gene=TANC1](https://beta.reactome.org/idg?gene=TANC1)                             | Click any pathway in the results: it opens with the overlay applied — hit counts beside the pathways, and a Results tab titled "…of TANC1 interactors"                                                        |
| [/download-data](https://beta.reactome.org/download-data)                               | Badge reads **Current Release: V97**, and every link downloads a file rather than an error page                                                                                                               |
| [/about/statistics](https://beta.reactome.org/about/statistics)                         | The charts say **Version 97, Panther, June 2026**                                                                                                                                                             |
| [/about/news](https://beta.reactome.org/about/news)                                     | **V97 Released** at the top. Open it: the figure loads and `help@reactome.org` is a working link                                                                                                              |
| [/content/detail/R-HSA-446193](https://beta.reactome.org/content/detail/R-HSA-446193)   | The Glycobiology figure appears. Figures were broken everywhere on this site until 21 Aug                                                                                                                     |
| [/content/detail/R-HSA-109606](https://beta.reactome.org/content/detail/R-HSA-109606)   | The diagram thumbnail is in the new style — the same picture its download gives you                                                                                                                           |
| [/community/icon-lib](https://beta.reactome.org/community/icon-lib)                     | Icons all draw (they come from the release bucket now, not the dev machine)                                                                                                                                   |
| [PathwayBrowser → Tissue](https://beta.reactome.org/PathwayBrowser?analysisTab=tissue)  | Pick a tissue, move it across, Next: an overlay appears. This could not run at all before                                                                                                                     |

Not bugs, so as not to waste your time:

- **Ten or eleven figures are still missing** — the list is in section 1. They are
  broken on reactome.org too.
- **`/admin` returns 403.** Deliberate: the content editor is not exposed publicly.
- **`/tag/release` is a 404.** Not ported; a decision is in section 1.
- **The first GIF or PowerPoint download of a given diagram can take a while.**
  It is rendered on demand and then cached; the second is immediate.

---

## 3. Honest limits

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
- **Content**: `npm run build` stages content itself now. It used to only index
  it, so a build could list a new announcement and serve an empty page for it.
