# Feature Specification: SBML and BioPAX built from the graph

**Feature Branch**: `spec/015-graph-exports`

**Created**: 2026-10-23

**Status**: Draft

**Input**: User description: "Graph-based exports in TypeScript: SBML and BioPAX built from the Neo4j graph by the node content service, retiring the two exports that still read the relational (MySQL) release database." Issues #632 (SBML) and #631 (BioPAX). Decided on 23 Oct 2026: both exports keep being offered, built from the graph; in the node content service, since neither converter needs anything only Java has (measured, below); one spec for both, SBML first.

## Context (measured)

- **Only two exports still read the relational release database.** Every endpoint the node content service answers, and every other operation Java still answers, reads the graph (with the search index for search, and files for diagrams).
- **SBML** (`/ContentService/exporter/event/{id}.sbml`) is answered by Java's ContentService through `sbml-exporter`'s relational converter. The controller's own comment says the relational database is used "for the time being ... to export layout information". A graph-only converter exists in `sbml-exporter`; its call is commented out.
  - The answer is a 200 as `application/sbml+xml;charset=UTF-8` and a download named `{stId}.sbml`. It holds SBML Level 3 Version 1 with the layout package: 3,686 layout elements for R-HSA-69620, Cell Cycle Checkpoints.
  - It carries annotations: identifiers, creators and dates. Its notes include a generation timestamp, so no two answers are byte-identical. Answers are cached on disk by database version.
  - `sbml-exporter` (about 3,200 lines) uses its SBML library only to build and write the document. It uses no validation, units, rate laws or network; its terms come from a fixed table; its graph half reads with queries.
- **BioPAX Level 3 for one pathway or reaction** comes from the legacy RESTful service, which loads the event from the relational database and writes BioPAX as RDF/XML with a generic XML library (about 1,900 lines; no BioPAX library, no validator).
  - The site links it from two places: the Pathway Browser's download tab and the website's detail download bar.
  - **On beta the link is broken.** Nothing routes the legacy service's path, so the request falls to the site, which answers its own HTML page with a 200.
  - The `/data/discover` answer lists SBGN and BioPAX links on the same legacy service. They are Java's text, copied as it is.
- **A separate, unused BioPAX exporter** (a Kotlin project for the bulk files on the download page) exists. It is not this feature.

## User Scenarios & Testing _(mandatory)_

The people served are researchers who download a pathway or a reaction to use in another tool, and the people who deploy the site: the relational database stops being something the website needs.

### User Story 1 - SBML for a pathway or a reaction, from the graph (Priority: P1)

A researcher on a pathway's or a reaction's page downloads it as SBML and opens it in a modelling tool. The file has the same model as today, the same species, reactions, compartments, identifiers and annotations. It has a layout drawn from the same diagram the website shows. Nothing about it depends on the relational database.

**Why this priority**: the model part has an exact reference to compare with, the graph-only converter, so it proves the approach cheaply; and it removes the one relational dependency the Java services still had.

**Independent Test**: for a sample of pathways and reactions, the new answer's model matches the reference byte for byte, generation timestamp aside. Its layout matches today's by meaning. The file passes the SBML consistency check, and the URL is answered by the node service with no relational database configured.

**Acceptance Scenarios**:

1. **Given** a pathway or a reaction, **When** its SBML is downloaded, **Then** the status, content type and file name are today's, and everything but the layout and the generation note is byte-identical to the graph-only reference's.
2. **Given** a pathway with a diagram, **When** its SBML is downloaded, **Then** the layout places every species, compartment and reaction that today's layout places, at the diagram's own coordinates, and connects each reaction to the same participants in the same roles.
3. **Given** an identifier that is no event, or a malformed one, **When** its SBML is asked for, **Then** the answer is the one Java gives today for it, errors included.
4. **Given** a sample of pathways and reactions, **When** their SBML goes through the format's consistency check, **Then** none has an error.

---

### User Story 2 - BioPAX for a pathway or a reaction, from the graph, and a link that works (Priority: P2)

A researcher downloads a pathway or a reaction as BioPAX Level 3 from either download link on the site and gets a BioPAX file, never the site's own page. It describes the same entities, references, stoichiometry, compartments and literature as the file the legacy service builds today.

