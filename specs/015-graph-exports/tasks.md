# Tasks: SBML and BioPAX from the graph, one exporter each

**Input**:

- [plan.md](plan.md) (order of work 1–8; rewritten 24 Oct 2026)
- [spec.md](spec.md)
- [research.md](research.md) (R1–R10, measured)
- [data-model.md](data-model.md)
- [contracts/](contracts/) (endpoints, checks, differences)
- [quickstart.md](quickstart.md)

**Rewritten on 24 Oct 2026.** T001–T004 and T009 are done, and their records stand. The tasks after them were for a TypeScript port in the node service. They are replaced by the tasks below, which make `sbml-exporter` and `BioPAX3Exporter` the single implementation of each format (spec, "What changed"). The old task list is in this file's history.

**Tests**: required. Every new check is shown failing on a deliberate mistake before it is trusted (constitution III).

**Each task here** is one pull request in this repository. It must:

- have an adversarial review;
- pass CI and merge, then the merge commit is checked on main;
- tick its task here with the PR number, in the same pull request.

**A task in another repository** (marked **[ext]**) is ticked here with that repository's pull request, once its maintainers have merged it. No change is pushed there without their agreement (FR-010).

**Rules that hold throughout:**

- **No request to reactome.org, ever.** Every reference answer, sample and check uses the beta host's own services and the private graph copy (R8).
- **The shared graph:** load small, sequential and spaced.
- **Personal names** (SBML creators, BioPAX authors and curation comments) never appear in this repository's fixtures, logs or output. Comparison tools hash them.
- This repository is public.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup (the references and the sample) — done

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

## Phase 2: The maintainers, and the instruments

**Purpose**: agreement on the direction with each exporter's maintainers, and the checks that prove each exporter. Blocks both stories.

- [x] T010 Draft the two issues outside the repository, for the user to read before anything is posted (this repository is public, so a draft merged here would already be published):
  - **for `sbml-exporter`**: the five defects with their fixes (reference-harness.md), the layout from the diagram files (R3), the graph-only command line, and the plan to make the exporter the one implementation for the bulk files and the website;
  - **for `BioPAX3Exporter`**: the coverage gap against today's files (R9, data-model.md), the mode and `xml:base` defects, the per-reaction export, and how it will be proven (R4's comparison).

  — #646 (drafted 24 Oct, with the user to read)

- [ ] T011 Post the two issues once the user has read and approved them, and record their links here.
- [ ] T012 [P] Write the SBML comparison tool, `tools/exports-compare/sbml-compare.ts`, with its spec (`contracts/checks.md`):
  - **the model:** byte for byte, the generation note's timestamp set aside;
  - **the layout:** glyph sets, ids, roles, order and targets exactly; coordinates by meaning, against the diagram plus one offset, with the resized nodes listed;
  - **output:** element paths, with vCard names as hashes.

  Show it failing on a removed species reference, a changed sboTerm and a moved glyph.

- [ ] T013 [P] Write the BioPAX comparison tool, `tools/exports-compare/biopax-compare.ts`, with its spec:
  - each file canonicalised to (class, property, target-key) triples, with `rdf:ID`s replaced by content keys (R4);
  - accepted differences read from `contracts/differences.md`;
  - authors and curation comments hashed.

  It must take a species file as well as an event's. Show it failing on a changed stoichiometry and a removed xref.

- [ ] T014 Run the validators on today's files from T004 and record the baselines in research.md R5:
  - libSBML 5.21.2's `checkConsistency()`, with the units and modelling-practice categories off;
  - the BioPAX validator 6.0.0, on JDK 17, reading its XML reports.

  Any error found in today's files is recorded as known.

- [ ] T015 Run BioPAX3Exporter as it is today over the sample's pathways, from the private graph copy, and record the comparison with today's files in research.md R9. This is the baseline that the BioPAX work is measured from.

**Checkpoint**: the issues are posted, and each comparison tool has been shown failing on wrong input.

---

## Phase 3: User Story 3 — The broken BioPAX link fixed now (Priority: P1) — done

