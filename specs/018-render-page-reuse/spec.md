# Feature Specification: Render page reuse

**Feature Branch**: `spec018/render-page-reuse`

**Created**: 2026-11-04

**Status**: Draft

**Input**: The render service loads the render page afresh for every figure, and that
load is most of a figure's time. pdf-export's figures step (its spec 001, T042 and
SC-010), which draws every figure of the release's book through this service, took
5 h 47 min for release 98. Reuse loaded pages so the load is paid once per page, not
once per figure.

## Background

- **Today:** the render service (`tools/render`) opens a new browser page for each
  figure it draws and loads the site's render page into it from the start. The page reads
  what to draw from its address once, when it starts.
- **Measured (pilot, 4 Nov 2026):** beta's production build drew 40 of release 98's
  human reactions, one at a time, with the page's files already in the browser's cache.
  The median figure took about 1.85 s:

  | Part of a figure's time              | Median       |
  | ------------------------------------ | ------------ |
  | Loading and starting the page        | about 1.2 s  |
  | Fetching the reaction and drawing it | about 0.6 s  |
  | Exporting the SVG                    | about 0.03 s |

  The page's document arrived in 4 ms, so the 1.2 s is starting the site's code, not
  the network.

- **What it costs:** pdf-export drew release 98's 19,076 book figures in 5 h 47 min at
  four figures at once. 16,187 of them are reactions, the kind measured above. If the
  load is paid once per page instead, a reaction should take about a third of its time
  today (inference, from one-at-a-time medians; under load the processors are shared).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The book's figures in half the time (Priority: P1)

The release's figures step asks the render service for every figure of the book, one
request per figure, as it does today. The service draws each on a page that already holds
the render page, moved to the next figure without loading it again, so the step finishes
in at most half today's time on the same machine.

**Why this priority**: it is the reason for the feature. The figures step is the
longest step of making the book, and most of its time is page loads.

**Independent Test**: run pdf-export's figures step for release 98 against the service
on the same host and settings as T031's run, compare its time with that run's, and its
figures with a run of the same build on fresh pages.

**Acceptance Scenarios**:

1. **Given** the service at the same concurrency as T031's run, **When** pdf-export's
   figures step draws release 98's book figures, **Then** it finishes in no more than
   2 h 54 min, and every figure is drawn.
2. **Given** a reaction asked for on a page that has drawn others, **When** it is drawn,
   **Then** it takes no more than half the time it takes on a fresh page, measured as the
   median over a sample.

---

### User Story 2 - The same figure whatever came before (Priority: P1)

Whoever asks for a figure gets exactly what a fresh page draws for the same request. Which
figures the page drew before, and with what settings, makes no difference.

**Why this priority**: a figure that silently differs (an overlay left from the last
request, a species carried over, a selection kept) is worse than a slow one. It would
reach the book and the website's downloads unnoticed.

**Independent Test**: draw a sample of requests covering every kind and setting, in
several different orders on reused pages, and compare each result with the same request
drawn on a fresh page.

**Acceptance Scenarios**:

1. **Given** a sample of at least 500 requests covering every kind of figure and every
   setting, **When** each is drawn on a reused page in at least three different orders,
   **Then** every SVG is byte-identical to the fresh page's.
2. **Given** the same sample in the raster, PDF, PowerPoint and GIF formats, **When** they
   are drawn on reused pages, **Then** each is identical to the fresh page's output, or
   differs only where a fresh page's output differs from itself on a second run.
3. **Given** a figure with an analysis overlay, dark colours, a selection or a species
   asked for, **When** the next request on that page asks for none of them, **Then**
   the next figure shows none of them.

---

### User Story 3 - A page that goes wrong is not used again (Priority: P2)

When a figure fails on a page (the page reports an error, times out, or reports a problem
while drawing), the service answers that request as it does today, and closes that page.
The next request gets a page that is in a known state.

**Why this priority**: today every request starts clean, so one bad figure cannot spoil
the next. Reuse must keep that.

**Independent Test**: plant a failing request (an identifier the page cannot draw, a
drawing that times out) among good ones and check the good ones after it are unchanged and
the failed page was replaced.

**Acceptance Scenarios**:

1. **Given** a page whose figure failed, **When** the next request is drawn, **Then** it
   is drawn on a different page, and its output is the fresh page's.
2. **Given** a failing request, **When** it fails, **Then** the service's answer is the one
   it gives today for that failure: the same status, and the same body as the service
   writes it.

---

### User Story 4 - Memory stays bounded (Priority: P2)

A long run, such as the book's 19,076 figures, does not grow the service's memory without
limit. A page is replaced after a set number of figures, or sooner when the service is
using more memory than a set bound.

**Why this priority**: a page that lives for thousands of figures can collect memory the
site's code never gives back, and the service runs in a container with a memory limit.

**Independent Test**: draw several thousand figures on one page and record its heap and
document nodes after each figure (a leak in the page), and the service's memory and the
container's peak (the bound).

**Acceptance Scenarios**:

