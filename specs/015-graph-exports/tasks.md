# Tasks: SBML and BioPAX built from the graph

**Input**:

- [plan.md](plan.md) (order of work 1–7)
- [spec.md](spec.md)
- [research.md](research.md) (R1–R8, measured)
- [data-model.md](data-model.md)
- [contracts/](contracts/) (endpoints, checks, differences)
- [quickstart.md](quickstart.md)

**Tests**: required. Every new check is shown failing on a deliberate mistake before it is trusted (constitution III).

**Each task** is one pull request. It must:

- have an adversarial review;
- pass CI and merge, then the merge commit is checked on main;
- tick its task here with the PR number, in the same pull request.

**Rules that hold throughout:**

- **No request to reactome.org, ever.** Every reference answer, sample and check uses the beta host's own services: the Java ContentService and the legacy RESTful service on its Tomcat, and its databases.
- **The shared graph:** load small, sequential and spaced.
- **Personal names** (SBML creators, BioPAX authors and curation comments) never appear in fixtures, logs or output. Reference files that hold them stay outside the repository. Comparison tools hash them.
- This repository is public.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup (the references and the sample)

**Purpose**: the reference answers every later task is compared with.

- [x] T001 Choose and list the 30-event sample in `specs/015-graph-exports/sample.md`:
  - top-level pathways of several sizes, including Signal Transduction (R-HSA-162582) and R-HSA-69620;
  - sub-pathways with and without their own diagram;
  - reactions, a black-box event, disease and inferred events, and a set-heavy pathway.

  Each is listed by stable id and dbId, with the reason it is in the sample. Ids are looked up on the beta host, never guessed. — #636

- [x] T002 Measure the host's free disk and the size of release 97's published graph database (from its published dump), and decide where references are generated. Record the measurement and the decision in research.md R8:
  - a private graph database of release 97, started apart from beta's, if it fits with a safe margin;
  - otherwise small, spaced runs against the shared one. — #637
- [x] T003 Write the SBML reference harness (research R1), as a throwaway Maven module kept outside the repository (its instructions in `specs/015-graph-exports/reference-harness.md`). It runs sbml-exporter 2.2.7's graph-only `SbmlConverter` with the four named fixes:
  1. a new `Participant` per row;
  2. catalysts read from their own column;
  3. positive regulators set;
  4. negative regulators set from their own column.

  It also turns on `Helper.setUseIdentifierURL(true)`. It runs on JDK 11 with `-Duser.timezone=UTC -Duser.language=en -Duser.country=US -Dfile.encoding=UTF-8`.

  Generate the sample's references (T001) where T002 decided, outside the repository. Record each fix as an accepted deviation in `contracts/differences.md`, and offer the fixes upstream as an issue on sbml-exporter. — #638 (the upstream issue waits for the user's OK)

- [x] T004 Take today's answers for the sample, once and spaced, from the beta host only, and keep them outside the repository:
  - SBML from the Java ContentService, `http://localhost:8080/ContentService/exporter/event/{id}.sbml`;
  - BioPAX from the legacy RESTful service, `http://localhost:8080/ReactomeRESTfulAPI/RESTfulWS/biopaxExporter/Level3/{dbId}`.

  For each, record status, headers, size and time. — #640 (`today.md`)

---

## Phase 2: Foundational (the instruments)

**Purpose**: the checks that make the exports provable. Each is shown failing first. Blocks both stories.

- [ ] T005 [P] Write the SBML comparison tool, `tools/content-node/sbml-compare.ts`, with its spec (`contracts/checks.md`):
  - **the model:** byte for byte, the generation note's timestamp set aside;
  - **the layout:** glyph sets, ids, roles, order and targets exactly; coordinates by meaning, against the diagram plus one offset, with the resized nodes listed;
  - **output:** element paths, with vCard names as hashes.

  Show it failing on a removed species reference, a changed sboTerm and a moved glyph.