- [x] T009 [US3] Route `^/ReactomeRESTfulAPI/RESTfulWS/biopaxExporter/Level3/\d+$` in beta's server block (`deploy/nginx/dev.conf`) to the host's Tomcat, under the render budget.
  - The dev-proxy key in `proxy.conf.js` is anchored to the same expression.
  - `deploy/nginx/routes.spec.ts` reads beta's HTTPS server block, and `serve-prod.spec.ts` covers the key; both are shown failing.
  - Beta's nginx was rebuilt, and both forms were checked through it: a reaction is 45,793 bytes of BioPAX; Apoptosis is 3.2 MB, the first time in 6 s.
  - — #634

---

## Phase 4: User Story 1 — SBML from the graph, one exporter (Priority: P1) 🎯 MVP

**Goal**: `sbml-exporter`'s graph-only converter makes both the bulk archives and the website's SBML.

**Independent Test**: the sample's models are byte-identical to the corrected reference; the layouts match today's by meaning; a graph-only bulk run gives today's file names; the website's SBML comes from the exporter.

- [ ] T016 [US1] [ext] In `sbml-exporter`: fix the five defects (R9), each with a test that fails without its fix. Add tests for the two queries' row mapping.
- [ ] T017 [US1] Compare the fixed exporter's models with the references over the whole sample (T012), from the private graph copy. Every event without a diagram must be byte-identical apart from the timestamp. Record any difference in `contracts/differences.md`, or send it back to T016.
- [ ] T018 [US1] [ext] In `sbml-exporter`: the layout from the diagram files. `LayoutConverter`'s algorithm, ported over `diagram/{stId}.json` of the same release (R3): the same ids, order, glyph sets, roles, backbone rules, hidden compartments, SBO override and root attributes. It is written only for an event whose own diagram draws a reaction.
- [ ] T019 [US1] Compare the layouts with today's files (T004) over the sample's events with diagrams: glyph sets, ids, roles, order and targets exactly; coordinates against the recorded offset and the resized nodes. Record each difference in `contracts/differences.md`.
- [ ] T020 [US1] [ext] In `sbml-exporter`: a graph-only command line. The relational options are dropped, the graph converter with its layout is used for listed ids, species and `all`, and the file names stay `{stId}.sbml` with the archives as today. Pathways are written in a species run as today (every pathway, one file each).
- [ ] T021 [US1] A graph-only bulk dry run for one species, compared with today's archive for it: the same file names, every file valid (libSBML), and a sample of files compared as in T017 and T019. Record the run's time.
- [ ] T022 [US1] Add the `exports` service (R10): `deploy/exports/` (Dockerfile, the wrapper, a compose entry bound to loopback), built from the exporters' published artefacts, with a health check that proves a conversion runs, not only that the port answers.
- [ ] T023 [US1] Route the website's SBML through it. In `exporters-endpoints.ts`, node answers `/ContentService/exporter/event/{id}.sbml` and `/exporter/sbml/{id}.xml`, slashed forms included, with R6's headers and errors; asks `exports` for the body; and caches per release under spec 011.
  - The routes go in nginx and the dev proxy alike, and `routes.spec.ts` follows, with `.sbgn` kept as Java's neighbour.
  - The parity harness compares status, headers and errors with Java's; the body is compared by T012.
  - Check before and after on beta.

**Checkpoint**: SBML needs no relational database, for the release or the website.

---

## Phase 5: User Story 2 — BioPAX Level 3 from the graph, one exporter (Priority: P2)

**Goal**: `BioPAX3Exporter` makes the Level 3 species files and the website's BioPAX, with today's content.

**Independent Test**: the sample's per-event files, and three species' files, compare with today's by meaning, every difference recorded; every file is valid.

