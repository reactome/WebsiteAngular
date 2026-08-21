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
| 396952–56   | `/figures/striatedmuscle1–4.jpg`                |
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

The other six may be recoverable from an old backup. Awright is checking an
external drive.

**Two interactor features the old browser has and this one does not.** Both are
decisions, not bugs:

- a confidence-threshold control for interactors (no threshold concept exists in
  our interactor services or URL state)
- an interactor download

**`/tag/release` was not ported.** It 404s with "some pages have not moved across
from the previous site yet". Worth keeping, or worth dropping?

---

## 2. Fixed since the last curator pass — worth re-testing

Each of these was broken when curators last looked, and each is now covered by a
test named in `RELEASE-TESTING.md`.

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
  arrangement the current site uses, and now offer the full set (SBML, BioPAX L2
  and L3, PDF, SVG, PNG at three sizes, PPTX, SBGN). The pictures come from our
  own renderer, so a download is the diagram the page shows.
- **A pathway page's figure** is drawn by the same renderer as its downloads. It
  came from the old server-side exporter, so the picture on the page was in the
  previous site's style while the download beside it was in the new one.
- **GIF and PowerPoint exports** come from our renderer too, at the diagram's own
  size — the previous GIF was unreadable when zoomed.
- **Icons** come from the release bucket rather than cross-origin from the dev
  machine, so the site no longer depends on that host to draw its own icons.
- **The V97 announcement** is on the site, imported verbatim. V96's text was
  corrected at the same time: it carried "Follow us on [email protected] get
  frequent updates", a sentence nobody wrote, from an earlier import.

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
- **"A newly added pathway renders"** changes every release and comes from the
  project calendar, not from the code.

---

## Process notes for whoever runs a release

- **Announcements**: `npm run import:news -- --missing` brings over anything
  published on the current site, verbatim, and refuses to write a file whose text
  does not match the source word for word. It does not write prose.
- **Figures**: `~/publish-figures.sh add` on the dev host publishes new figures to
  the bucket. Needs sudo; the credentials belong to `s3bot`.
- **Content**: `npm run build` stages content itself now. It used to only index
  it, so a build could list a new announcement and serve an empty page for it.