**Why this priority**: the link is broken on beta today. But this export has no exact reference: only today's file, built differently, to compare with by meaning. So it comes second, once SBML has proved the approach.

**Independent Test**: for a sample of pathways and reactions, the new file and today's are compared element by element, and every difference is either none or one this spec's record accepts. The file passes the BioPAX validator. Both download links on the site deliver it.

**Acceptance Scenarios**:

1. **Given** a pathway or a reaction, **When** its BioPAX is downloaded, **Then** it is BioPAX Level 3, and every pathway, reaction, physical entity, reference, stoichiometry, compartment and citation in today's file is in it, apart from the recorded, accepted differences.
2. **Given** either download link on the site, **When** it is followed, **Then** it delivers the BioPAX file, not an HTML page.
3. **Given** the legacy link in the form a person or another site may still hold, **When** it is followed, **Then** it reaches the new file.
4. **Given** a sample of pathways and reactions, **When** their BioPAX goes through the BioPAX validator, **Then** none has an error.

---

### User Story 3 - The broken BioPAX link fixed now (Priority: P1)

Until User Story 2 is done, a researcher who follows a BioPAX link on beta never receives the site's HTML page under a BioPAX name. They get a working file, or the link is not offered.

**Why this priority**: it is broken today, and a fix does not need to wait for the export.

**Independent Test**: on beta, both BioPAX links deliver a BioPAX file or are absent, and the legacy path no longer answers the site's page.

**Acceptance Scenarios**:

1. **Given** beta before User Story 2 ships, **When** either BioPAX link is followed, **Then** it delivers BioPAX or is not offered, never the site's page with a 200.

### Edge Cases

- **A pathway with no diagram of its own**, drawn on its parent's diagram, and a reaction. Today their SBML carries no layout at all: the layout is taken only from the event's own diagram, and only when that diagram draws at least one reaction (measured: R-HSA-69481 and R-HSA-69562 have none). The new export does the same.
- **A diagram element with no counterpart in the model**, such as a compartment drawn but not used, or one entity drawn twice. It is laid out as today's layout lays it out, whether that is once, twice or not at all.
- **What the layout changes in the model.** Writing the layout also sets each drawn species' SBO term from how it is drawn (a complex drawn is SBO:0000297, where the model alone says SBO:0000253), and adds the layout namespace to the document. These belong to the layout, and are compared with it.
- **What cannot be reproduced from the diagram files.** Today, before writing the layout, Java resizes some nodes to fit their text using font metrics, and sizes each label the same way. Neither result is stored anywhere. Ten of the 153 nodes of R-HSA-69620 were resized; their boxes, the edges ending on them, and the label sizes differ by that much.
- **Very large pathways.** A top-level pathway with thousands of reactions is answered within the time today's export takes, without taking more than its share of the graph database. A deep export is limited as the service's other deep queries are.
- **Disease and inferred events, and events with no stable identifier.** Each is answered as today.
- **A reaction's model.** Today a reaction's SBML names no pathway ("No parent pathway detected"); the graph-only converter names the reaction's first parent pathway, with its notes and annotations. The graph-only form is kept, and the difference recorded.
- **An identifier that is not an event.** Java answers 400, but decides it by loading every relationship of the object, which takes tens of seconds for a common small molecule. The new export decides it from the object's class alone.
- **Characters that need escaping in XML or RDF.** Names with `&`, `<`, quotes or non-Latin characters are written correctly, as validators and today's output require.
- **The generation timestamp.** It is the one part of the SBML that differs on every answer. It is set aside when comparing, and written in today's form.
- **Caching.** Both exports are answers that change only with the database. They are cached under spec 011's labels, as the other exports are.

## Requirements _(mandatory)_

### Functional Requirements

**SBML**

