# Feature Specification: The analysis report, made and downloaded in place

**Feature Branch**: `spec031/analysis-report-download`

**Created**: 2026-11-21

**Status**: Draft

**Input**: User description: the analysis report PDF is downloaded in place, with live
status, instead of in a new tab. Today the report's button opens the report's address in a
new tab; while the report is made, that tab shows a page that asks again every 10 seconds,
with nothing said about what is happening, and the file appears in that tab when it is
ready. The user found it unintuitive (21 Nov 2026): a new tab, a long wait with no
information, the file appearing elsewhere. They want the report beside the other downloads,
made and followed on the same page, with what it is doing (queued and its place, the stage
it is at, an estimate of the time left), then the file, a way to download it again, failures
said plainly with a retry, and a way to cancel.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Ask for the report and follow it on the same page (Priority: P1)

A reader who has run an analysis opens the Download tab and asks for the analysis report.
The page stays where it is. A status line beside the report's button says at once that the
report is on its way, then what is happening, as it happens: waiting in a queue (and how
many reports are ahead of it), then being made (reading the results, drawing the figures,
with how many of how many, printing), with an estimate of the time left. When the report is
ready, the file downloads, as the other formats on the tab do, and the line says so.

**Why this priority**: it is the whole complaint: the new tab, the silence and the file
turning up somewhere else. Without it nothing else here matters.

**Independent Test**: with a token whose report takes minutes, ask for the report on the
Download tab and watch: no new tab opens, the line changes through its states, and the PDF
downloads when it is ready.

**Acceptance Scenarios**:

1. **Given** an analysis's results and the Download tab, **When** the reader asks for the
   report, **Then** no new tab or window opens, and within a second the line beside the
   button says the report is being started.
2. **Given** a report waiting behind others, **When** the reader looks at the line, **Then**
   it says the report is queued and how many reports are ahead of it, and the number falls as
   they finish.
3. **Given** a report being made, **When** it moves from one stage to the next, **Then** the
   line names the stage, with a count where the stage has one (figures drawn of figures to
   draw), and an estimate of the time left.
4. **Given** a report that becomes ready, **When** it is ready, **Then** the PDF downloads
   under the report's file name, without the reader doing anything more, and the line says
   it has downloaded.
5. **Given** a report already made for the same analysis and settings within the hour,
   **When** the reader asks for it, **Then** it downloads at once, with no queue or stages
   shown.

---

### User Story 2 - Failures said plainly, with a way on (Priority: P1)

When the report cannot be made, the line says why, in words the reader can act on, and
offers what can be done: ask again when the service was busy; run the analysis again when
its result has expired; report a problem when the report itself failed.

**Why this priority**: today a failure shows as a page of JSON or nothing at all. A reader
left with no explanation cannot tell a wait from a failure, which is the same complaint.

**Independent Test**: ask for reports that fail each way (an expired token, an unknown one,
the service at its limit, a report that fails to print) and read what the line says.

**Acceptance Scenarios**:

1. **Given** a token whose result has expired or is unknown, **When** the reader asks for the
   report, **Then** the line says the analysis's result is no longer available and that
   running the analysis again makes a new one; no retry is offered.
2. **Given** the service busy (at its limit) or unreachable, **When** the reader asks for the
   report, **Then** the line says the service is busy and offers to try again, and trying
   again asks afresh.
3. **Given** a report that fails while being made, **When** it fails, **Then** the line says
   the report could not be made, offers to try again, and says how to report the problem.

---

### User Story 3 - Cancel, and download again (Priority: P2)

While the report is waiting or being made, the reader can stop waiting for it. Once it has
downloaded, the reader can download it again for as long as the service keeps it, without
it being made again.

**Why this priority**: useful, but the report is usable without either.

**Independent Test**: start a report and cancel it: the line clears and nothing downloads.
Download a report, then download it again: it arrives at once.

**Acceptance Scenarios**:

1. **Given** a report waiting or being made, **When** the reader cancels, **Then** the page
   stops asking about it, nothing downloads later, and the button is ready to ask again.
2. **Given** a report that has downloaded, **When** the reader asks to download it again
   within the hour the service keeps it, **Then** it downloads at once.
3. **Given** a report that has downloaded, **When** the hour has passed, **Then** asking
   again makes it anew, with its status shown as in User Story 1.

---

### Edge Cases

- **The reader leaves the tab or the page** while the report is made: the page stops asking;
  coming back to the Download tab of the same analysis within the hour finds the report
  where it was (still being made, or ready) rather than starting it again, since the service
  shares one report among every request for it.
- **Another reader, or another tab, asks for the same report**: both follow the one report.
- **The analysis is changed while its report is made** (another resource, species or sample
  chosen): the line belongs to the report asked for; asking for the new settings starts
  their own.
