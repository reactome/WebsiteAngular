# Tasks: SBML and BioPAX from the graph, one exporter each

**Input**:

- [plan.md](plan.md) (order of work 1–9; rewritten 24 Oct 2026)
- [spec.md](spec.md)
- [research.md](research.md) (R1–R10, measured)
- [data-model.md](data-model.md)
- [contracts/](contracts/) (endpoints, checks, differences)
- [quickstart.md](quickstart.md)

**Rewritten on 24 Oct 2026.** T001–T004 and T009 are done, and their records stand. The old T005–T026 were for a TypeScript port in the node service, and are withdrawn; they are in this file's history. The new tasks start at T027, so that no id means two things. They make `sbml-exporter` and `BioPAX3Exporter` the single implementation of each format (spec, "What changed").

**Tests**: required. Every new check is shown failing on a deliberate mistake before it is trusted (constitution III).

**Each task here** is one pull request in this repository. It must:

- have an adversarial review;
- pass CI and merge, then the merge commit is checked on main;
- tick its task here with the PR number, in the same pull request.

**A task in another repository** (marked **[ext]**) is ticked here with that repository's pull request, once its maintainers have merged it. No change is pushed there without their agreement (FR-010).

**Rules that hold throughout:**

- **No request to reactome.org's services, ever.** Every reference answer, sample and check uses the beta host's own services and the private graph copy (R8). The one exception (24 Oct 2026, with the user): the release's published bulk files in its download directory, `download.reactome.org/{release}/` (`biopax.zip`, `all_species.3.1.sbml.tgz`, `homo_sapiens.3.1.sbml.tgz`), are the bulk references, fetched one at a time when a task needs them and kept outside the repository.
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
  - SBML from the Java ContentService's `exporter/event/{id}.sbml`;
  - BioPAX from the legacy RESTful service's `biopaxExporter/Level3/{dbId}`.

  For each, record status, headers, size and time. — #640 (`today.md`)

---

## Phase 2: The maintainers, and the instruments

**Purpose**: agreement on the direction with each exporter's maintainers, and the checks and references that prove each exporter. Blocks both stories.

- [x] T027 Draft the two issues outside the repository, for the user to read before anything is posted (this repository is public, so a draft merged here would already be published):
  - **for `sbml-exporter`**: the five defects with their fixes (reference-harness.md), the layout from the diagram files (R3), the graph-only command line, and the plan to make the exporter the one implementation for the bulk files and the website;
  - **for `BioPAX3Exporter`**: the coverage gap against today's files (R9, data-model.md), the mode and `xml:base` defects, the per-reaction export, and how it will be proven (R4's comparison against the release's `biopax.zip`).

  — #646 (drafted 24 Oct, with the user to read)

- [ ] T028 Post the two issues once the user has read and approved them, and record their links here.
- [ ] T029 [ext] Agree graph-core and the JDK with both exporters' maintainers: each works on the graph-core version spec 010's library service pins, on JDK 17 (R10). Record the version here.
- [ ] T030 [P] Write the SBML comparison tool, `tools/exports-compare/sbml-compare.ts`, with its spec (`contracts/checks.md`):
  - **the model:** byte for byte, the generation note's timestamp set aside, and the layout's changes to the model (FR-002) compared with the layout;
  - **the layout:** glyph sets, ids, roles, order and targets exactly; coordinates by meaning, against the diagram plus one offset, with the resized nodes listed;
  - **output:** element paths, with vCard names as hashes.

  Show it failing on a removed species reference, a changed sboTerm and a moved glyph.

- [ ] T031 [P] Write the BioPAX comparison tool, `tools/exports-compare/biopax-compare.ts`, with its spec:
  - each file canonicalised to (class, property, target-key) triples, with `rdf:ID`s replaced by content keys (R4);
  - accepted differences read from `contracts/differences.md`;
  - authors and curation comments hashed.

  It takes a species file as well as an event's. Show it failing on a changed stoichiometry and a removed xref.

- [ ] T032 The private graph copy (R8), for the release being compared, recreated whenever a comparison needs it and removed afterwards. If beta's graph has moved to a newer release by then, regenerate the SBML references (T003) and today's per-event answers (T004) for that release, and compare with that release's download directory.
- [ ] T033 (`biopax.zip` done for release 97, recorded in `today.md`; the SBML archives when T041 needs them.) Fetch the release's bulk references from its download directory, `download.reactome.org/{release}/`: `biopax.zip`, `all_species.3.1.sbml.tgz` and `homo_sapiens.3.1.sbml.tgz`. One at a time, kept outside the repository (they hold people's names). Record each file's size, digest and list of entries in `today.md`, never their content.
- [ ] T034 Run the validators on today's files and record the baselines in research.md R5:
  - libSBML 5.21.2's `checkConsistency()` over T004's SBML and a sample of T033's archive, with the units and modelling-practice categories off;
  - the BioPAX validator 6.0.0, on JDK 17, over T004's files and three of `biopax.zip`'s species files, reading its XML reports.

  Any error in today's files is recorded as known.

