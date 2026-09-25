# Feature Specification: Curator email review, 25 September

**Feature Branch**: `008-curator-email-fixes`

**Created**: 2026-09-25

**Status**: Draft

**Input**: A curator's emailed review of beta.reactome.org listing 17 problems across
the content pages, the pathway browser and the analysis tools. Every item is to be
fixed and verified on beta by its visible outcome, related instances found and fixed
site-wide, and any item whose fix makes a new part of the site usable fixed fully.

## Why this spec exists

These are the last problems a curator found before the site goes back to them. Each
one is small; together they decide whether the curators trust beta enough to test
the rest of it. Several have been "fixed" before and resurfaced — one of them (the
analysis summary outliving its analysis) was fixed in this repository a week ago and
is still reported. So "done" here means **observed working on beta by the thing a
curator would see**, not a passing test or a merged pull request.

## User Scenarios & Testing _(mandatory)_

### User Story 1 — An analysis result can be trusted (Priority: P1)

A curator runs an analysis and reads the result, including a generated summary. What
they read must describe the analysis on screen and nothing else, and every analysis
type they can start must show its result.

**Why this priority**: The other items make the site harder to use. These make it
**wrong** — a summary written about one analysis shown above another's results, and
quantitative analyses that run but never show a result. A curator cannot tell a
wrong answer from a right one, which is the failure that ends trust in the tool.

**Independent Test**: Run analysis A and summarise it; run analysis B; confirm no
text from A's summary is visible. Run each quantitative method on its example
dataset and confirm results appear on the site.

**Acceptance Scenarios**:

1. **Given** a summary of analysis A is displayed, **When** the curator runs analysis
   B, **Then** none of A's summary is visible above or beside B's results.
2. **Given** a summary is displayed, **When** the curator chooses to close it, **Then**
   it disappears and the results remain.
3. **Given** a closed summary, **When** the curator asks for it again on the same
   analysis, **Then** it reappears without starting a new request if it was already
   produced.
4. **Given** the Camera or ssGSEA method with the MelanomaRNA-seq example, or PADOG
   with the Ribo and RNA-seq dataset, **When** the analysis completes, **Then** its
   results are displayed on the site, not only in the downloadable reports.
5. **Given** the qualitative enrichment form, **When** the curator looks at the
   example dataset buttons, **Then** each button's name is readable without hovering.

---

### User Story 2 — Every link and download does what it says (Priority: P1)

A curator following a link or clicking a download reaches the thing named, and a
"download" saves a file.

**Why this priority**: A broken link is the most common thing a curator reports and
the easiest to find with a crawl, so leaving any is a sign nobody looked. The
Content and Analysis Service pages matter most: they are what developers use.

**Independent Test**: Every link on the listed pages resolves to its intended
destination; every download control saves a file with the expected type.

**Acceptance Scenarios**:

1. **Given** About → Our Logo, **When** the curator uses any download option, **Then**
   a file is saved rather than an image opened in a page.
2. **Given** About → Our Logo, **When** the curator requests any listed size and
   format, **Then** that file exists and is the size and format named.
3. **Given** About → News → V97 released, **When** the curator follows each link under
   "other news", **Then** each reaches its intended page.
4. **Given** Tools or Download, **When** the curator opens the Content Service or
   Analysis Service page, **Then** its links reach their intended pages.
5. **Given** any page on the site, **When** a link points within the site, **Then** it
   does not lead to a page that does not exist.

---

### User Story 3 — The pathway browser shows what reactome.org shows (Priority: P2)

A curator viewing a pathway finds the same information and controls they rely on in
the current site.

**Why this priority**: Missing information in the Details panel means a curator
checks the live site to finish a task, which is the dependency beta exists to end.

**Independent Test**: For a pathway that has them, the Details panel shows its GO
biological process and whether it is computationally predicted; hovering in the
hierarchy highlights in the diagram; the named illustrated diagram loads.

**Acceptance Scenarios**:

1. **Given** a pathway with a GO biological process, **When** its Details panel is
   open, **Then** the GO term is shown.