- **The status cannot be read for a while** (a dropped connection): the line says it is
  still waiting and keeps asking; after two minutes without an answer it says the status is
  unknown and offers to try again.
- **A browser opens the report's address directly** (a bookmark, a link someone shared): it
  gets what it gets today, the page that asks again and then the file.
- **An estimate that cannot be made** (no past reports of that size yet): the line shows
  the stage and count without an estimate, rather than a guess.
- **The estimate is passed**: the line says it is taking longer than expected, and does not
  count below zero.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The analysis report MUST be offered on the analysis results' Download tab,
  beside the other formats, and asking for it MUST NOT open a new tab or window.
- **FR-002**: Within one second of the request, the page MUST show that the report is on
  its way.
- **FR-003**: While the report waits, the page MUST say it is queued and how many reports
  are ahead of it.
- **FR-004**: While the report is made, the page MUST name its stage (reading the results,
  drawing the figures, printing) and, where the stage has one, its count (figures drawn of
  figures to draw).
- **FR-005**: While the report waits or is made, the page MUST show an estimate of the time
  left where one can be made from the service's past reports, and none where it cannot.
- **FR-006**: The page MUST update its status at least every 10 seconds while the report
  waits or is made.
- **FR-007**: When the report is ready the PDF MUST download as the tab's other files do,
  under the report's file name, with no further action from the reader.
- **FR-008**: A report the service already holds for the same analysis and settings MUST
  download at once.
- **FR-009**: Each failure MUST be said in words the reader can act on, with the action
  that fits it: an expired or unknown result (run the analysis again; no retry), a service
  busy or unreachable (try again), a report that failed (try again, and how to report it).
- **FR-010**: The reader MUST be able to cancel a report waiting or being made; nothing
  then downloads, and the button can be used again.
- **FR-011**: After a report has downloaded, the reader MUST be able to download it again
  without its being made again while the service keeps it (an hour).
- **FR-012**: Coming back to the Download tab of the same analysis while its report is made
  or kept MUST show that report's state, not start another.
- **FR-013**: The report's address, and what it answers a browser that opens it directly,
  MUST stay as they are for every other caller.
- **FR-014**: The analysis's token MUST be sent to Reactome's own services only, never to
  another host, and MUST NOT be written to the page's logs.
- **FR-015**: The service that makes the report MUST answer a request for its status with:
  its state (queued, being made, ready, failed); its place in the queue when queued; its
  stage and count when being made; an estimate of the time left when it has one; and, when
  failed, the failure's kind. Recorded as a dependency on pdf-export (its spec 002, a task
  of its own there), and the analysis gateway MUST pass that answer through unchanged
  (spec 010, T066's route).

### Key Entities

- **Report request**: what the reader asked for: the analysis's token, the species, and the
  report's settings (resource, sample and the like). Two identical requests are one report.
- **Report status**: the state of one report as the service sees it: queued (with its
  place), being made (with its stage, count and estimate), ready, or failed (with the
  failure's kind).
- **Kept report**: a report the service has made and keeps for an hour, downloadable again
  at once.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In a test of every story, the reader never leaves the page: no new tab or
  window opens for the report.
- **SC-002**: The first status appears within one second of the request, in 95% of requests.
- **SC-003**: While a report waits or is made, the status changes (its state, place, stage,
  count or estimate) at least every 10 seconds.
- **SC-004**: For reports of release 98 analyses made with no other report in the queue, the
  estimate shown when the report starts is within 50% of the time it then takes, in at least
  four reports in five.
- **SC-005**: Each failure of User Story 2 is shown with its own words and its own action,
  checked for each kind.
- **SC-006**: No request made by the page carries the token to a host other than the site's
  own, checked across every story.
- **SC-007**: A browser opening the report's address directly gets the same answers as before
  this feature, checked against today's for a report waiting, ready and failed.

## Assumptions

- **The service shares one report among identical requests** and keeps it for an hour, as
  pdf-export's spec 002 already does; this feature relies on it for FR-008, FR-011 and
  FR-012.
- **pdf-export can report a stage and count** for a report being made (its stages are its
  own reading, figures and printing) and an estimate from its own past reports; that is
  pdf-export's to add (FR-015), and this feature waits for it. Until it exists, the page can
  still show queued, being made (without stage or estimate), ready and failed from today's
  answers, which is a first, smaller step of User Story 1.
- **Polling, not a pushed stream**: the page asks for the status at intervals (FR-006's 10
  seconds at most); a pushed stream is not needed for the experience asked for.
- **Other downloads are not changed**: they already show their progress beside their links
  (the site's download feedback); the report joins that look.
- **The report's content and look** are pdf-export's (its spec 002), not this feature's.