- [ ] T024 [US2] [ext] In `BioPAX3Exporter`: physical entities with their entity references and cross-references (UniProt, ChEBI and the rest, data-model.md), complex components and cellular locations. Unit tests for each.
- [ ] T025 [US2] [ext] In `BioPAX3Exporter`: reactions with stoichiometry, catalysis with its controller, and regulation (positive and negative, as data-model.md maps them).
- [ ] T026 [US2] [ext] In `BioPAX3Exporter`: literature, evidence, provenance and stable-identifier cross-references.
- [ ] T027 [US2] [ext] In `BioPAX3Exporter`: the modes. The species mode writes each pathway once and includes the events in no pathway; `-l` writes the events it was given; there is a per-reaction export; and `xml:base` takes the form the release's check accepts, held per model rather than statically.
- [ ] T028 [US2] Compare the exporter's per-event files with today's over the sample (T013), then three species' files with Pathway-Exchange's. Record each difference in `contracts/differences.md`. Expected: order and ids, EC numbers, chapter authors and the early return (R4). Anything else goes back to T024–T027.
- [ ] T029 [US2] Validate the exporter's files over the sample with the BioPAX validator, against T014's baseline.
- [ ] T030 [US2] Serve the website's BioPAX through `exports`. Node answers `/ContentService/exporter/event/{id}.biopax` as R6 decided (`application/rdf+xml`, named by stable id, 404 and 400 in the envelope), caches it per release, and routes it in nginx and the dev proxy alike.
- [ ] T031 [US2] Replace #634's Tomcat location for the legacy path with node's 301 to the new URL, in `deploy/nginx/dev.conf`, `routes-core.conf` and the dev proxy, with `routes.spec.ts` and `serve-prod.spec.ts` following. Rebuild beta's nginx and check both link forms.
- [ ] T032 [US2] Point the site's two BioPAX links (the download tab and the detail download bar) at `/ContentService/exporter/event/{stId}.biopax`, delete `RESTFUL_API`, and update the e2e tests. A site rebuild on beta needs the user's OK.

**Checkpoint**: BioPAX Level 3 needs no relational database for the website, and the exporter is proven for the release.

---

## Phase 6: User Story 4 — The release, without the relational database for these formats (Priority: P3)

- [ ] T033 [US4] [ext] With the release's maintainers: the Level 3 step moves from `release-download-directory`'s Pathway-Exchange converter to `BioPAX3Exporter`, keeping `biopax.zip`'s name and layout, after a dry run compared as in T028.
- [ ] T034 [US4] Level 2: look at how often `biopax2.zip` is downloaded, by means other than a request to the production site, and record the decision in spec.md before the step is dropped or kept.
- [ ] T035 [US4] [ext] With the release's maintainers: `sbml-exporter`'s release run moves to the graph-only command line (T020).
- [ ] T036 [US4] Record, in research.md R9, what is left in `release-download-directory` (its other relational steps) for whoever retires it, and what in `sbml-exporter` (its relational half) and the legacy service can go once nothing calls them.

---

## Phase 7: Polish and cross-cutting

- [ ] T037 Add the `exports` job to `.github/workflows/tests.yml` (R5, contracts/checks.md), running alongside `unit`: libSBML over the SBML fixtures, and the BioPAX validator (cached by sha1, JDK 17) over the BioPAX fixtures, failing on any error in its XML reports. Fixtures carry no personal values (R8).
- [ ] T038 [P] Close #631 and #632, and update `specs/006-content-service-to-node/tasks.md` Phase 9 and `specs/010-java-services` for the two exports, which are no longer the Java ContentService's.
- [ ] T039 [P] Check the success criteria and record the result here.

---

## Dependencies and execution order

- **Phase 2** blocks the stories.
  - T010 and T011 come before any **[ext]** task.
  - T012 and T013 come before any comparison task.
- **SBML (US1):** T016 → T017 → T018 → T019 → T020 → T021. T022 can start alongside T016, and T023 needs T022 and T019.
- **BioPAX (US2):** T015 sets the baseline. T024–T027 can go in any order the maintainers prefer. T028 and T029 need them all. T030 needs T022, then T031 and T032 follow.
- **US4** follows each format's comparison: T033 after T028, and T035 after T021.

## Parallel opportunities

- T012 and T013.
- The SBML work (Phase 4) and the BioPAX content work (T024–T027), once the issues are agreed.

## Implementation strategy

1. **The issues first.** Nothing in either exporter changes before its maintainers agree.
2. **SBML first.** It has an exact reference and an existing graph-only converter, so it proves the approach and the `exports` service.
3. **BioPAX second.** It has the larger gap, measured by T015's baseline before any building starts.
4. **The release's switches last**, each after a dry run compared with today's output.
