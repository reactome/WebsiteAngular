# Feature Specification: UI and UX improvements, one obvious problem at a time

**Feature Branch**: `spec/023-ui-ux-improvements`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "Improve the website's UI and UX, one obvious
problem at a time, following established usability conventions. The colour
scheme is settled (from the Pathway Browser's illustrator work) and is not in
scope. Scope: the Pathway Browser's header, the community Icon Library page's
search and detail flow, and the home page. Principles that decide each change:
follow conventions readers already know (the way home is the logo at the top
left); only what is clickable looks clickable (no underline on plain text, no
chip-shaped labels); a field looks like a field whether empty or full; no dead
ends (every page offers an obvious next step); the interface remembers state
for the reader (Back returns to the same search, filters and page); filters
narrow together instead of clearing each other; accessibility at WCAG 2.1 AA
(contrast 4.5:1 for small text, accessible names on icon-only controls); each
change checked in light and dark, at laptop and narrow widths, and seen on beta
before merge. Already done in PR #899: former-browser link, beta badge and beta
feedback removed from the Pathway Browser header; logo moved to the top left as
the home link (over the search row while the hierarchy panel is open, first in
the top bar while it is closed); the search made a visible field; the release
number moved to the top right as a non-link label. Icon Library problems seen:
on an icon's detail page the reader does not know what to do next (only a Back
button, while the search bar is still shown but does nothing there); Back loses
the search, category and page; typing a search clears the selected category and
choosing a category clears the search; a Search button is shown though results
already update as you type; the category chips disappear in the detail view.
Two directions for it: smaller fixes (state in the URL, search usable from the
detail page, filters combined, clickable categories and related icons on the
detail page) or a redesign where the grid stays visible and an icon's details
open in a side panel; which one is not yet decided. Home page: improvements to
be defined from what visitors come to do (search, browse pathways, analyse
data); not yet designed." Added later the same day: the molecule tab's
pagination, which sits under the Proteins count and reads as if it were for
every group.

(The input's "the search bar ... does nothing there" proved wrong when the code
was read: see User Story 3.)

## How this work is done

Each problem is fixed on its own, in its own pull request, and seen working on
beta before it is merged. A problem gets fixed when it breaks one of the
principles below; a change that breaks none of them is a change of taste and
is out of scope. The colour scheme is settled and is not changed here.
`RELEASE-TESTING.md` and `CURATOR-REPORT.md` are kept current as each change
lands, as the constitution asks.

**The principles**, each a convention readers already carry from other sites:

1. **Conventions first.** Where readers expect something (the way home is the
   logo at the top left), it is there.
2. **Only what is clickable looks clickable.** No underline, chip or button
   shape on something that does nothing; a control that does something looks
   like one.
3. **A field looks like a field**, empty or full.
4. **No dead ends.** Every page offers an obvious next step.
5. **The interface remembers for the reader.** Back returns to the same
   search, filters and page; a shared address opens the same view.
6. **Filters narrow together.** Choosing one does not silently clear another.
7. **Accessible to WCAG 2.1 AA**: small text at 4.5:1 contrast or better;
   every control that is only an icon has a name a screen reader can say; and
   nothing is available only on hover.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Get home, and read the header honestly, in the Pathway Browser (Priority: P1) — delivered in #899

A reader deep in a pathway wants the main site. They look top left, find the
Reactome logo there, and it takes them home. The header offers nothing that
belongs to the old browser or the beta period, its search looks like a search
box whether or not it holds a term, and the release number reads as
information rather than as a link.

**Why this priority**: Readers reported that they could not find their way
home: the logo was at the right end of the bar, where few look for it. Every
visit to the Pathway Browser passes through this header.

**Independent Test**: Open any pathway; with the side panel open, closed, and
dragged narrow, the logo is the top-left item and leads to the home page; the
header has no former-browser link, beta badge or beta feedback; the release
number is not styled as a link.

**Acceptance Scenarios**:

1. **Given** a pathway open with the side panel showing, **When** the reader
   clicks the logo at the top left, **Then** the home page opens.
2. **Given** the side panel hidden or dragged narrow, **When** the reader looks
   at the header, **Then** the logo is still its first, top-left item.
3. **Given** a term in the search, with or without suggestions open, **When**
   the reader looks at the header, **Then** the search still reads as one
   field, holding its icon and its clear button.
4. **Given** the release number in the header, **Then** nothing about it
   suggests a link, and the release is named in full to a screen reader and on
   hover.

---

### User Story 2 - Find an icon and keep your place in the Icon Library (Priority: P2)

A reader searches the Icon Library for "kinase", narrows it to one category,
moves to the second page of results, opens an icon, and comes back. They find
the same search, the same category and the same page, and the search and the
category narrowed the results together rather than replacing each other.

