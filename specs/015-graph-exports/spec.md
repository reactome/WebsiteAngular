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

Each exporter reads the graph and lives in its own repository: `reactome/sbml-exporter` for SBML, and `reactome/BioPAX3Exporter` for BioPAX Level 3. Both are Java-based (Java and Kotlin). The website's on-demand exports are served by the Java library service that spec 010 already plans for the operations that stay in Java, SBML among them. It lives in its own repository, licensed AGPL-3.0, and is reached only through the node service.

What the first version produced is kept and used as the instruments for proving the exporters:

- the 30-event sample ([sample.md](sample.md));
- the SBML reference harness, which found the graph-only converter's defects ([reference-harness.md](reference-harness.md));
- today's answers from the beta host ([today.md](today.md));
- the BioPAX mapping ([data-model.md](data-model.md));
- the comparison and validator decisions ([research.md](research.md) R1, R3–R5, R8).

## Context (measured; research R1, R4, R9)

- **Two exports still read the relational release database.** Every other export, and every endpoint the node service answers, reads the graph.
- **SBML.** The bulk files (`all_species.3.1.sbml.tgz` and `homo_sapiens.3.1.sbml.tgz`) and the website's `/ContentService/exporter/event/{id}.sbml` both come from `sbml-exporter`'s relational converter:
  - the release run uses the exporter's own command line, which requires the relational database;
  - the website uses the same converter inside the Java ContentService.

  The exporter also has a graph-only converter, which reads nothing relational, but, as far as the code shows, it has not run in production or in a release. This spec's reference harness has run it. It has five measured defects (R1, R9), and it has no tests. The relational converter's layout is drawn from the relational database's diagram.