2. **Given** a computationally inferred pathway, **When** its Details panel is open,
   **Then** it is identified as computationally predicted.
3. **Given** the "Circadian clock" pathway, **When** its illustrated diagram opens,
   **Then** it loads completely and correctly.
4. **Given** a top-level pathway with an illustrated diagram, **When** the curator
   hovers a subpathway in the hierarchy, **Then** the matching region of the diagram
   is highlighted.
5. **Given** a pathway diagram (ELV), **When** the curator hovers a subevent in the
   hierarchy, **Then** it is highlighted in the diagram.
6. **Given** the pathway browser menu bar, **When** the curator looks for the tour and
   layout controls, **Then** both are present and work.

---

### User Story 4 — Content is current and belongs to this site (Priority: P2)

A curator reading documentation and news pages finds current information, served by
this site, with no placeholder text.

**Why this priority**: Stale versions and placeholder headings make the site look
unfinished, and images hotlinked from reactome.org will break when reactome.org is
this site.

**Independent Test**: Each named page shows the current release where it states one,
has a proper heading, loads its images from this site, and the spotlight list is
complete, current and free of duplicates.

**Acceptance Scenarios**:

1. **Given** About → Digital Preservation, **When** the page opens, **Then** its heading
   is meaningful and no placeholder text appears.
2. **Given** Content → Research Spotlight, **When** the page opens, **Then** it lists
   every spotlight article published, the most recent first, each exactly once, with
   a short explanation of what a spotlight article is.
3. **Given** Docs → User guide, **When** the page loads, **Then** every image is served
   by this site.
4. **Given** Docs → Computationally inferred events, **When** the page opens, **Then**
   any release it names is the current release.

---

### User Story 5 — The pathway overview offers a node view (Priority: P3)

A curator opening the genome-wide overview can see pathways as graphical nodes, as
on reactome.org, rather than only as the Voronoi view.

**Why this priority**: This is a design change rather than a defect — the node view
(Fireworks) was deliberately replaced by the Voronoi view (Reacfoam) — so it is
listed last and gated on a decision.

**Independent Test**: [NEEDS CLARIFICATION: whether a node view should be restored,
offered alongside, or the Voronoi view kept — see Assumptions]

**Acceptance Scenarios**:

1. **Given** the genome-wide overview, **When** the curator opens it, **Then** the
   behaviour matches the decision recorded for this story.

---

### Edge Cases

- A summary requested for analysis A that is still streaming when analysis B starts
  must not finish into B's view.
- A logo requested in a size or format that genuinely does not exist must not be
  offered.
- A link to an external site that is itself down is not a broken link on this site,
  and must not be "fixed" by removing it without saying so.
- A pathway with no GO biological process, or not computationally inferred, must not
  show an empty field or a false claim.
- A quantitative analysis whose results legitimately fail must say so rather than
  showing nothing.
- A report that fails to email is a failure of delivery, and must be classified as
  such rather than reported fixed on the strength of the reports being generated.

## Requirements _(mandatory)_

### Functional Requirements

**Analysis (Story 1)**

- **FR-001**: A generated summary MUST be visible only alongside the analysis it was
  written about.
- **FR-002**: Starting a new analysis MUST remove any summary of a previous one,
  including one still being generated.
- **FR-003**: A displayed summary MUST be closable, leaving the results in place.
- **FR-004**: Quantitative analyses (Camera, ssGSEA, PADOG) MUST display their results
  on the site when they complete.
- **FR-005**: Emailing of analysis reports MUST either work, or be recorded as outside
  this site with the owning system named.
- **FR-006**: Example dataset buttons MUST show their names without hovering.

**Links and downloads (Story 2)**

- **FR-007**: Every logo download option MUST save a file of the named size and format.
- **FR-008**: Every logo size and format offered MUST exist.
- **FR-009**: Every link under "other news" on the V97 release page MUST reach its
  intended destination.
