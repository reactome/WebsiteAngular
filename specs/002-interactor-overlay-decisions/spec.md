# Feature Specification: The interactor overlay, as built

**Feature Branch**: `docs/interactor-overlay-decisions`
**Created**: 2026-09-16
**Status**: Shipped — this records behaviour already released
**Input**: Record the design decisions behind the interactor overlay so the reasoning survives the commit log.

## What this document is

A record, not a proposal. Everything here is released: #204, #206, #207, #208,
#209, #210, #211, #212. It exists because the reasoning behind these choices
lived only in commit messages, and nobody reads those in a year when they are
wondering why a number is what it is.

The decisions themselves, with what was rejected and why, are in
[research.md](./research.md). This file records what the feature does, in terms
that can be checked, and names the test that holds each one.

**Every figure is measured.** Where a number appears, it was read off beta or off
the ContentService on the date given, not inferred from the code. Several of the
decisions below exist _because_ a measurement contradicted an assumption.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Find out whether a resource has anything here (Priority: P1)

A curator opens a pathway and wants to know which interaction resource is worth
choosing, out of fourteen.

**Why this priority**: Without it, choosing between resources is fourteen clicks
and six to seventeen seconds each, and five of the thirteen PSICQUIC servers had
nothing at all for the pathway measured.

**Acceptance Scenarios**

1. **Given** the interactors panel is open, **When** the counts arrive, **Then**
   each resource shows how many interactions it holds for this diagram, and the
   tooltip also says across how many entities.
2. **Given** a resource holds nothing here, **When** its count arrives, **Then**
   it reads 0 and is visibly distinct from a resource not yet asked.
3. **Given** the panel has never been opened, **When** a pathway is viewed,
   **Then** no resource is asked anything.

Held by: `e2e/interactor-threshold.spec.ts` — "is in the same unit as the badges
it describes".

### User Story 2 - See the interactors, and know they are there (Priority: P1)

A reader chooses a resource at the zoom a pathway opens at.

**Why this priority**: This is the complaint the whole feature began with — two
readers in a row failed to find a feature that was working correctly.

**Acceptance Scenarios**

1. **Given** a resource with interactors here, **When** it is chosen at a zoom
   where the count badge cannot be read, **Then** the reader is told they exist
   and offered a way to reach them.
2. **Given** that notice, **When** the reader takes it, **Then** the diagram
   moves to the entities carrying interactors and the badges become readable.
3. **Given** a resource with nothing here, **When** it is chosen, **Then** the
   reader is told that, and not shown the same message as (1).

Held by: `e2e/interactor-threshold.spec.ts` — "An overlay that cannot be seen
yet", "The interactor count badge".

### User Story 3 - Filter by confidence, and take the data away (Priority: P2)

A curator raises the confidence threshold to clear out weakly-supported
interactions, then wants the data in a spreadsheet.

**Acceptance Scenarios**

1. **Given** interactors drawn, **When** the threshold is raised, **Then** only
   interactions at or above it remain drawn, and the diagram keeps up as the
   control moves rather than when it is released.
2. **Given** any threshold, **When** the file is downloaded, **Then** it carries
   **every** interaction the opened entities hold, not the filtered view.
3. **Given** a threshold that hides everything, **When** the diagram empties,
   **Then** the reader is told the threshold is the cause, which is different
   from the entity having none.

Held by: `e2e/interactor-threshold.spec.ts`, `interactor-threshold.spec.ts`,
`interactor-export.spec.ts`.

### User Story 4 - Bring your own interactions (Priority: P3)

A researcher has their own list of interacting pairs and wants to see it on a
Reactome diagram.

**Acceptance Scenarios**

1. **Given** a file or a pasted table, **When** it is submitted, **Then** it is
   read in the browser and **no request is made**.
2. **Given** the reader ticks the sharing option, **When** it is submitted,
   **Then** it is uploaded and the resulting address opens the same overlay for
   someone else.
3. **Given** the service refuses the data, **When** that happens, **Then** the
   reader is told why, in words that say what to fix, and the dialog stays open.
4. **Given** a resource the reader added, **When** they delete it, **Then** it
   leaves both the list and the diagram.

Held by: `e2e/custom-interactor-dialog.spec.ts`,
`custom-interactor-parse.spec.ts`.

### Edge Cases

- A threshold in a shared address must survive arriving at it, including `0`.
- Going back to a pathway must bring its overlay with it.
- A pair listed twice, or listed both ways round, is one interaction.
- A self-interaction is one interaction, not two.
- Lower-case accessions must match a diagram that carries them upper-case.
- A protein drawn twice on one diagram carries two badges for the same
  interactions, and must not be counted twice.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The count beside a resource MUST be in the same unit as the badge
  on an entity — interactions.
- **FR-002**: A diagram tally MUST count each protein once, however many times it
  is drawn.
- **FR-003**: The count badge MUST NOT be drawn at a zoom where its digits cannot
  be read.
- **FR-004**: When badges exist but none can be drawn, the reader MUST be told,
  and offered a way to reach them.
- **FR-005**: The download MUST carry every interaction the opened entities hold,
  independent of the threshold.
- **FR-006**: The threshold MUST be remembered per resource.
- **FR-007**: A threshold or overlay named in the address MUST survive arriving
  at it, and MUST survive returning to it.
- **FR-008**: A file or pasted table MUST be read without leaving the browser
  unless the reader asks for a shareable link.
- **FR-009**: Resources MUST NOT be asked anything until the reader opens the
  panel.
- **FR-010**: Deleting a resource the reader added MUST remove it from the
  diagram as well as the list.
- **FR-011**: Both header controls MUST be operable from the keyboard, and MUST
  return focus when closed.

### Key Entities

- **Interaction**: a pair of accessions with a confidence score. Score is the
  only field that decides visibility.
- **Resource**: a named source of interactions — IntAct, a PSICQUIC service, or
  one the reader supplied.
- **Tally**: what a resource holds for one diagram, in both units —
  `interactions` and `entities`.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A reader can tell which of fourteen resources is worth choosing
  without choosing any of them.
- **SC-002**: Choosing a resource never leaves the screen unchanged and silent.
- **SC-003**: A reader who has never opened the interactors panel causes no
  interaction lookups at all.
- **SC-004**: A link shared by one reader opens the same overlay for another.
- **SC-005**: Moving the confidence control redraws the diagram without
  refetching.
- **SC-006**: Someone using only a keyboard can reach the overlay, choose a
  resource, and close the panel.

## Assumptions

- Curators compare this site against the old browser, so where the old browser
  made a defensible choice it is matched deliberately and the source is cited.
- An interaction with no confidence score is treated as below every threshold.
  None were seen in measured data; the rule exists so the absent case follows the
  weak case rather than being waved through.
- Interaction data is third-party and changes. Tests therefore assert invariants
  and relationships, not the particular numbers recorded here.