- [ ] T035 Run BioPAX3Exporter as it is today, from T032's copy, over the sample's pathways and the same three species, and compare with T004 and T033 by T031. Record the result in research.md R9: the baseline the BioPAX work is measured from.

- [ ] T061 [ext] Organise each exporter as a library and a command line (R10): in `BioPAX3Exporter`, a library module (`WriteBioPAX3` and the builders, with their tests) and a thin command-line module for the bulk run; in `sbml-exporter`, likewise (`SbmlConverter` with its layout, then `Main`). Each library is published as a versioned Maven artefact; until it is, spec 010's service builds it from a pinned commit. The library modules exist before T044 and T052.

**Checkpoint**: the issues are posted, graph-core is agreed, the references are in hand, and each comparison tool has been shown failing on wrong input.

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

**Independent Test**:

- the sample's models are byte-identical to the corrected reference;
- the layouts match today's by meaning;
- a graph-only bulk run matches the release's published archives in file names and in a sample of files;
- the website's SBML comes from the exporter.

- [ ] T036 [US1] [ext] In `sbml-exporter`: fix the five defects (R9), each with a test that fails without its fix. Add tests for the two queries' row mapping.
- [ ] T037 [US1] Compare the fixed exporter's models with the references over the whole sample (T030), from T032's copy. Byte-identical apart from the timestamp. Record any difference in `contracts/differences.md`, or send it back to T036.
- [ ] T038 [US1] [ext] In `sbml-exporter`: the layout from the diagram files. `LayoutConverter`'s algorithm, ported over `diagram/{stId}.json` of the same release (R3), keeping:
  - the same ids, order and glyph sets;
  - the same roles and backbone rules;
  - the hidden compartments, the SBO override and the root attributes.

  It is written only for an event whose own diagram draws a reaction.

- [ ] T039 [US1] Compare the layouts with today's files (T004) over the sample's events with diagrams: glyph sets, ids, roles, order and targets exactly; coordinates against the recorded offset and the resized nodes. Compare every event's model again, outside the layout, byte for byte (FR-002). Record each difference in `contracts/differences.md`.
- [ ] T040 [US1] [ext] In `sbml-exporter`: a graph-only command line. The relational options are dropped. The graph converter with its layout is used for listed ids, species and `all`, writing every pathway of a species as today. File names stay `{stId}.sbml`, and the archives stay as today.
- [ ] T041 [US1] A graph-only bulk dry run for one species, from T032's copy, compared with the release's published archive (T033): the same file names, every file valid (libSBML), and a sample of files compared as in T037 and T039. Record the run's time.
- [ ] T042 [US1] [ext] In `sbml-exporter`'s CI: libSBML's consistency check over the converter's output for a small fixture graph, failing on any error.
- [x] T043 [US1] Spec 010 amended for this spec (R10):
  - a notice at the top of each of its documents: SBML from the graph-only converter, proven by this spec's comparison; a BioPAX operation; the JDK 17 runtime; SBML cut over here;
  - its tasks T011, T014, T017, T028 and T029, and its plan's runtime line, changed to match.

  — #646

- [ ] T044 [US1] Route the website's SBML through spec 010's library service, once it serves the operation (spec 010 T011–T022) and T037 and T039 have passed:
  - node answers `/ContentService/exporter/event/{id}.sbml` and `/exporter/sbml/{id}.xml`, slashed forms included, with R6's headers and errors, through spec 010's pass-through;
  - it caches per release under spec 011, and answers 503 in the envelope when the service cannot answer;
  - the routes go in nginx and the dev proxy alike, and `routes.spec.ts` follows, with `.sbgn` kept as Java's neighbour;
  - the parity harness compares status, headers and errors with Java's, and T030 compares the body;
  - check before and after on beta.

**Checkpoint**: SBML needs no relational database, for the release or the website.

---

## Phase 5: User Story 2 — BioPAX Level 3 from the graph, one exporter (Priority: P2)

**Goal**: `BioPAX3Exporter` makes the Level 3 species files and the website's BioPAX, with today's content.

**Independent Test**:

- its species files compare with the release's published `biopax.zip` by meaning;
- its per-event files compare with the legacy service's;
- every difference is recorded;
- every file is valid.

- [ ] T045 [US2] [ext] In `BioPAX3Exporter`: physical entities with their entity references and cross-references (UniProt, ChEBI and the rest, data-model.md), complex components and cellular locations. Unit tests for each.
- [ ] T046 [US2] [ext] In `BioPAX3Exporter`: reactions with stoichiometry, catalysis with its controller, and regulation (positive and negative, as data-model.md maps them).
- [ ] T047 [US2] [ext] In `BioPAX3Exporter`: literature, evidence, provenance and stable-identifier cross-references.
- [ ] T048 [US2] [ext] In `BioPAX3Exporter`, the modes and the output:
  - the species mode writes each pathway once and includes the events in no pathway;
  - `-l` writes the events it was given;
  - there is a per-reaction export;
  - species files carry `xml:base="http://www.reactome.org/biopax/{release}/{species dbId}#"` as the published ones do (FR-007), held per model rather than statically;
  - the validator is 6.0.0, as the baselines are.
