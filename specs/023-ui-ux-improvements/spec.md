# Feature Specification: UI and UX improvements, one obvious problem at a time

**Feature Branch**: `spec/023-ui-ux-improvements`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "Improve the website's UI and UX, one obvious problem at a time, following established usability conventions. The colour scheme is settled (from the Pathway Browser's illustrator work) and is not in scope. Scope: the Pathway Browser's header, the community Icon Library page's search and detail flow, and the home page. Principles that decide each change: follow conventions readers already know (the way home is the logo at the top left); only what is clickable looks clickable; a field looks like a field whether empty or full; no dead ends; the interface remembers state for the reader; filters narrow together instead of clearing each other; accessibility at WCAG 2.1 AA; each change checked in light and dark, at laptop and narrow widths, and seen on beta before merge. Already done in PR #899: … Icon Library problems seen: … Two directions for it: … Home page: improvements to be defined from what visitors come to do; not yet designed." (abridged; the full text is in the pull request that adds this spec)

## How this work is done

Each problem is fixed on its own, in its own pull request, and seen working on
beta before it is merged. A problem gets fixed when it breaks one of the
principles below; a change that breaks none of them is a change of taste and
is out of scope. The colour scheme is settled and is not changed here.

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
7. **Accessible to WCAG 2.1 AA**: small text at 4.5:1 contrast or better, and
   every control that is only an icon has a name a screen reader can say.

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

**Independent Test**: Open any pathway; with the side panel open and closed,
the logo is the top-left item and leads to the home page; the header has no
former-browser link, beta badge or beta feedback; the release number is not
styled as a link.

**Acceptance Scenarios**:

1. **Given** a pathway open with the side panel showing, **When** the reader
   clicks the logo at the top left, **Then** the home page opens.
2. **Given** the side panel hidden, **When** the reader looks at the header,
   **Then** the logo is still its first, top-left item.
3. **Given** a term in the search, **When** the reader looks at the header,
   **Then** the search still reads as one field, holding its icon and its clear
   button.
4. **Given** the release number in the header, **When** the reader points at
   it, **Then** nothing about it suggests a link, and it names the release in
   full.

---

### User Story 2 - Find an icon and keep your place in the Icon Library (Priority: P2)

A reader searches the Icon Library for "kinase", narrows it to one category,
moves to the second page of results, opens an icon, and comes back. They find
the same search, the same category and the same page, and the search and the
category narrowed the results together rather than replacing each other.

**Why this priority**: This is where the library's flow currently breaks: Back
returns to an unfiltered first page, and the search and the categories clear
each other, so a reader repeats their work after every icon they open.

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

---

### User Story 3 - Go on from an icon's details (Priority: P2)

A reader opens an icon and wants to see similar ones, or to search again. The
details page offers them the way: its categories lead to that category's
icons, related icons are shown, and the search shown on the page works there.

**Why this priority**: The details page is a dead end today. Its only way
onwards is a Back button, while a search box sits on the page doing nothing.

**Independent Test**: Open any icon; from the details alone (no Back), reach
another icon in the same category, and run a new search.

**Acceptance Scenarios**:

1. **Given** an icon's details, **When** the reader chooses one of its
   categories, **Then** the icons in that category are shown.
2. **Given** an icon's details, **When** the reader types in the search shown,
   **Then** matching icons are shown.
3. **Given** an icon's details, **When** the reader looks for what to do next,
   **Then** related icons are offered without leaving the page.

The form this takes is decided in two steps (clarified 2026-11-09). First,
smaller fixes to the current pages: state in the address, the search working
from the details, filters combined, clickable categories and related icons on
the details. Then, with those seen on beta, a decision on whether a redesign
is still worth it, in which the grid stays on screen and an icon's details
open beside it in a panel. That decision is recorded here, either way.

---

### User Story 4 - Reach what you came for from the home page (Priority: P3)

A visitor arrives at the home page wanting to search for a gene, browse
pathways, or analyse their data, and reaches each in one obvious step.

**Why this priority**: The home page is the site's front door, but what to
change on it is not yet known; it is to be decided from what visitors come to
do, not from taste.

**Independent Test**: For each of the visitor goals the home page is designed
for, a new visitor reaches the start of it in one step from the home page.

**Acceptance Scenarios**:

1. **Given** the home page, **When** a visitor wants to search, browse
   pathways or analyse data, **Then** the way to each is visible without
   scrolling on a laptop screen, and is one click or one field away.

It is designed within this spec, but measured first (clarified 2026-11-09):
the first home-page work is finding out what visitors come to do, from the
site's analytics and from asking readers, and the goals above are replaced or
confirmed by what that finds. The design follows from it.

---

### Edge Cases

- The Pathway Browser's side panel is dragged narrow: the logo and the search
  both stay usable, and the search text ends with an ellipsis rather than
  running out of its field.
- The release cannot be loaded: the header shows no release number, rather
  than a "v" with nothing after it.
- The curator build: it keeps its own badge and its own way home.
- An Icon Library address names a category that no longer exists, or a page
  beyond the last: the reader is shown the nearest valid results and is told
  why, not an empty page.
- A search and a category that together match nothing: the reader is told so,
  and offered to clear one of them.
- An icon that has no categories, or no related icons: its details still offer
  the search and the way back to all icons.
- Keyboard only: every control in each story is reachable and shows where the
  focus is.

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
  merged.

**Pathway Browser header** (delivered in #899)

- **FR-010**: The logo MUST be the header's top-left item and lead to the home
  page, with the side panel open or closed.
- **FR-011**: The header MUST NOT link to the former browser, show a beta
  badge, or ask for beta feedback.
- **FR-012**: The search MUST read as one field whether empty or holding a
  term, with its icon and clear button inside it and a visible focus state.
- **FR-013**: The release number MUST read as a label, not a link, and name the
  release in full on hover.

**Icon Library**

- **FR-020**: A search and a chosen category MUST narrow the results together;
  changing one MUST NOT clear the other.
- **FR-021**: The search, the chosen category and the page MUST be carried in
  the page's address, so that Back, reload and a shared address all show the
  same results.
- **FR-022**: Opening an icon and returning (in-page Back or the browser's)
  MUST show the results the reader left.
- **FR-023**: The search MUST NOT show a separate Search button while results
  already update as the reader types.
- **FR-024**: An icon's details MUST offer a way onwards other than Back: its
  categories lead to their icons, related icons are shown, and a search shown
  on the page works there.

**Home page**

- **FR-030**: Before the home page is changed, what visitors come to do MUST
  be measured (analytics and readers asked), and the goals it is designed for
  named from that, with the evidence recorded in this spec.
- **FR-031**: The home page MUST offer, without scrolling at a laptop width,
  one obvious step to each of those goals.

### Key Entities

- **Icon Library view state**: the reader's search term, chosen category and
  page of results; carried by the address so it survives Back, reload and
  sharing.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Five readers new to the Pathway Browser, asked to get to the
  home page from a pathway, all do so within 10 seconds without help.
- **SC-002**: Opening an icon and going Back returns to the same search,
  category and page every time, across 20 tries with different combinations.
- **SC-003**: A reader finds an icon by term within a category, and a second
  icon in the same category, without retyping anything or using Back.
- **SC-004**: An accessibility audit of each changed page reports no contrast
  failures and no unnamed controls, in either theme.
- **SC-005**: For each goal the home page is designed for, five visitors new
  to it each reach the start of that goal in one step from the home page.
- **SC-006**: On each changed page, no element styled as a link, button or
  chip does nothing when activated.

## Clarifications

### Session 2026-11-09

- Q: The Icon Library: smaller fixes to the current pages, or a redesign with
  the details in a side panel? → A: The smaller fixes first; the side panel is
  decided afterwards, with those seen on beta.
- Q: The home page: designed within this spec, or in a spec of its own? → A:
  Within this spec, but what visitors come to do is measured first, and the
  design follows from that.

## Assumptions

- Readers' expectations follow common web conventions (logo top left as home,
  fields with visible edges, underlines meaning links); no user research is
  needed to adopt them, but it is needed for the home page's goals.
- The colour scheme from the Pathway Browser's illustrator work is fixed; the
  changes use its colours.
- Desktop and laptop widths are the priority; narrow widths are checked down to
  1024px. A dedicated phone layout is out of scope.
- The Icon Library's data and search service stay as they are; the changes are
  to how the page presents and remembers them.
- The curator build follows the public one, keeping its own badge.