**Why this priority**: This is where the library's flow currently breaks. The
list and an icon's details are separate pages, so leaving the list loses its
state, and Back (in-page or the browser's) returns an unfiltered first page.
Typing a search clears the chosen category, and choosing a category clears the
search, so a reader repeats their work after every icon they open.

**Independent Test**: Search, choose a category, change page, open an icon,
press Back: the same results are shown. Copy the address of a filtered result
page into a new window: the same results are shown.

**Acceptance Scenarios**:

1. **Given** a search term, **When** the reader chooses a category, **Then**
   the results match both, and the term stays in the search.
2. **Given** a category chosen, **When** the reader types a search, **Then**
   the category stays chosen and the results match both.
3. **Given** a filtered page of results, **When** the reader opens an icon and
   then goes Back (in the page or in the browser), **Then** the same search,
   category and page are shown.
4. **Given** the address of a filtered page of results, **When** someone else
   opens it, **Then** they see the same results.
5. **Given** results that update as the reader types, **When** the reader looks
   at the search, **Then** nothing on screen suggests an extra step is needed
   to search.
6. **Given** a term and a category, **When** the reader clears the search with
   its clear button, **Then** only the term is cleared; the category stays.

---

### User Story 3 - Go on from an icon's details (Priority: P2)

A reader opens an icon and wants to see similar ones, or to search again.

**What is wrong today** (read from the code): the details are not a dead end
for everything (they offer the pathways that use the icon, its references and
a download), but they are for the library itself. The category chips on the
details look like chips and do nothing. Typing in the search shown above the
details does show results, but the page's address stays the icon's, so a
reload or Back lands on the icon again rather than on those results.

**Why this priority**: Moving between icons is what the library is for, and
the details page offers no way to do it but Back.

**Independent Test**: Open any icon; from the details alone (no Back), reach
another icon in the same category, and run a new search whose results survive
a reload.

**Acceptance Scenarios**:

1. **Given** an icon's details, **When** the reader chooses one of its
   categories, **Then** the icons in that category are shown.
2. **Given** an icon's details, **When** the reader types in the search shown,
   **Then** matching icons are shown, and the address is the results', not the
   icon's.
3. **Given** an icon's details, **Then** other icons sharing a category with it
   (its related icons) are offered without leaving the page.
4. **Given** an icon's details opened from a shared address, with no list
   behind it, **When** the reader goes back to the icons, **Then** the whole
   library is shown.

The form this takes is decided in two steps (clarified 2026-11-09). First,
smaller fixes to the current pages: state in the address, the search working
from the details, filters combined, clickable categories and related icons on
the details. Then, with those seen on beta, a decision on whether a redesign
is still worth it, in which the grid stays on screen and an icon's details
open beside it in a panel. That decision is recorded in this spec's
Clarifications, either way, and is the story's exit.

---

### User Story 4 - Reach what you came for from the home page (Priority: P3)

A visitor arrives at the home page with something to do, and reaches the start
of it in one obvious step.

**Why this priority**: The home page is the site's front door, but what to
change on it is not yet known; it is to be decided from what visitors come to
do, not from taste.

**Independent Test**: For each goal FR-030 names, a visitor new to the site
reaches the start of it in one step from the home page.

**Acceptance Scenarios**:

1. **Given** the home page, **When** a visitor wants to do one of the goals
   FR-030 names, **Then** the way to it is visible without scrolling at a
   laptop width, and is one click or one field away.

It is designed within this spec, but measured first (clarified 2026-11-09).
Searching, browsing pathways and analysing data are the expected goals, to be
confirmed or replaced by what the measurement finds.

---

### User Story 5 - Understand and move through the molecule tab (Priority: P2)

A reader opens the molecule tab for Chromatin organization with ATP-dependent
chromatin remodelers selected. They can tell what the list is (the pathway's
molecules), what the blue highlighting means (in their selection), how many of
each kind are highlighted, and which list a pager belongs to; and they can see
only the highlighted molecules if that is what they came for.

**What is wrong today** (read from the code and seen on beta):

- Nothing says what the list is or what the highlighting means. The list is
  every molecule in the open pathway; a molecule is highlighted when it also
  takes part in what is selected. The tab never names the selection.
- Each group's count is a bare fraction, "8 / 20": 8 highlighted of 20, but
  nothing says so.
- Each group pages on its own, in pages of 50, and only a group of more than
  50 has a pager: here only Proteins (345). The pager sits in the label
  column under the count, apart from the list it pages, so it reads as if it
  turned a page of the whole tab, and its "1 – 50 of 345" does not say 345 of
  what. Readers asked whether the drugs had a second page; they do not.
- Each group lists its highlighted molecules first, then by number of copies,
  so the later pages of Proteins hold none of the selection; nothing tells
  the reader that either. (The code comment there says "by name"; it is by
  count.)

**Why this priority**: the molecule tab is where a reader finds what a
selection involves; when the highlighting cannot be read, the tab does not do
that job.

**Independent Test**: Open the molecule tab for Chromatin organization with
ATP-dependent chromatin remodelers selected: the tab names the selection and
what highlighting means; each group's heading says its total and how many are
highlighted, in words; only Proteins has a pager, inside the Proteins group,
named "Proteins"; showing only highlighted molecules leaves 164 proteins.

**Acceptance Scenarios**:

1. **Given** a selection inside the open pathway, **When** the reader opens
   the molecule tab, **Then** it says which pathway's molecules are listed and
   that highlighted ones take part in the named selection, with a swatch of
   the highlight.
2. **Given** a group, **When** the reader reads its heading, **Then** it gives
   the group's total and, with a selection, how many are highlighted, in words
   ("345 · 164 highlighted").
3. **Given** a group of more than 50, **When** the reader looks for the rest,
   **Then** a pager is inside that group's box, at the end of its list and at
   its start, and says which molecules it pages and which are shown
   ("Proteins 1–50 of 345").
4. **Given** a group of 50 or fewer, **Then** it has no pager, and its heading
   shows that all of it is listed.
5. **Given** a selection, **When** the reader chooses to show only highlighted
   molecules, **Then** every group lists only those, and its heading and any
   pager count only those.

Decided 2026-11-09: paging stays per group, in pages of 50, made plain as
above, rather than replaced.

---

### Edge Cases

Each of these is a requirement below, so that tasks are made for it.

- The Pathway Browser's side panel dragged narrow: FR-010.
- The release cannot be loaded: FR-013.
- The curator build: it keeps its own badge and its own way home (FR-014).
- An Icon Library address that names a category that no longer exists, or a
  page beyond the last: FR-025.
- A search and a category that together match nothing: FR-026.
- An icon with no categories, or no related icons: FR-024.
- Keyboard only: FR-006.

## Requirements _(mandatory)_

### Functional Requirements

**Across the site**

- **FR-001**: Each change MUST name the principle (1–7 above) the problem broke.
- **FR-002**: Text MUST meet 4.5:1 contrast (3:1 for large text) against its
  background, in light and dark themes.
- **FR-003**: Every control that is only an icon MUST have a name a screen
  reader announces.
- **FR-004**: Anything styled as a link, button or chip MUST do something when
  activated; anything that does nothing MUST NOT be styled as one.
- **FR-005**: Each change MUST be checked in light and dark themes, at a laptop
  width (1280–1440px) and a narrow one (1024px), and seen on beta before it is
  merged. Icon Library changes are also checked at a phone width (390px).
- **FR-006**: Every control a story adds or changes MUST be reachable by
  keyboard and show where the focus is.
- **FR-007**: Information MUST NOT be available only on hover.

**Pathway Browser header** (delivered in #899)

- **FR-010**: The logo MUST be the header's top-left item and lead to the home
  page, with the side panel open, closed, or dragged narrow.
- **FR-011**: The header MUST NOT link to the former browser, show a beta
  badge, or ask for beta feedback.
- **FR-012**: The search MUST read as one field whether empty or holding a
  term, with suggestions open or not, with its icon and clear button inside it
  and a visible focus state.
- **FR-013**: The release number MUST read as a label, not a link, and name the
  release in full to a screen reader; when the release cannot be loaded, no
  number is shown.
- **FR-014**: The curator build MUST keep its own badge and its way home.

**Icon Library**

- **FR-020**: A search and a chosen category MUST narrow the results together;
  changing one MUST NOT clear the other, and the search's clear button MUST
  clear only the search.
- **FR-021**: The search, the chosen category and the page MUST be carried in
  the page's address, so that Back, reload and a shared address all show the
  same results. Typing MUST replace the current history entry (Back does not
  step through each letter); choosing a category, changing page and opening an
  icon MUST each add one.
- **FR-022**: Opening an icon and returning (in-page Back or the browser's)
  MUST show the results the reader left; from details opened without a list
  behind them, returning MUST show the whole library.
- **FR-023**: The search MUST NOT show a separate Search button while results
  already update as the reader types.
- **FR-024**: An icon's details MUST offer a way onwards other than Back: its
  categories lead to their icons; up to a page of other icons sharing a
  category with it are shown; and the search shown on the page works there.
  An icon with no categories offers the search and the way to the whole
  library.
- **FR-025**: An address naming a category that does not exist, or a page
  beyond the last, MUST show the nearest valid results (the whole library, or
  the last page) and say why.
- **FR-026**: A search and a category that together match nothing MUST say so
  and offer to clear either one.
- **FR-027**: Results MUST be in the same order across pages (by name), not
  sorted within each page.

**Home page**

- **FR-030**: Before the home page is changed, what visitors come to do MUST
  be measured, and the goals it is designed for named from that. The
  measurement is a bounded piece of work: the site's analytics for one month
  (the pages visitors go to from the home page, and what they search for),
  plus questions put to at least five readers, written up in this spec's
  directory as `home-page-findings.md`. The design is planned from that note.
- **FR-031**: The home page MUST offer, without scrolling at a laptop width,
  one obvious step to each goal FR-030 names.

**Molecule tab**

- **FR-040**: The tab MUST say, in words, which pathway's molecules it lists,
  and, when something is selected, that highlighted molecules take part in
  the selection, naming it, with a swatch of the highlight.
- **FR-041**: Each group's heading MUST give its total and, with a selection,
  the number highlighted, in words.
- **FR-042**: Each group MUST be a visibly bounded region holding its heading,
  its list and any pager.
- **FR-043**: A group of more than 50 MUST have a pager inside its region, at
  the end of its list and at its start, naming the group and the range shown
  ("Proteins 1–50 of 345"); a group of 50 or fewer MUST have none.
- **FR-044**: With a selection, a control MUST let the reader list only the
  highlighted molecules in every group; the headings and pagers then count
  only those.
- **FR-045**: Within a group, molecules MUST be ordered highlighted first, then
  by number of copies, then by name, the same on every page.

### Key Entities

- **Icon Library view state**: the reader's search term, chosen category and
  page of results; carried by the address so it survives Back, reload and
  sharing.
- **Related icons**: the other icons sharing at least one category with an
  icon; no new data, read from the categories the library already has.

## Success Criteria _(mandatory)_

### Measurable Outcomes

Each is checked by an automated end-to-end test unless it says otherwise.

- **SC-001**: From a pathway, with the side panel open, closed and dragged
  narrow, the top-left item of the header is a link to the home page.
- **SC-002**: For every combination of a term (or none), a category (or none)
  and a page (first or later), opening an icon and going Back, in the page and
  in the browser, shows the same results.
- **SC-003**: From an icon's details, a reader reaches a second icon in the
  same category and a search's results in one step each, and a reload keeps
  them.
- **SC-004**: An automated accessibility audit (the tool chosen in the plan) of
  each changed page reports no contrast failures and no unnamed controls, in
  either theme.
- **SC-005**: Manual, once the home page is changed: for each goal FR-030
  names, five visitors new to the site each reach the start of it in one step
  from the home page, and their results are added to `home-page-findings.md`.
- **SC-006**: On each changed page, no element styled as a link, button or
  chip does nothing when activated.
- **SC-007**: In the molecule tab for Chromatin organization with
  ATP-dependent chromatin remodelers selected: the selection is named; each
  group's heading reads its total and highlighted count; Proteins alone has a
  pager, inside the Proteins region and named for it; showing only
  highlighted molecules lists 164 proteins.

## Clarifications

### Session 2026-11-09

- Q: The Icon Library: smaller fixes to the current pages, or a redesign with
  the details in a side panel? → A: The smaller fixes first; the side panel is
  decided afterwards, with those seen on beta.
- Q: The home page: designed within this spec, or in a spec of its own? → A:
  Within this spec, but what visitors come to do is measured first, and the
  design follows from that.
- Q: The molecule tab's paging: a "show more" control, every molecule shown,
  or a switch to show only highlighted ones? → A: Paging stays per group, in
  pages of 50, made plain: each group a box with the pager inside it, named
  for the group; the tab says what highlighting means; and a switch shows
  only the highlighted molecules.

## Assumptions

- Readers' expectations follow common web conventions (logo top left as home,
  fields with visible edges, underlines meaning links); no user research is
  needed to adopt them, but it is needed for the home page's goals.
- The colour scheme from the Pathway Browser's illustrator work is fixed; the
  changes use its colours.
- The Pathway Browser is a desktop tool: it is checked down to 1024px, and a
  phone layout for it is out of scope. The Icon Library is a simple page that
  readers reach from anywhere, so it is checked at a phone width too.
- The Icon Library's data and search service stay as they are; the changes are
  to how the page presents and remembers them.
- The content pages' own icon page (`/content/detail/icon/...`) is out of scope
  here; it is a page of the content section, not the library's flow.
- The library's category counts are of the whole library; making them follow
  the search is out of scope.
- The curator build follows the public one, keeping its own badge.