- **FR-010**: Links on the Content Service and Analysis Service pages MUST reach their
  intended destinations.
- **FR-011**: No internal link anywhere on the site MUST lead to a page that does not
  exist; internal links found broken beyond the reported pages are fixed too.

**Pathway browser (Story 3)**

- **FR-012**: The Details panel MUST show a pathway's GO biological process when it has
  one.
- **FR-013**: The Details panel MUST identify computationally predicted pathways.
- **FR-014**: The "Circadian clock" illustrated diagram MUST load completely.
- **FR-015**: Hovering a subpathway in the hierarchy MUST highlight it in an illustrated
  diagram.
- **FR-016**: Hovering a subevent in the hierarchy MUST highlight it in a pathway
  diagram.
- **FR-017**: The menu bar MUST offer the tour and layout controls, each working.

**Content (Story 4)**

- **FR-018**: The Digital Preservation page MUST have a meaningful heading and no
  placeholder text; no other page may carry placeholder text as its heading.
- **FR-019**: The Research Spotlight list MUST contain every published spotlight,
  newest first, each exactly once, and explain what a spotlight article is.
- **FR-020**: User guide images MUST be served by this site.
- **FR-021**: Any release number stated on the Computationally inferred events page
  MUST be the current release; other pages stating a release are checked too.

**Overview (Story 5)**

- **FR-022**: The genome-wide overview MUST behave as decided for Story 5.

**Across all stories**

- **FR-023**: Each item MUST end as fixed and verified on beta, or classified as outside
  this site with the reason and the owner named.
- **FR-024**: Every change MUST be recorded in the review tracker with its evidence, so
  a reply to the curator can be written from it.

### Key Entities

- **Curator item**: one reported problem — its identifier (1a–3c), the curator's words,
  its status, what was done and the evidence it is fixed.
- **Related finding**: an instance of the same problem found elsewhere on the site,
  linked to the item that led to it.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: All 17 reported items reach a final status — fixed and verified on beta,
  or classified outside this site with an owner — with none left open.
- **SC-002**: Zero summaries from a previous analysis are visible after starting a new
  one, across 5 consecutive analyses.
- **SC-003**: All three quantitative methods display results for their example
  datasets.
- **SC-004**: Zero internal links on the site lead to a missing page.
- **SC-005**: Every logo download option saves a file, 100% of the time.
- **SC-006**: Every item marked fixed is shown by evidence a curator could reproduce by
  following the same steps, not by a passing check alone.
- **SC-007**: A curator reading the reply can tell, for every item, what changed and
  where to look.

## Assumptions

- **Tour and layout controls** (corrected during research): these were **never
  ported**, not lost. An earlier draft of this spec called the missing tour button a
  regression because a tour library is present in the codebase; that library drives
  the _analysis form's_ guided tour, and the pathway browser only references it because
  it hosts that form. On reactome.org the tour is a button opening a video, and
  "Layout" is three toggles (hierarchy panel, details panel, expand the centre view).
  Adding them is new UI in the top bar, which was partly decided at EBI, so it is
  treated as needing a decision rather than restored by default.
- **Overview (Story 5)**: the node view was deliberately removed and replaced; this
  spec does not restore it without a decision. Every other story proceeds regardless.
- **Emailed reports**: delivery is performed by the ReactomeGSA service rather than this
  site. If investigation confirms that, it is classified outside this site with that
  owner named, as reports emailing was already recorded as backend in the previous
  curator round.
- **Research Spotlight** (decided 2026-09-25): spotlights published on reactome.org that
  this repository lacks are **pulled in from production**, not rewritten. The
  explanation text is taken from reactome.org as well.
- **Digital Preservation heading**: "Digital Preservation", matching reactome.org and the
  site's own navigation. The curator's suggested sentence is already the page's first
  line, so using it as the heading as well would print it twice.
- **Hover highlight (Story 3, scenario 4)** is already tracked as #297 and is completed
  under this spec.
- **The repository is public.** The curator's email, names and internal process do not
  go into it; the tracker lives outside the repository.