- **BioPAX.** Two separate code paths, both relational:
  - **The bulk files** (`biopax.zip`, Level 3, and `biopax2.zip`, Level 2; one `.owl` per species) are made by `release-download-directory`, through Pathway-Exchange's species converters.
  - **The website's per-event file** comes from the legacy RESTful service, through Pathway-Exchange's event converter. On beta it is served by that service on the same host (#634).

  `BioPAX3Exporter` reads the graph and writes Level 3. As far as its code shows, it has not made the published files. It covers far less than today's files:
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

  Retiring it means re-homing or dropping each of them, not only BioPAX. Some already have graph-based counterparts in `reactome/data-export`, which makes the download page's mapping files with Cypher (R9).

- **Release 97's published `biopax.zip` is Pathway-Exchange's output** (its `xml:base` and its content are that converter's), so it is the reference BioPAX3Exporter is proven against (R9).

## User Scenarios & Testing _(mandatory)_

The people served are:

- researchers who download a pathway, a reaction or a whole species to use in another tool;
- the people who run a release;
- the people who deploy the site.

### User Story 1 - SBML from the graph, one exporter for the download page and the website (Priority: P1)

A researcher downloads SBML for one pathway or reaction from the website, or the whole set from the download page. Either way the file comes from the same exporter, reading the graph. It has the same model as today, its species, reactions, compartments, identifiers and annotations, and a layout drawn from the diagram the website shows. Making it needs no relational database.

**Why this priority**: the model has a reference to match (today's relational file of the same release), and the exporter already has a graph-only half. It is the smaller of the two proofs, and it retires the relational database from both the release's SBML and the website's.

**Independent Test**:

- **The model.** For the 30-event sample, the exporter's model matches today's relational file element by element, element order and the generation note's timestamp aside.
- **The layout.** It matches today's by meaning (R3).
- **The bulk run.** With no relational database configured, it produces the same set of files under the same names as the release's published archives in its download directory (`download.reactome.org/{release}/`), and a sample of its files compares with theirs.
- **Validity.** Every file passes the SBML consistency check.
- **On the website.** The site's SBML URL answers from the same exporter.

**Acceptance Scenarios**:

1. **Given** a pathway or a reaction, **When** the exporter writes its SBML, **Then** its model matches today's relational file element by element, apart from element order, the generation note's timestamp and recorded differences.
2. **Given** a pathway with its own diagram drawing a reaction, **When** its SBML is written, **Then** the layout places and connects every element today's does, with the same identifiers, roles and order, at the diagram's own coordinates.
3. **Given** a release, **When** the bulk SBML is made with no relational database, **Then** both archives hold the same file names as that release's published archives, and every file is valid.
4. **Given** the website's SBML link, **When** it is followed, **Then** the status, content type, file name and errors are today's, and the file is the exporter's.

---

### User Story 2 - BioPAX Level 3 from the graph, one exporter for the download page and the website (Priority: P2)

A researcher downloads BioPAX Level 3 for one pathway or reaction from the website, or a species' file from the download page. Both come from the same exporter, reading the graph. They describe what today's files describe: entities and their references, stoichiometry, compartments, controllers, regulation and literature.

**Why this priority**: there is no exact reference, only today's files, built differently and compared by meaning. And the exporter needs most of its content built before a comparison can pass.

**Independent Test**:

- **Per event.** For the sample, the exporter's file and the legacy service's file are compared by meaning, as canonical (class, property, target) triples. Every difference is either none, or one recorded and accepted here.
- **Per species, the main proof.** The exporter's species files are compared, by the same triples, with the species files of the release's published `biopax.zip`, from the release's download directory (`download.reactome.org/{release}/`), for the same release's graph: first three species, then all of them.
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
- **BioPAX Level 2 is no longer produced** (decided with the user, 24 Oct 2026). `biopax2.zip` is not carried forward: the release drops its Level 2 step, and nothing on the site links Level 2.

## Requirements _(mandatory)_

### Functional Requirements

**SBML (`reactome/sbml-exporter`)**

- **FR-001**: The graph-only converter MUST be corrected: the five defects (R1, R9) fixed, with tests that fail without each fix. With those fixes it is the SBML model for both the bulk files and the website.
- **FR-002**: Its model MUST match today's relational file of the same release (R1) for every event in the sample, element by element (compartments, species, reactions, participants with role and stoichiometry, names, SBO terms, notes, annotations and identifier URLs), apart from element order, the generation note's timestamp and what the layout changes in the model (the drawn species' SBO terms, and the root's `layout:required` and layout namespace; R3), or each difference recorded with its reason.
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
- **FR-007**: Its species files MUST have the published form: `xml:base="http://www.reactome.org/biopax/{release}/{species dbId}#"`, as release 97's `biopax.zip` has (and the release's check requires), and the names `{Species_Name}.owl` (R9).

**Both exporters**

- **FR-008**: Each MUST pass its format's validator over the sample, in its own repository's continuous integration if possible, and otherwise in this repository's.
- **FR-009**: Each MUST be proven against its reference by the comparison tools of this spec (contracts/checks.md) before either the bulk files or the website switch to it.
- **FR-010**: Work in another team's repository MUST go to its maintainers first: an issue describing the change, then pull requests once they agree. Nothing is pushed to those repositories without that agreement.

**The website**

- **FR-011**: The website's SBML URL and a BioPAX URL MUST be answered by the exporters, through spec 010's Java library service, fronted by node. They MUST be routed in nginx and the dev proxy alike, with no fallback to the Java ContentService or the legacy service. When the library service cannot answer, node answers 503 in the service's envelope.
- **FR-012**: The site's two BioPAX links MUST point to the new URL, and the legacy link form MUST lead to it.
- **FR-013**: Both on-demand exports MUST be cached and labelled under spec 011's rules, and limited as the service's other deep work is.
- **FR-014**: Verification against the shared graph MUST be small, sequential and spaced. References MUST come from a private copy of the release's graph (R8); only if that copy cannot start may small, spaced runs against the shared graph be used, and the fallback is recorded.

### Key Entities

- **Exporter**: the one implementation of a format, used by both the bulk run and the website. `sbml-exporter` for SBML, `BioPAX3Exporter` for BioPAX Level 3.
- **Event**: a pathway or a reaction. It is what one on-demand file describes.
- **Species file**: one species' whole BioPAX, or the set of per-event SBML files in an archive.
- **Reference**: what an exporter is compared with:
  - for SBML's model, today's relational file (element by element);
  - for SBML's layout, today's layout (by meaning);
  - for BioPAX, today's Pathway-Exchange files (by meaning): the release's published `biopax.zip` for the species files, and the legacy service's answer for one event.
- **Accepted difference**: a recorded way the new output may differ from its reference, with the reason. Nothing switches until every difference found is recorded.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The SBML and BioPAX Level 3 bulk files, and the website's two exports, are made without the relational database. Today, all four need it.
- **SC-002**: For SBML, 100% of the 30-event sample matches the reference exactly, apart from the layout, what the layout changes in the model (FR-002) and the generation note.
- **SC-003**: For both formats, every difference from the reference across the sample (and, for BioPAX, every species file of the release's published `biopax.zip`) is recorded and accepted, with none unexplained.
- **SC-004**: Both formats pass their validators with zero errors over the sample.
- **SC-005**: One implementation per format for what this spec switches: the website's two exports, the release's SBML archives and its Level 3 `biopax.zip` each come from the one exporter. (Level 2, and any copy outside this project's deployments, are outside this measure.)
- **SC-006**: An on-demand download asked for before, in the same release, is answered as fast as today's (Signal Transduction's 23.5 MB SBML from Java's cache: 0.05 s and 0.14 s in two measurements, today.md and R6). A first download of the largest pathway in the sample completes within the service's limits for deep work.

## Assumptions

- **Repositories.**
  - SBML stays in `reactome/sbml-exporter`. It already holds the graph-only converter, and a new repository would split its history.
  - BioPAX Level 3 is `reactome/BioPAX3Exporter`.
  - Either moves elsewhere only if its maintainers prefer.
- **One library per format.** Each exporter's repository becomes a library module, which this stack uses, and a thin command line, which the release uses (R10).
- **The website's service** is spec 010's Java library service (R10). Its SBML operation moves from the relational converter to the graph-only one, and it gains BioPAX Level 3. It pins one graph-core version, so both exporters must work with that version. Node fronts it through spec 010's pass-through, so nothing routes to the Java ContentService for these formats.
- **BioPAX's URL** is `/ContentService/exporter/event/{id}.biopax`, as the first version decided (R6). The legacy path redirects to it.
- **Order of work.**
  1. SBML: the exporter's fixes and tests, then its layout, then the comparisons; then the website and the release switch, each only after the comparisons pass (FR-009).
  2. BioPAX: the content, then the comparisons; then the website and the release switch, likewise.

  Each exporter's changes go through its maintainers (FR-010).

- **Out of scope:**
  - SBGN, which is already built from the graph and the diagram files;
  - BioPAX Level 2, which is dropped (see Edge Cases);
  - `release-download-directory`'s other steps. They are listed in R9 for whoever retires it; this spec retires only its BioPAX steps;
  - the analysis exports;
  - any change to the graph's schema.
- **This repository is public.** No internal host names, paths or incident detail.