- [ ] T006 [P] Write the BioPAX comparison tool, `tools/content-node/biopax-compare.ts`, with its spec:
  - each file canonicalised to (class, property, target-key) triples, with `rdf:ID`s replaced by content keys (research R4);
  - accepted differences read from `contracts/differences.md`;
  - authors and curation comments hashed.

  Show it failing on a changed stoichiometry and a removed xref.

- [ ] T007 Make the committed fixtures in `tools/content-node/fixtures/exports/`: recorded graph rows and diagram JSON for a few sample events, with every personal value replaced by a fixed placeholder (research R8). Add a spec that fails if any fixture holds a value matching a name pattern taken from the recorded rows' person fields.
- [ ] T008 Run the validators on today's files from T004 and record the baselines in research.md R5:
  - libSBML 5.21.2's `checkConsistency()`, with the units and modelling-practice categories off;
  - the BioPAX validator 6.0.0, on JDK 17, reading its XML reports.

  Any error found in today's files is recorded as known, so "zero errors" is a fair bar for the new ones.

**Checkpoint**: the references, the sample and the comparison tools exist, and each tool has been shown failing on wrong input.

---

## Phase 3: User Story 3 — The broken BioPAX link fixed now (Priority: P1)

**Goal**: beta's BioPAX links deliver BioPAX, never the site's page.

- [x] T009 [US3] Route `^/ReactomeRESTfulAPI/RESTfulWS/biopaxExporter/Level3/\d+$` in beta's server block (`deploy/nginx/dev.conf`) to the host's Tomcat, under the render budget.
  - The dev-proxy key in `proxy.conf.js` is anchored to the same expression.
  - `deploy/nginx/routes.spec.ts` reads beta's HTTPS server block, and `serve-prod.spec.ts` covers the key; both are shown failing.
  - Beta's nginx was rebuilt, and both forms were checked through it: a reaction is 45,793 bytes of BioPAX; Apoptosis is 3.2 MB, the first time in 6 s.
  - — #634

---

## Phase 4: User Story 1 — SBML from the graph (Priority: P1) 🎯 MVP

**Goal**: SBML at its two URLs, built from the graph by the node content service, with no relational database.

**Independent test**:

- every sample event's model is byte-identical to its reference (T003), the timestamp set aside;
- the layout matches today's in structure exactly;
- libSBML reports 0 errors;
- the URLs are answered by node.

### The model

- [ ] T010 [US1] Write `tools/content-node/xml-writer.ts` and its spec: an element tree written in JTidy's final form (research R2).
  - an element per line, 2 spaces per level, text elements inline, empty ones as `<x a="b" />`;
  - attributes alphabetical, with the root's namespaces first and `xmlns:layout` last;
  - whitespace collapsed, and escaping as measured (`&#160;` for U+00A0);
  - `\n` line ends, and the declaration `<?xml version='1.0' encoding='utf-8' standalone='no'?>`.

  Show its spec failing on each rule.

- [ ] T011 [US1] Write `tools/content-node/sbml-model.ts` and its spec (research R1), building the model in document order:
  - the two queries, REACTIONS_QUERY and PARTICIPANTS_QUERY, verbatim, their row order kept;
  - the model's pathway (the event, or a reaction's first parent by `hasEvent.order`);
  - notes through the `removeTags` rules, and History (creators in order; dates parsed with `hh`, so 12 becomes 00, written in GMT);
  - CVTerms in their order;
  - species (attributes, the SBO table, explanation notes, annotation) and compartments, with metaids interleaved;
  - reactions, with `addCVTerms`, reactants, products and modifiers;
  - the provenance note in `M/d/yy, h:mm a` UTC.

  The spec runs on the fixtures (T007).

- [ ] T012 [US1] Add the SBML endpoints to `tools/content-node/exporters-endpoints.ts` (contracts/endpoints.md): `/ContentService/exporter/event/{id}.sbml` and `/ContentService/exporter/sbml/{id}.xml`.
  - The id is read as `resolveId` reads one. Not found is a 404 (`Identifier '{id}' not found`); not an event is a 400, decided from labels, never by loading every relationship.
  - The answer is `application/sbml+xml;charset=UTF-8`, `attachment; filename="{stId}.sbml"`.
  - The endpoints are `deep`, with their own share of 2.
  - They are listed in `deploy/nginx/routes.spec.ts`'s NOT_YET_ROUTED until T017.
  - Add `parameters.ts` RECORD entries: path kind `oid`, with Java's `includeRef` and `view` ignored.
