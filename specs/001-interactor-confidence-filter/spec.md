# Feature Specification: Interactor confidence filtering and download

**Feature Branch**: `001-interactor-confidence-filter`

**Created**: 2026-09-10

**Status**: Draft

**Input**: Bring the old browser's interactor confidence slider and interactor download to this implementation. Both are recorded as **missing** in `RELEASE-TESTING.md:117-118` and `CURATOR-REPORT.md:225-229`.

## Why this exists

Two rows of the curator release checklist cannot be signed off, because the behaviour they describe does not exist here:

> Raising the confidence threshold reduces the interactors shown — **missing** — there is no confidence control in this UI, and no threshold concept in the interactor services or the URL state. The old browser has one.

> Interactor download — **missing** — no such control exists here.

A curator comparing the two sites finds interactors that cannot be narrowed and cannot be taken away. Every interaction carries a confidence score already — it is shown in the interactors table and returned by the interactor service — so what is missing is the ability to _act_ on it.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Narrow the interactors on the diagram to the ones worth trusting (Priority: P1)

A curator opens a pathway, clicks the interactor count on an entity, and the entity's interactors appear around it. Most are low-confidence and crowd the diagram. A confidence control appears beneath the diagram while interactors are shown; as they raise it, interactors below the cutoff leave the diagram and the remaining picture is the one they wanted to look at. Lowering it brings them back.

**Why this priority**: This is the row a curator is blocked on, and it is what makes the interactor overlay usable at all on a well-studied entity — 33 interactors on a single entity is common, and they overlap.

**Independent Test**: Open a pathway, show interactors for an entity known to have interactions across a range of scores, raise the threshold, and count the interactors actually present on the diagram before and after. Delivers the checklist row on its own, without the download existing.

**Acceptance Scenarios**:

1. **Given** interactors are shown for an entity, **When** the curator raises the threshold above the score of some of those interactors, **Then** exactly those interactors are no longer on the diagram and the rest remain.
2. **Given** the threshold has been raised so that some interactors are hidden, **When** the curator lowers it to zero, **Then** every interaction the resource returned is on the diagram.
3. **Given** no interactors are shown, **When** the curator looks beneath the diagram, **Then** there is no confidence control, because there is nothing for it to filter.
4. **Given** a threshold above every interactor's score, **When** it is applied, **Then** the diagram shows no interactors and says so, rather than appearing to have failed to load them.

---

### User Story 2 - Keep and share the view you narrowed to (Priority: P2)

Having narrowed the interactors to a threshold worth discussing, the curator copies the address and sends it to a colleague, or reloads the page. What opens is the view they narrowed to, not the unfiltered one.

**Why this priority**: A filtered view nobody else can see is half a feature, and the pathway browser's other state is already shareable this way — a threshold that lives only in the page is the odd one out. It is P2 because the filtering itself is what unblocks the checklist row.

**Independent Test**: Set a threshold, copy the address, open it in a new session, and count the interactors on the diagram — it matches what the first session was showing.

**Acceptance Scenarios**:

1. **Given** a threshold has been set, **When** the curator reloads the page, **Then** the same threshold is in force and the same interactors are shown.
2. **Given** an address that names a threshold, **When** it is opened fresh, **Then** the interactors shown are those at or above that threshold.
3. **Given** an address that names no threshold, **When** it is opened, **Then** the default of 0.45 applies — the same first view as the old browser — and the address is **not** rewritten to name it, because nobody chose it.

---

### User Story 3 - Take the interactors away (Priority: P3)

Beside the confidence control, the curator downloads the interactors currently shown, and gets a file they can open in a spreadsheet with the identifiers, species, evidence counts and scores.

**Why this priority**: The second blocked checklist row. Lower than the other two because it depends on there being a filtered set to export, and because the interactors are already readable in the details panel — the download is about getting them out, not seeing them.

**Independent Test**: Show interactors, download, and open the file: it lists exactly the interactors on the diagram, with their scores.

**Acceptance Scenarios**:

1. **Given** interactors are shown and a threshold is in force, **When** the curator downloads, **Then** the file contains exactly the interactors currently on the diagram — not the ones the threshold excluded.
2. **Given** a download is requested, **When** it is being prepared, **Then** the curator is told it is being prepared and told if it fails, rather than being handed a file that is silently incomplete.
3. **Given** the file has been opened in a spreadsheet, **When** the curator looks at it, **Then** each row identifies one interactor and carries its confidence score.

---

### Edge Cases