- **FR-001**: The SBML export at its existing URLs (`/exporter/event/{id}.sbml`, and `/exporter/sbml/{id}.xml`, which `/data/discover` links) MUST be answered by the node content service from the graph database. No relational database may be used.
- **FR-002**: Apart from the layout (with what the layout changes in the model: the drawn species' SBO terms and the layout namespace) and the generation note, its answer MUST be byte-identical to the graph-only reference converter's answer for the same event. That converter has never been run in production and has four measured defects (it keeps one reactant and one product per reaction, writes positive regulators as catalysts and as negative regulators, and never writes positive regulators); the reference is that converter with those four defects corrected, and with identifiers written as ContentService writes them today (research R1). This is compared live, as every ported endpoint is. Its status, content type and download name MUST be today's, and so MUST its error answers.
- **FR-003**: Its layout MUST be built from the diagram the site draws (the diagram files the site and the SBGN export already read), for the events that have one today and only those. For every event in a sample, it MUST place and connect the same elements, with the same identifiers, in the same roles and order, as today's layout. Coordinates MUST be the diagram's own; where today's differ (a fixed offset, and the nodes Java resized to fit their text), that difference is recorded and accepted. Any other difference MUST be recorded and accepted in this spec before the route is switched.
- **FR-004**: It MUST be routed to the node service in nginx and the dev proxy alike, slashed form included, with no fallback to Java.

**BioPAX**

- **FR-005**: BioPAX Level 3 for a pathway or a reaction MUST be answered by the node content service from the graph database, at a URL it answers.
- **FR-006**: For every event in a sample, the file MUST describe what today's file describes:
  - the pathways and reactions;
  - their participants and the roles they play;
  - physical entities and their references and cross-references;
  - stoichiometry, compartments and literature.

  Each difference MUST be recorded in this spec, and accepted, before the links are switched. RDF identifiers and element order MAY differ.

- **FR-007**: Both download links on the site MUST point to the new export. The legacy link form MUST lead to it too.
- **FR-008**: Until FR-005 to FR-007 are met, the BioPAX links on beta MUST NOT deliver the site's page. Either they work, or they are not offered.

**Both**

- **FR-009**: For a sample of events, each export MUST pass its format's own validator in continuous integration: SBML's consistency check, and the BioPAX validator.
- **FR-010**: Each export MUST be cached and labelled under spec 011's rules, and MUST be limited as the service's other deep queries are.
- **FR-011**: Verification against the shared graph database MUST be small, sequential and spaced.

### Key Entities

- **Event**: a pathway or a reaction, by stable identifier or database id. It is what both exports describe.
- **Diagram**: the drawing of a pathway, from which the SBML layout is taken: the event's own diagram only. A reaction, or a pathway drawn on another's diagram, has no layout, as today.
- **Reference answer**: what each export is compared with:
  - for SBML's model, the graph-only converter's output (exact);
  - for SBML's layout, today's layout (its elements, identifiers, roles and order exactly; its coordinates by meaning);
  - for BioPAX, today's file (by meaning).
- **Accepted difference**: a recorded way the new output may differ from its reference, with the reason. Nothing switches until every difference found is recorded.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: No export the website offers needs the relational database. Today there are two that do.
- **SC-002**: For SBML, 100% of a sample of at least 30 events (pathways of several sizes and reactions, including disease and inferred ones) match the reference exactly, apart from the layout and the generation note.
- **SC-003**: For both formats, every difference from the reference across the sample is recorded and accepted, with no unexplained one left.
- **SC-004**: Both formats pass their validators with zero errors over the sample.
- **SC-005**: Both BioPAX links on the site deliver a BioPAX file every time, against an HTML page today.
- **SC-006**: A download asked for before, in the same release, is answered as fast as today's (which are served from a cache kept per release: 0.1 s for Signal Transduction's 23.5 MB SBML). A first download of the largest top-level pathway in the sample completes within the service's limits for deep queries, without failing any other request.

## Assumptions

- **Where BioPAX lives.** Java's ContentService has no BioPAX URL. The new export takes one beside the other exporters (`/ContentService/exporter/event/{id}.biopax`, named in the plan). The legacy path redirects to it, so links held elsewhere keep working. The `/data/discover` answer keeps Java's text until Java's own answer changes.
- **The generation note.** It keeps today's form. It names the generator truthfully, and that difference is recorded.
- **Order of work.** SBML first: the model, then the layout. Then BioPAX. The broken-link fix (User Story 3) can go first, on its own.
- **Code that runs in a validator only.** The validators may need a runtime the service does not (a JVM, for one). They run in continuous integration and in verification, never in production.
- **Out of scope:**
  - SBGN, which is already built from the graph and the diagram files;
  - BioPAX Level 2;
  - the bulk files on the download page, and the separate exporter for them;
  - the analysis exports;
  - any change to the graph schema or its Java library.
- **This repository is public.** No internal host names, paths or incident detail.