- [ ] T013 [US1] Compare the node answers with the references over the whole sample, with the comparison tool (T005). Ask the node service on the beta host, spaced. Every event without a diagram must be byte-identical apart from the timestamp. Every difference found is fixed, or recorded with its reason in `contracts/differences.md`.

### The layout

- [ ] T014 [US1] Write `tools/content-node/diagram-files.ts` and its spec. It reads `diagram/{stId}.json` of the same release, from a location set in `settings.ts` (the release's download base by version, or a mounted folder), and never mixes releases. Add the nodes' `textPosition` to `projects/pathway-browser/src/app/model/diagram.model.ts`.
- [ ] T015 [US1] Write `tools/content-node/sbml-layout.ts` and its spec: `LayoutConverter` ported literally over the diagram JSON (research R3). It writes a layout only for an event with its own diagram drawing a reaction:
  - compartment glyphs, with the hidden ones;
  - species glyphs, one per drawing, with the RNA inset;
  - reaction glyphs, with the backbone midpoint and the single-input and single-output rules;
  - species-reference glyphs (`layout_{rid}_{role}_{i}`);
  - text glyphs;
  - ids sorted within each list;
  - the SBO override by render class (with the EntitySet Drug query), and the root's layout attributes.

  Run libSBML on its output in the spec.

- [ ] T016 [US1] Compare the layouts with today's files (T004) over the sample's events that have diagrams: glyph sets, ids, roles, order and targets exactly; coordinates against the recorded offset and the resized nodes. Record each difference in `contracts/differences.md`, and confirm R-HSA-69620's 10 resized nodes and 14 curves are the only coordinate differences there.

### The switch

- [ ] T017 [US1] Route both SBML URLs to node:
  - **nginx:** in `deploy/nginx/common/routes.conf`, a node location before Java's `exporter/(diagram|document|event)` location, under the render budget; in `deploy/nginx/local.conf`, the same without it.
  - **dev proxy:** `proxy.conf.js` agrees.
  - **`routes.spec.ts`:** `.sbml` comes off NOT_YET_ROUTED, `/exporter/event/R-HSA-109581.sbgn` is added to JAVAS, and `sbml` joins the render-budget loop.
  - **Checks:** run `deploy/nginx/test-config.sh`; add the endpoint's parity-harness entry (`diff.ts`) for status, headers and errors against Java.
  - **On beta:** before and after the rebuild, ask for a reaction's and R-HSA-69620's SBML through nginx. Expect the contract's headers, a cache hit the second time, and SBGN still from Java.

**Checkpoint**: SBML is node's, from the graph, on beta.

---

## Phase 5: User Story 2 — BioPAX from the graph (Priority: P2)

**Goal**: BioPAX Level 3, per pathway or reaction, built from the graph by the node content service, and both site links delivering it.

**Independent test**:

- every sample event's canonical triples equal today's file's (T004), apart from recorded differences;
- the BioPAX validator reports 0 errors;
- both links deliver it.

- [ ] T018 [US2] Write `tools/content-node/biopax-model.ts` and its spec (data-model.md's table, research R4):
  - events: Pathway, BiochemicalReaction, Degradation and TemplateReaction;
  - Catalysis, Control and PathwayStep;
  - physical entities typed by reference, with sets typed by their members' common type as today's samples show;
  - features, entity references, xrefs, BioSource and PublicationXref;
  - the deterministic order: graph order, then dbId.
- [ ] T019 [US2] Write `tools/content-node/biopax-rdf.ts` and its spec. It writes RDF/XML with today's header and namespaces, `xml:base` from the release, `rdf:ID="{Class}{n}"`, and `rdf:datatype` on every data property.
- [ ] T020 [US2] Compare node's BioPAX with the legacy service's files (T004) over the sample, with the comparison tool (T006). Record each difference in `contracts/differences.md`; expected are EC numbers, chapter authors, and every cross-reference and disease written. Re-sample a few more set-heavy events from the local legacy service first: its set typing differs from its source on GitHub.
- [ ] T021 [US2] Add `/ContentService/exporter/event/{id}.biopax` to `tools/content-node/exporters-endpoints.ts`:
  - `application/rdf+xml;charset=UTF-8`, `attachment; filename="{stId}.biopax"`, opting out of the download guard (`server.ts` `writeResult`; research R6);
  - 404 and 400 as for SBML; `deep`; cached per release; a RECORD entry with `java: null` and its reason.

  Route it in `routes.conf`, `local.conf` and `proxy.conf.js`, and cover it in `routes.spec.ts`.

- [ ] T022 [US2] Replace beta's Tomcat location for the legacy path (`deploy/nginx/dev.conf`, #634) with node's 301 to `/ContentService/exporter/event/{dbId}.biopax`. It is a node endpoint, routed in `routes-core.conf` and the dev proxy's anchored key, and `routes.spec.ts` and `serve-prod.spec.ts` follow. Rebuild beta's nginx and check both link forms.
- [ ] T023 [US2] Point the site's two links at `/ContentService/exporter/event/{stId}.biopax`:
  - `projects/pathway-browser/src/app/details/tabs/download-tab/download-tab.component.ts`;
  - `projects/website-angular/src/app/content/detail/detail-download-bar/detail-download-bar.component.ts`.

  Delete `RESTFUL_API` from `projects/pathway-browser/src/environments/environment.ts`. The beta site rebuild needs the user's OK.

**Checkpoint**: BioPAX is node's, from the graph, and the relational database is needed by no export the site offers (SC-001).

---

## Phase 6: Polish and cross-cutting

- [ ] T024 Add the `exports` job to `.github/workflows/tests.yml` (research R5, contracts/checks.md), running alongside `unit`:
  1. Build the sample exports from the fixtures (T007).
  2. `pip install python-libsbml==5.21.2`, and run the check script. It fails on errors and fatals, not on warnings.
  3. Run the BioPAX validator 6.0.0: restored from `actions/cache` by version and sha1, or fetched from Maven Central with its sha1 checked, on JDK 17, once over the directory. Fail on any `ERROR` in its XML reports, since its exit code is always 0.

  Show each step failing on a wrong file. Add it with the first export's fixtures, and extend it for the second.

- [ ] T025 [P] Close #631 and #632, and update `specs/006-content-service-to-node/tasks.md` Phase 9 and `specs/010-java-services` for the two exports, which are no longer Java's.
- [ ] T026 [P] Check the success criteria and record the result here:
  - SC-002: the sample is identical;
  - SC-004: the validators report 0 errors;
  - SC-005: both links deliver BioPAX;
  - SC-006: a repeat answer is as fast as today's, and a first export of Signal Transduction completes within the deep limits.

---

## Dependencies and execution order

- **Phase 1 then Phase 2** block both stories. T001 comes first. T003 and T004 depend on T001 and T002.
- **US3** is done (#634).
- **US1:** T010 → T011 → T012 → T013, then T014 → T015 → T016, then T017.
- **US2** (T018–T023) can start once Phase 2 is done, in parallel with US1's layout. T021 needs T012's endpoint shape. T022 needs T021, and T023 needs T022.
- **T024** starts with the first fixtures and grows. T025 and T026 come last.

## Parallel opportunities

- T005 and T006, the two comparison tools.
- After T012: the layout (T014–T016) and BioPAX's model (T018–T019).
- T025 and T026.

## Implementation strategy

**MVP: User Story 1's model.** T010–T013 give byte-identical SBML for every event without a layout, behind NOT_YET_ROUTED. Then the layout, then the switch. BioPAX follows; US3 already keeps its links working meanwhile.