1. **Given** the release 98 figures run, **When** it ends, **Then** no page drew more than
   the set number of figures, and the service stayed within T031's container memory limit
   (3 GB) with no request failed for want of memory.

---

### Edge Cases

- **A page that crashes** (the browser's renderer process dies): the request fails as it
  would today, and the page is replaced.
- **The browser itself restarts:** every reused page belonged to the old browser, so all
  are dropped.
- **The site's code changes under the service** (a new build deployed while pages are
  held): a held page keeps the old code. Each page records the build it loaded, and the
  health answer names it, so a page older than the site is visible (FR-008). The service
  replaces it, because its figures must be the current build's.
- **The genome-wide overview** draws a different view from a pathway's. Moving between
  the two on one page must give each its fresh-page output.
- **A request that the service refuses before drawing** (an unknown identifier, a
  reaction layout asked of a pathway) never reaches a page, as today.
- **The figure cache:** a request the cache answers takes no page, as today.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The render service MUST be able to draw a figure on a page that has
  already drawn others, without loading the render page again.
- **FR-002**: The output for a request on a reused page MUST be the output for the same
  request on a fresh page: byte-identical for SVG, and identical for the other formats
  unless a fresh page's own output varies between runs (FR-003).
- **FR-003**: Where a format's output varies between two fresh-page runs of the same
  request (an embedded time, say), the comparison MUST be on what remains when that
  variation is removed, and the variation MUST be named in the plan.
- **FR-004**: Nothing a figure was drawn with MUST carry over to the next figure on the
  same page. That covers the analysis token, the species, dark colours, the selection,
  the highlight, subpathways and the reaction layout. It also covers anything the page
  keeps that changes what is drawn, such as interactors or cached data.
- **FR-005**: A page MUST NOT be used again after a request on it fails, times out, or
  reports a problem while drawing (the browser problems today's log line counts). It is
  closed, and later requests use another page.
- **FR-006**: A page MUST be replaced after a configurable number of figures. It MUST
  also be closed rather than held when the service's memory passes a configurable bound,
  checked after each figure. The bound is the service's, not one page's: a browser page's
  memory is mostly outside what it reports as its own (research R4).
  Both have defaults chosen from measurement (plan).
- **FR-007**: The service's HTTP interface MUST NOT change: its routes, parameters,
  answers and errors, its figure cache, its queue, and its concurrency and timeout
  settings. Callers, pdf-export among them, need no change.
- **FR-008**: The service's health answer MUST keep every field it has. It MAY add the
  number of pages held, the figures drawn on reused pages, and the pages replaced and
  why. A page MUST NOT be reused once the site's build differs from the one it loaded.
- **FR-009**: The same page code MUST draw every figure, whether on a reused page or a
  fresh one. A page's failure leads to a fresh page with the same code, never to another
  way of drawing.
- **FR-010**: Reuse MUST be possible to turn off by a setting. With it off, every figure
  is drawn on a fresh page, as today, which is how FR-002's comparison is made.
- **FR-011**: The command-line renderer MAY keep drawing on fresh pages.

### Key Entities

- **Held page:** a browser page with the render page loaded. It records the site build
  it loaded and the figures drawn on it.
- **Replacement:** closing a held page and why: a failure, the figure count, the memory
  bound, or a build change.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On the same host and settings as pdf-export's T031 run (release 98, four
  figures at once), the book's figures step finishes in no more than 2 h 54 min, half of
  5 h 47 min, with every figure drawn.
- **SC-002**: A reaction figure drawn on a reused page takes no more than half the median
  time of the same reaction on a fresh page, over a sample of at least 40 reactions.
- **SC-003**: For a sample of at least 500 requests across every kind of figure and every
  setting, drawn in at least three orders on reused pages, every SVG is byte-identical to
  the fresh page's for the same request. The other formats meet FR-002 on a smaller
  sample, at least 20 requests each.
- **SC-004**: Over the full release 98 run, no page draws more than the configured number
  of figures, and the service stays within the 3 GB container limit of T031's run, with no
  request failed for want of memory.
- **SC-005**: A planted failure among good requests leaves the requests after it
  identical to their fresh-page output, and the failed page is replaced.

## Assumptions

- **What the pilot measured:** the 1.2 s load is starting the site's code, not
  fetching it. Moving a loaded page to the next figure inside the site avoids it. The
  plan measures this on the render service itself, at the service's concurrency,
  before anything is built (constitution II).
- **Pathway figures:** they gain less than reactions, because their drawing takes longer
  (5–7 s each in T031's run, at four at once). SC-001 rests mostly on the reactions.
- **The page:** may need a way to be moved to the next figure from outside it, and to
  start each figure from a clean state. How is the plan's.
- **Measuring:** the release 98 graph, release files and figures are those of
  pdf-export's T031 run, kept privately on this host. Nothing is sent to Reactome's
  public services.
- **Out of scope:**
  - several figures per HTTP request, which reuse makes unnecessary;
  - changes to pdf-export other than re-running its figures step to measure;
  - the figures' look.