- **An entity with no interactors.** Showing interactors yields nothing; the confidence control must not appear, and this must be distinguishable from a failure to load.
- **Every interactor at the same score.** The control must still be usable, and must not present a range of zero width as a broken widget.
- **A threshold outside the range of the data**, whether from a hand-edited address or a stale shared link: it is clamped to something meaningful rather than showing an empty diagram with no explanation. Note that the 0.45 default is itself above some real scores — the entity measured had interactions at 0.482 and above, so a nearby entity may legitimately show none until the curator lowers it.
- **A nonsense threshold in the address** — a word, a negative number, a value above the maximum. It is ignored in favour of the 0.45 default, and does not prevent the pathway or its interactors from opening.
- **Interactors shown for more than one entity at once.** One threshold covers them all, since it belongs to the resource rather than to an entity.
- **The threshold changed while a download is being prepared.** The file must match one of the two states and say which, not a mixture.
- **A very large interactor set**, where filtering must not make the diagram unresponsive as the control is dragged.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: While interactors are shown on the diagram, the system MUST offer a confidence control beneath the diagram, positioned so it reads as belonging to the diagram rather than to the details panel.
- **FR-002**: The system MUST hide it whenever no interactors are shown.
- **FR-003**: Changing the threshold MUST add and remove interactors from the diagram to match, without the curator taking any further action.
- **FR-004**: An interactor MUST be shown when its confidence score is at or above the threshold, and hidden when it is below.
- **FR-004a**: The threshold MUST be held per interaction resource, as the old browser holds it. Switching resource MUST apply that resource's own threshold rather than carrying the previous one across, because a score from one resource does not mean the same as a score from another.
- **FR-005**: The system MUST show the curator the threshold currently in force, in the same units as the scores they see in the interactors table.
- **FR-006**: The threshold MUST be carried in the page address, so that reloading or sharing it reproduces the same set of interactors.
- **FR-007**: An address that names no threshold MUST apply the default of 0.45, and MUST NOT be rewritten to name it. Only a threshold the curator chose belongs in their address.
- **FR-008**: A threshold in the address that is absent, malformed or out of range MUST NOT prevent the pathway or its interactors from opening.
- **FR-009**: The system MUST offer a download of the interactors currently shown, beside the confidence control.
- **FR-010**: The download MUST contain exactly the interactors passing the threshold at the moment it was requested, each identified and carrying its confidence score.
- **FR-011**: The system MUST tell the curator while the download is being prepared, and MUST tell them if it fails rather than delivering a truncated file.
- **FR-012**: When the threshold excludes every interactor, the system MUST say that the threshold is hiding them, distinguishably from having none to show.
- **FR-013**: Clearing the interactors MUST remove the control and the download with them, and MUST remove the threshold from the address.

### Key Entities

- **Interaction**: one interactor of one entity. Carries an identifier, a gene name, a species, counts of the entities and evidence supporting it, and a **confidence score** — a number between 0 and 1, measured today as 0.482–0.98 across the 33 interactions of one entity.
- **Confidence threshold**: the lowest score a curator wants to see, per interaction resource. Part of the shareable state of the page; when the address names none, it is 0.45.
- **Interaction resource**: where the interactions come from — the static set, a PSICQUIC service, or a resource the curator uploaded. Already modelled here as `currentResource`. Each carries its own threshold.
- **Shown interactor set**: the interactions currently drawn on the diagram — those of the entities whose interactors were requested, at or above the threshold. This is what the download exports.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A curator can reduce a crowded interactor view to the high-confidence interactions and back, without leaving the diagram or reloading.
- **SC-002**: The number of interactors on the diagram equals the number at or above the threshold, for every threshold tested — verified by counting what is drawn, not by observing that the control moved.
- **SC-003**: An address carrying a threshold, opened fresh, shows the same interactors as the session it was copied from.
- **SC-004**: A downloaded file lists exactly the interactors that were on the diagram, and every row carries a score.
- **SC-005**: Dragging the control through its whole range keeps the diagram responsive, with no interaction taking longer than the diagram's other direct manipulations.
- **SC-006**: `RELEASE-TESTING.md:117` and `:118` move from **missing** to **auto**, each naming the spec that asserts it, and `CURATOR-REPORT.md` no longer lists either as a gap.
- **SC-007**: A curator comparing this site with the old browser on the same entity reaches the same conclusion about which interactions are well-supported.

## Assumptions

- **Scores are 0–1 and already available.** Measured today against the interactor service: one entity's 33 interactions scored 0.482 to 0.98. The interactors table already displays a `score` column, so no new data source is needed.
- **The threshold is per resource, not per entity and not global.** Read from the old browser's source rather than guessed: `InteractorsContent.java` holds `Map<String, Double> interactorsThreshold` keyed by resource. One control beneath the diagram, applying to every entity currently showing interactors from that resource.
- **The default is 0.45**, from `DEFAULT_SCORE` in the same file. So the first view already hides low-confidence interactions, exactly as the old browser's does — which is the behaviour a curator comparing the two sites expects. It is applied without being written into the address.
- **The download covers the shown set, not the whole database.** It is the diagram's export, so it follows the diagram.
- **A spreadsheet-openable text format is what curators want**, consistent with how the other tabular exports on this site behave. The exact format is a planning decision, not a requirement.
- **Existing behaviour is reused**: interactors already draw and clear on the diagram, and the entity menu already offers them. This feature adds a threshold and an export; it does not redesign how interactors are requested.
- **Dependency**: the interactor service must return a score for every interaction it returns. Interactions without one would need a stated rule; none were seen in the data measured.

## Resolved during specification

- **The old browser's default threshold is 0.45**, and thresholds are held per resource. Both were read from `reactome/pwp-diagram`, `src/main/java/org/reactome/web/diagram/data/InteractorsContent.java` — `DEFAULT_SCORE = 0.45` and `Map<String, Double> interactorsThreshold` keyed by resource — rather than guessed or inferred from the running site. This removed the only open question in this spec.
