# Feature Specification: SBML and BioPAX from the graph, one exporter each for the download page and the website

**Feature Branch**: `spec/015-graph-exports`

**Created**: 2026-10-23 (rewritten 2026-10-24)

**Status**: Draft

**Input**: User description: "BioPAX and SBML generation moved to the Neo4j graph. They would have their own individual repos, used to generate the bulk files and organised with shared components for the code that generates them on the website on the fly. We want to get rid of release-download-directory at some point. Nothing is set in stone. We would retire old repos when they are no longer being used." Issues #631 (BioPAX) and #632 (SBML).

## What changed on 24 Oct 2026

The first version of this spec (23 Oct) had the node content service write both formats in TypeScript, for the website only, with the bulk files on the download page out of scope. That left the bulk files on separate code, reading the relational database, so the two would drift.

This version makes **one exporter per format the single implementation for both**:

- the bulk files the download page offers, made at release time;
- the files the website makes on demand for one pathway or reaction.

Each exporter reads the graph and lives in its own repository: `reactome/sbml-exporter` for SBML, and `reactome/BioPAX3Exporter` for BioPAX Level 3. Both are Java-based (Java and Kotlin), so the website's on-demand exports are served by a small Java service that this repository runs, behind the node service, as the render service already is.

What the first version produced is kept and used as the instruments for proving the exporters:

- the 30-event sample ([sample.md](sample.md));
- the corrected SBML reference and its harness ([reference-harness.md](reference-harness.md));
- today's answers from the beta host ([today.md](today.md));
- the BioPAX mapping ([data-model.md](data-model.md));
- the comparison and validator decisions ([research.md](research.md) R1, R3–R5, R8).

## Context (measured; research R1, R4, R9)

- **Two exports still read the relational release database.** Every other export, and every endpoint the node service answers, reads the graph.
- **SBML.** The bulk files (`all_species.3.1.sbml.tgz` and `homo_sapiens.3.1.sbml.tgz`) and the website's `/ContentService/exporter/event/{id}.sbml` both come from `sbml-exporter`'s relational converter:
  - the release run uses the exporter's own command line, which requires the relational database;
  - the website uses the same converter inside the Java ContentService.

  The exporter also has a graph-only converter, which reads nothing relational, but nothing has ever run it. It has five measured defects (R1, R9), and it has no tests. The relational converter's layout is drawn from the relational database's diagram.