- [ ] T049 [US2] Compare the exporter's species files with the release's published `biopax.zip` (T033), by T031: three species first, then all of them. Then compare its per-event files with the legacy service's over the sample.
  - Record each difference in `contracts/differences.md`.
  - Expected differences: order and ids, EC numbers, chapter authors, and the early return (R4).
  - Anything else goes back to T045–T048.
- [ ] T050 [US2] Validate the exporter's files over the sample and the three species with the BioPAX validator, against T034's baseline.
- [ ] T051 [US2] [ext] In `BioPAX3Exporter`'s CI: the validator over its output for a small fixture graph, failing on any error in the reports.
- [ ] T052 [US2] Serve the website's BioPAX through spec 010's library service, once it serves the operation and T049 and T050 have passed:
  - node answers `/ContentService/exporter/event/{id}.biopax` as R6 decided (`application/rdf+xml`, named by stable id, 404 and 400 in the envelope, 503 when the service cannot answer);
  - it caches per release;
  - it is routed in nginx and the dev proxy alike.
- [ ] T053 [US2] Replace #634's Tomcat location for the legacy path with node's 301, resolving the dbId and redirecting to the stable-id URL (`/ContentService/exporter/event/{stId}.biopax`):
  - in `deploy/nginx/dev.conf`, `routes-core.conf` and the dev proxy, with `routes.spec.ts` and `serve-prod.spec.ts` following;
  - rebuild beta's nginx and check both link forms.
- [ ] T054 [US2] Point the site's two BioPAX links (the download tab and the detail download bar) at `/ContentService/exporter/event/{stId}.biopax`:
  - delete `RESTFUL_API`;
  - update the e2e tests, `RELEASE-TESTING.md` and `CURATOR-REPORT.md`.

  A site rebuild on beta needs the user's OK.

**Checkpoint**: BioPAX Level 3 needs no relational database for the website, and the exporter is proven for the release.

---

## Phase 6: User Story 4 — The release, without the relational database for these formats (Priority: P3)

- [ ] T055 [US4] [ext] With the release's maintainers: the Level 3 step moves from `release-download-directory`'s Pathway-Exchange converter to `BioPAX3Exporter`, keeping `biopax.zip`'s name and layout, after a full dry run compared as in T049.
- [x] T056 [US4] Level 2: decided with the user on 24 Oct 2026. `biopax2.zip` is no longer produced, and the decision is recorded in spec.md's edge cases. With the release's maintainers, the Level 2 step is turned off when the Level 3 step moves (T055). — #646
- [ ] T057 [US4] [ext] With the release's maintainers: `sbml-exporter`'s release run moves to the graph-only command line (T040), after T041.
- [ ] T058 [US4] Record in research.md R9 what is left for whoever retires `release-download-directory`:
  - its other relational steps, and those `data-export` already makes from the graph;
  - what in `sbml-exporter` (its relational half) and the legacy service can go once nothing calls them.

---

## Phase 7: Polish and cross-cutting

- [ ] T059 [P] Close #631 and #632. Update `specs/006-content-service-to-node/tasks.md` Phase 9 and `specs/010-java-services` for the two exports, which are no longer the Java ContentService's.
- [ ] T060 [P] Check the success criteria and record the result here.

---

## Dependencies and execution order

- **Phase 2** blocks the stories.
  - T028 comes before any **[ext]** task in an exporter, and T029 before any that depends on graph-core.
  - T030 and T031 come before any comparison.
  - T032 and T033 come before the comparisons that use them.
- **SBML (US1):** T036 → T037 → T038 → T039 → T040 → T041. T042 follows T036. T044 needs T037 and T039 and spec 010's service.
- **BioPAX (US2):** T035 sets the baseline. T045–T048 can go in any order the maintainers prefer. T049 and T050 need them all. T052 needs T049, T050 and spec 010's service; T053 and T054 follow T052.
- **US4:** T055 after T049. T057 after T041.
- **The libraries:** T061 comes before the website's switches (T044, T052).

## Parallel opportunities

- T030 and T031; T032 and T033.
- The SBML work (Phase 4) and the BioPAX content work (T045–T048), once the issues are agreed.

## Implementation strategy

1. **The issues first.** Nothing in either exporter changes before its maintainers agree.
2. **SBML first.** It has an exact reference and an existing graph-only converter.
3. **BioPAX second.** It has the larger gap, measured by T035's baseline before any building starts. Its main proof is the release's own `biopax.zip`.
4. **Every switch after its proof:** the website's and the release's alike (FR-009).
