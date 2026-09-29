# Feature Specification: Embeddable Reactome pathway diagram

**Feature Branch**: `embeddable-diagram`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "Embeddable Reactome pathway diagram for other websites." Other sites (AllianceGenome, PubChem, the curator tool) show Reactome diagrams and need a supported way to do it from this codebase. AllianceGenome loads the old diagram widget script and calls its `create` and `loadDiagram`; PubChem shows snapshot images and links to the Pathway Browser; the curator tool embeds an Angular library (out of scope here).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A partner site shows a live pathway diagram (Priority: P1)

A developer at a partner resource (for example a model-organism or chemistry database) wants a live, interactive Reactome pathway diagram on one of their pages -- a gene page's "Pathways" tab -- without adopting Reactome's framework or running a proxy. They add one script tag from Reactome and one element naming the pathway. Their page's visitors see the diagram and can zoom, pan, hover and select in it, while the rest of the host page, its address bar and its styling are untouched.

**Why this priority**: It is the thing the partners are asking for (AllianceGenome's code asks for exactly this), it replaces a widget built on technology Reactome is retiring, and every other story builds on it.

**Independent Test**: A plain HTML page served from a different origin than Reactome, with only the script and one element naming a pathway, shows that pathway's diagram and responds to zoom, pan, hover and select -- and the page's URL, title, scroll and styles are unchanged.

**Acceptance Scenarios**:

1. **Given** a host page on another origin with the script and an element naming a pathway, **When** the page loads, **Then** that pathway's diagram is drawn inside the element's box, at the size the host gave it.
2. **Given** a drawn diagram, **When** the visitor zooms, pans, hovers or selects an entity, **Then** the diagram responds as it does on Reactome's own site, and the host page's address, history and scroll position do not change.
3. **Given** the host changes which pathway the element names, **When** the change is made, **Then** the new pathway replaces the old one without the page reloading.
4. **Given** a host page with its own styles and another front-end framework on it, **When** the diagram loads, **Then** neither page's styles change the other's appearance, and both keep working.
5. **Given** the pathway cannot be loaded (an unknown identifier, or the service unreachable), **When** the element tries, **Then** it shows a short message in its box saying so, and the host page carries on.

---

### User Story 2 - A partner site highlights what its visitor is looking at (Priority: P2)

On a gene page, the partner wants the visitor's gene to stand out in the pathway: flagged, or selected, or with an analysis result overlaid. They set it on the element (or call it from their code), and they are told when the diagram has loaded or the visitor selects something, so their page can react -- for example by showing details of the selected entity.

**Why this priority**: It turns "a picture of a pathway" into "where your gene is in this pathway", which is the reason a gene page shows it -- but the diagram alone (Story 1) is already worth shipping.

**Independent Test**: On the same plain host page, naming a pathway and a gene to flag makes that gene's entities stand out; naming an entity to select selects it; the host receives a "loaded" notice with the pathway's identifier and a "selected" notice with the selected entity's identifier when the visitor clicks one.

**Acceptance Scenarios**:

1. **Given** an element naming a pathway and a term to flag, **When** the diagram loads, **Then** the entities matching that term are flagged exactly as the Pathway Browser flags them.
2. **Given** an element naming an entity to select, **When** the diagram loads, **Then** that entity is selected and in view.
3. **Given** an analysis result identifier, **When** it is set, **Then** the diagram shows that analysis overlay, and clearing it removes the overlay.
4. **Given** a host listening for notices, **When** the diagram finishes loading or the visitor selects or hovers an entity, **Then** the host is told, with the pathway's or the entity's stable identifier.
5. **Given** a flag, selection or analysis is set, **When** the host clears it, **Then** the diagram returns to its unflagged, unselected, unanalysed state.

---

### User Story 3 - A site on the old widget switches by changing one address (Priority: P2)

A site already uses Reactome's old diagram widget and its documented programming interface (create a diagram in a placeholder, load a pathway, select, flag, set an analysis, listen for loaded / selected / hovered). Its developers change only the script address to the new one, and their page keeps working, now drawn by the new diagram.

**Why this priority**: AllianceGenome's integration is exactly this interface, and the old widget will not be maintained; making the switch a one-line change is what gets partners onto the supported diagram. It depends on Story 1 (and on Story 2 for everything past loading a pathway).

**Independent Test**: A copy of AllianceGenome's integration -- create a diagram in a named placeholder with a width and height, then load a pathway -- works unchanged against the new script; so does each documented method and notice, one at a time, on a test page.

**Acceptance Scenarios**:

1. **Given** a page that calls the old interface's "create in placeholder at width × height" and then "load this pathway", **When** it runs against the new script, **Then** the diagram appears in the placeholder at that size.
2. **Given** each documented method (select, flag, highlight, set analysis, resize, and the resets), **When** it is called, **Then** it has the effect the old documentation describes.
3. **Given** each documented notice (loaded, selected, hovered, flags reset, analysis reset), **When** its event happens, **Then** the registered handler is called with what the old documentation says it receives.
4. **Given** a page that polls for the old interface to appear before using it (as AllianceGenome's does), **When** the new script loads, **Then** the interface is there under the same name.

---

### User Story 4 - The images and links partners already use keep working (Priority: P3)

Partners that do not embed the live diagram rely on Reactome's image addresses (a reaction's or pathway's diagram as an image) and on links into the Pathway Browser in the old address form. Those keep answering, with an image of the right kind and a page on the right pathway.

**Why this priority**: Nothing new is built for it -- it is protecting what partners already depend on while the site is replaced -- so it is a guard rather than a feature.

**Independent Test**: The image addresses AllianceGenome's reactions tab and PubChem's diagrams use return an image of the stated format for a known reaction and pathway; the old-form Pathway Browser link for a known pathway opens that pathway.

**Acceptance Scenarios**:

1. **Given** a reaction's or pathway's image address in the form partners use, **When** it is requested, **Then** an image in the requested format is returned, not an error page.
2. **Given** an old-form Pathway Browser link to a pathway, **When** it is followed, **Then** the Pathway Browser opens on that pathway.

---

### Edge Cases

- The host page gives the element no size, or a size of zero: it takes a sensible default size rather than drawing nothing.
- Two or more diagrams on one page: each works independently; selecting in one does not select in another.
- The element is removed from the page and re-added (common in single-page host apps): it cleans up after itself and draws again when re-added, without leaking or erroring.
- The script is loaded twice, or after the host already defined something with the same name: it does not break the page; the second load is harmless.
- The pathway named has no diagram of its own (a reaction, or a sub-pathway drawn in its parent): it shows the diagram that contains it, as the Pathway Browser does, or says it has none.
- The visitor's browser cannot draw it: a short message in the box, and the old interface's "cannot draw" notice.
- A host page with strict security settings that restrict where scripts and data may come from: the requirements for allowing it are documented.
- The host page is in a dark colour scheme: the diagram follows the scheme the host asks for, defaulting to light.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Reactome MUST provide a single script that, added to any web page, lets that page place a live pathway diagram with one element naming the pathway -- with no Reactome framework, build step or proxy required on the host.
- **FR-002**: The diagram MUST support the interactions the Pathway Browser's diagram supports for viewing: zoom, pan, fit, hover and select. Editing is not in scope.
- **FR-003**: The diagram MUST NOT read or change the host page's address, history, title or scroll position, and MUST NOT change the appearance of anything outside its own box; the host's styles MUST NOT change the diagram's appearance.
- **FR-004**: The diagram MUST work when the host page is on a different origin from Reactome, without the host proxying requests.
- **FR-005**: The host MUST be able to set, change and clear, both declaratively on the element and from its own code: the pathway shown, the entity selected, the term flagged, and the analysis result overlaid.
- **FR-006**: The diagram MUST notify the host when a pathway has loaded, when the visitor selects or hovers an entity, and when flags or an analysis are cleared -- each with the relevant stable identifier.
- **FR-007**: The diagram MUST show a short, readable message in its box when a pathway cannot be shown, and MUST NOT stop the rest of the host page working.
- **FR-008**: Several diagrams on one page MUST work independently of each other.
- **FR-009**: Reactome MUST provide the old diagram widget's documented programming interface -- creating a diagram in a placeholder at a size, its methods and its notices -- under the same name, backed by the new diagram, so a site using it can switch by changing only the script address.
- **FR-010**: The script MUST be built and checked automatically on every change to the codebase, so it cannot stop building unnoticed.
- **FR-011**: A demonstration page MUST show the diagram embedded as a partner would embed it, and the automated checks MUST exercise it on a page of a different origin from the diagram's data.
- **FR-012**: The image addresses and old-form Pathway Browser links that partners use MUST keep working, and the automated checks MUST cover them.
- **FR-013**: How to embed the diagram -- the script address, the element, its settings, its notices, the old-interface compatibility, and what a strict-security host must allow -- MUST be documented for partner developers.
- **FR-014**: Loading the script MUST NOT download the whole Reactome website; it carries only what the diagram needs.

### Key Entities

- **Embedded diagram**: one diagram on a host page. Has a pathway shown, and optionally a selected entity, a flag term and an analysis result; emits loaded / selected / hovered / cleared notices.
- **Old-interface diagram**: the object the old widget's "create" returned; the same diagram, driven by method calls and handler registration instead of element settings.
- **Partner image address / deep link**: the public addresses partners store or link to -- a pathway's or reaction's image in a format; a pathway's page in the Pathway Browser.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A developer can put a working live diagram on a blank page of their own with two lines -- one script, one element -- following the documentation, in under 10 minutes.
- **SC-002**: AllianceGenome's existing integration works unchanged except for the script address, shown on a test page reproducing it.
- **SC-003**: Every method and notice of the old documented interface has an automated check, and all pass.
- **SC-004**: On a host page, the diagram's first draw of a typical pathway takes no longer than the same pathway takes to draw in the Pathway Browser, and the script downloads in less than a third of the full site's size.
- **SC-005**: With the diagram on the page, the host page's address, history length and scroll position are identical before and after every interaction the checks perform, and a host style rule aimed at common elements does not change the diagram's appearance.
- **SC-006**: A change that breaks the script's build is caught by the automated checks before it can be merged.
- **SC-007**: The partner image addresses and old-form links in use answer correctly for known examples in the automated checks.

## Assumptions

- The live diagram is for viewing. Editing (which the curator tool does, through its own Angular library) is out of scope; that tool's needs are a follow-up with its owners.
- The script is served from Reactome at a new, stable address. Replacing the old widget at its old address -- so that sites switch without changing anything -- is a decision for Reactome's release process and a later step, not part of this feature.
- The diagram reads its data from Reactome's public services and download host, which answer cross-origin requests; if any does not, making it do so is part of this work.
- Publishing to a package registry is a later step; this feature makes the script publishable (self-contained, versioned) without publishing it.
- The diagram starts in the light colour scheme and follows the host's choice when told.
- Species is taken from the pathway named, as the old widget did; a separate species setting is not needed.
- The headless render service already provides the image addresses; this feature adds checks for them rather than new rendering.