- **BioPAX.** Two separate code paths, both relational:
  - **The bulk files** (`biopax.zip`, Level 3, and `biopax2.zip`, Level 2; one `.owl` per species) are made by `release-download-directory`, through Pathway-Exchange's species converters.
  - **The website's per-event file** comes from the legacy RESTful service, through Pathway-Exchange's event converter. On beta it is served by that service on the same host (#634).

  `BioPAX3Exporter` reads the graph and writes Level 3. It has never been used. It covers far less than today's files:
  - no entity references or cross-references;
  - no stoichiometry, catalysis controllers, regulation or literature;
  - no complex components or locations;
  - evidence objects that are empty.

  Its event-list mode writes an empty pathway, and it cannot export a reaction on its own.

- **`release-download-directory` does more than BioPAX.** Eight other steps also read the relational database:
  - database dumps;
  - the GSEA gene sets and the BioSystems export, both through Pathway-Exchange;
  - the Protégé ontology files;
  - the stable-identifier mapping;
  - the GO annotation file;
  - two optional lists.

  Retiring it means re-homing or dropping each of them, not only BioPAX.

## User Scenarios & Testing _(mandatory)_

The people served are:

- researchers who download a pathway, a reaction or a whole species to use in another tool;
- the people who run a release;
- the people who deploy the site.

### User Story 1 - SBML from the graph, one exporter for the download page and the website (Priority: P1)

A researcher downloads SBML for one pathway or reaction from the website, or the whole set from the download page. Either way the file comes from the same exporter, reading the graph. It has the same model as today, its species, reactions, compartments, identifiers and annotations, and a layout drawn from the diagram the website shows. Making it needs no relational database.

**Why this priority**: the model has an exact reference (the corrected graph-only converter, already built), and the exporter already has a graph-only half. It is the smaller of the two proofs, and it retires the relational database from both the release's SBML and the website's.

**Independent Test**:

- **The model.** For the 30-event sample, the exporter's model is byte-identical to the corrected reference, generation note aside.
- **The layout.** It matches today's by meaning (R3).
- **The bulk run.** It produces the same set of files under the same names as today's, with no relational database configured.
- **Validity.** Every file passes the SBML consistency check.
- **On the website.** The site's SBML URL answers from the same exporter.

**Acceptance Scenarios**:

1. **Given** a pathway or a reaction, **When** the exporter writes its SBML, **Then** everything but the layout and the generation note is byte-identical to the corrected reference.
2. **Given** a pathway with its own diagram drawing a reaction, **When** its SBML is written, **Then** the layout places and connects every element today's does, with the same identifiers, roles and order, at the diagram's own coordinates.
3. **Given** a release, **When** the bulk SBML is made with no relational database, **Then** both archives hold the same file names as the previous release's run would, and every file is valid.
4. **Given** the website's SBML link, **When** it is followed, **Then** the status, content type, file name and errors are today's, and the file is the exporter's.

---

### User Story 2 - BioPAX Level 3 from the graph, one exporter for the download page and the website (Priority: P2)

A researcher downloads BioPAX Level 3 for one pathway or reaction from the website, or a species' file from the download page. Both come from the same exporter, reading the graph. They describe what today's files describe: entities and their references, stoichiometry, compartments, controllers, regulation and literature.

**Why this priority**: there is no exact reference, only today's files, built differently and compared by meaning. And the exporter needs most of its content built before a comparison can pass.

**Independent Test**:

- **Per event.** For the sample, the exporter's file and the legacy service's file are compared by meaning, as canonical (class, property, target) triples. Every difference is either none, or one recorded and accepted here.
- **Per species.** The same comparison is made for a few species' files against Pathway-Exchange's species output.
- **Validity.** Every file passes the BioPAX validator.

**Acceptance Scenarios**:

1. **Given** a pathway or a reaction, **When** the exporter writes it, **Then** every pathway, reaction, physical entity, entity reference, cross-reference, stoichiometry, compartment, control and citation in today's file is in it, apart from the recorded, accepted differences.
2. **Given** a species, **When** the exporter writes its bulk file, **Then** it holds each of the species' pathways once, and the events in no pathway as today's file does, under the same file name, with an `xml:base` the release's own check accepts.
3. **Given** either BioPAX link on the website, **When** it is followed, **Then** it delivers the exporter's file, never an HTML page. The legacy link form leads to it too.

---

### User Story 3 - The broken BioPAX link fixed now (Priority: P1) — done

On beta, the BioPAX links deliver BioPAX from the host's own legacy service, routed in #634, until User Story 2 replaces it.

---

### User Story 4 - The relational database no longer needed for these formats (Priority: P3)

The people who run a release can make the SBML and BioPAX bulk files without the relational database. Once nothing uses the old code paths, their owners can retire them:

- the BioPAX steps in `release-download-directory`;
- the relational half of `sbml-exporter`;
- the legacy RESTful service's BioPAX.

**Independent Test**: a release run makes both formats' bulk files from the graph alone, and the website's two exports answer with the relational database unreachable.

### Edge Cases

- **A pathway with no diagram of its own, and a reaction.** Today's SBML gives them no layout. So does the new one (R3).
- **Elements the diagram draws differently from the model**, such as an entity drawn twice, or a compartment drawn but unused. These are laid out as today's layout lays them out.
- **Coordinates Java changed with font metrics** (`tightNodes`), and label sizes. They are not stored anywhere, so they differ. Each is recorded and accepted (R3).
- **A reaction's SBML model.** The graph-only converter names the reaction's first parent pathway, where today's says "no parent pathway". The graph-only form is kept, and the difference recorded.
- **BioPAX ids and order.** Today's are run counters in an order that cannot be reproduced. The new ones may differ. The comparison is by content (R4).
- **What the graph does not hold:**
  - several EC numbers on one molecular function;
  - a book chapter's authors.

  Each is a recorded difference, unless the graph gains it.

- **Species files and sub-pathways.** Each pathway appears once in a species' file, not once per pathway that contains it. The events in no pathway are included, as today.
- **Very large exports** (a top-level pathway with thousands of reactions, a species' whole file). The bulk run finishes within the release's time. The website's on-demand export stays within the service's limits for deep work, without failing other requests.
- **Personal names** (SBML creators, BioPAX authors and curation comments) are in both formats, as today. Nothing in this repository holds them: fixtures replace them and comparisons hash them (R8).
- **BioPAX Level 2.** Not carried forward, unless the download figures show it is still fetched. The decision is recorded in this spec before `biopax2.zip` stops.

## Requirements _(mandatory)_

### Functional Requirements

**SBML (`reactome/sbml-exporter`)**

- **FR-001**: The graph-only converter MUST be corrected: the five defects (R1, R9) fixed, with tests that fail without each fix. With those fixes it is the SBML model for both the bulk files and the website.
- **FR-002**: Its model MUST be byte-identical to the corrected reference (R1) for every event in the sample, generation note aside.
- **FR-003**: It MUST write the layout from the diagram files the site draws (R3), for the events that have one today and only those. It MUST place and connect the same elements, with the same identifiers, roles and order, as today's layout. Coordinate differences are recorded and accepted (R3).
- **FR-004**: Its command line MUST make the bulk files with no relational database. The relational options become unnecessary, and the file names and archives stay today's.

**BioPAX (`reactome/BioPAX3Exporter`)**

- **FR-005**: It MUST write what today's Level 3 files hold, as [data-model.md](data-model.md) maps them from the graph:
  - entity references and cross-references;
  - stoichiometry;
  - catalysis with its controller, and regulation;
  - complex components and cellular locations;
  - literature and evidence.

  Each difference MUST be recorded and accepted here.

- **FR-006**: It MUST export a single pathway or reaction as a library call. Its species mode MUST write each pathway once and include the events in no pathway, as today's species files do. Its event-list mode MUST write the events it was given.
- **FR-007**: Its `xml:base` and file names MUST be accepted by the release's own checks.

**Both exporters**

- **FR-008**: Each MUST pass its format's validator over the sample, in its own repository's continuous integration if possible, and otherwise in this repository's.
- **FR-009**: Each MUST be proven against its reference by the comparison tools of this spec (contracts/checks.md) before either the bulk files or the website switch to it.
- **FR-010**: Work in another team's repository MUST go to its maintainers first: an issue describing the change, then pull requests once they agree. Nothing is pushed to those repositories without that agreement.

**The website**

- **FR-011**: The website's SBML URL and a BioPAX URL MUST be answered by the exporters, through a service this repository runs. They MUST be routed in nginx and the dev proxy alike, with no fallback to the Java ContentService or the legacy service.
- **FR-012**: The site's two BioPAX links MUST point to the new URL, and the legacy link form MUST lead to it.
- **FR-013**: Both on-demand exports MUST be cached and labelled under spec 011's rules, and limited as the service's other deep work is.
- **FR-014**: Verification against the shared graph MUST be small, sequential and spaced. References MUST come from the private copy of the release's graph (R8).

### Key Entities

- **Exporter**: the one implementation of a format, used by both the bulk run and the website. `sbml-exporter` for SBML, `BioPAX3Exporter` for BioPAX Level 3.
- **Event**: a pathway or a reaction. It is what one on-demand file describes.
- **Species file**: one species' whole BioPAX, or the set of per-event SBML files in an archive.
- **Reference**: what an exporter is compared with:
  - for SBML's model, the corrected graph-only converter (exact);
  - for SBML's layout, today's layout (by meaning);
  - for BioPAX, today's Pathway-Exchange files (by meaning).
- **Accepted difference**: a recorded way the new output may differ from its reference, with the reason. Nothing switches until every difference found is recorded.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The SBML and BioPAX Level 3 bulk files, and the website's two exports, are made without the relational database. Today, all four need it.
- **SC-002**: For SBML, 100% of the 30-event sample matches the reference exactly, apart from the layout and the generation note.
- **SC-003**: For both formats, every difference from the reference across the sample (and, for BioPAX, three species' files) is recorded and accepted, with none unexplained.
- **SC-004**: Both formats pass their validators with zero errors over the sample.
- **SC-005**: One implementation per format. No second copy of either format's conversion is left in use anywhere once the website and the release have switched.
- **SC-006**: An on-demand download asked for before, in the same release, is answered as fast as today's (0.1 s for Signal Transduction's 23.5 MB SBML). A first download of the largest pathway in the sample completes within the service's limits for deep work.

## Assumptions

- **Repositories.**
  - SBML stays in `reactome/sbml-exporter`. It already holds the graph-only converter, and a new repository would split its history.
  - BioPAX Level 3 is `reactome/BioPAX3Exporter`.
  - Either moves elsewhere only if its maintainers prefer.
- **The website's service.** A small Java service in this repository's compose runs both exporters behind node, as the render service runs the site's renderer. Node answers the URLs, so nothing routes to the Java ContentService for these formats. Both exporters must agree on one graph-core version, or run as two services (plan).
- **BioPAX's URL** is `/ContentService/exporter/event/{id}.biopax`, as the first version decided (R6). The legacy path redirects to it.
- **Order of work.**
  1. SBML: the exporter's fixes and tests, then its layout, then the bulk switch, then the website.
  2. BioPAX: the content, then the comparisons, then the bulk switch, then the website.

  Each exporter's changes go through its maintainers (FR-010).

- **Out of scope:**
  - SBGN, which is already built from the graph and the diagram files;
  - BioPAX Level 2 (see Edge Cases);
  - `release-download-directory`'s other steps. They are listed in R9 for whoever retires it; this spec retires only its BioPAX steps;
  - the analysis exports;
  - any change to the graph's schema.
- **This repository is public.** No internal host names, paths or incident detail. Maintainers are named by their public handles only where needed.
