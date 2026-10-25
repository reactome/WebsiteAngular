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

**Each exporter's own work is specified in its own repository** (decided with the user, 24 Oct 2026). Each exporter repository adopts Spec Kit (its adoption pull request adds a constitution and a `CLAUDE.md`), and its first spec takes over this file's **[ext]** tasks for that exporter:

- **`BioPAX3Exporter`:** T045–T048, T051 and its half of T061;
- **`sbml-exporter`:** T036, T038, T040, T042 and its half of T061.

Here they stay as the website's view of that work: each is ticked when the exporter's spec ticks it, with that repository's pull request. This spec keeps what happens in this repository, the comparisons that use its instruments, and the switches.

Both exporters' adoption pull requests found that their own checks do not run yet, and each first spec starts by making them real:

- **`sbml-exporter`:** `main` does not compile (an unpinned snapshot dependency), there are no tests, and its lint uses the wrong rules;
- **`BioPAX3Exporter`:** `mvn test` compiles none of its tests, and its ktlint check never runs in CI.

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

- [x] T028 Post the two issues once the user has read and approved them, and record their links here: [BioPAX3Exporter#4](https://github.com/reactome/BioPAX3Exporter/issues/4) and [sbml-exporter#14](https://github.com/reactome/sbml-exporter/issues/14), posted on 24 Oct 2026. Spec Kit adoption pull requests: [BioPAX3Exporter#5](https://github.com/reactome/BioPAX3Exporter/pull/5) and [sbml-exporter#15](https://github.com/reactome/sbml-exporter/pull/15). — #648
- [ ] T029 [ext] Agree graph-core and the JDK with both exporters' maintainers: each works on the graph-core version spec 010's library service pins, on JDK 17 (R10). Record the version here.
- [x] T030 [P] [ext] The SBML comparison tool is `sbml-exporter`'s `ci/compare.py` (its spec 001, T016 for the model, T021 for the layout), not a tool here (decided 24 Oct 2026). It compares element by element with today's relational file of the same release, order and the timestamp set aside; it is shown failing on a removed species reference, a changed sboTerm and, for the layout, a moved glyph. Tick this when its T021 has merged. — sbml-exporter #32 (the model), #47, #51, #52 (the layout, each key proven by its test files)

- [ ] T031 [P] Write the BioPAX comparison tool, `tools/exports-compare/biopax-compare.ts`, with its spec:
  - each file canonicalised to (class, property, target-key) triples, with `rdf:ID`s replaced by content keys (R4);
  - accepted differences read from `contracts/differences.md`;
  - authors and curation comments hashed.

  It takes a species file as well as an event's. Show it failing on a changed stoichiometry and a removed xref.

- [ ] T032 The private graph copy (R8), for the release being compared, recreated whenever a comparison needs it and removed afterwards. If beta's graph has moved to a newer release by then, regenerate today's per-event answers (T004) for that release, and compare with that release's download directory.
- [ ] T033 (`biopax.zip` and `homo_sapiens.3.1.sbml.tgz` done for release 97, recorded in `today.md`; `all_species.3.1.sbml.tgz` when T041 needs it.) Fetch the release's bulk references from its download directory, `download.reactome.org/{release}/`: `biopax.zip`, `all_species.3.1.sbml.tgz` and `homo_sapiens.3.1.sbml.tgz`. One at a time, kept outside the repository (they hold people's names). Record each file's size, digest and list of entries in `today.md`, never their content.
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

- the sample's models match today's relational files element by element;
- the layouts match today's by meaning;
- a graph-only bulk run matches the release's published archives in file names and in a sample of files;
- the website's SBML comes from the exporter.

- [x] T036 [US1] [ext] In `sbml-exporter`: fix the five defects (R9), each with a test that fails without its fix. Add tests for the two queries' row mapping. — sbml-exporter #22, #23, #24 (into its `graph-only` branch)
- [ ] T037 [US1] Compare the fixed exporter's models with today's relational files over the whole sample (T030), from T032's copy: element by element, order and the timestamp set aside. Done as `sbml-exporter`'s T016; record the result here. So far (24 Oct 2026, sbml-exporter #33–#35): every species matches; what still differs is in its `differences.md`, two kinds still to decide. Since then (25 Oct 2026, sbml-exporter #57): the whole sample run through the graph from the private copy, all 30 files valid. The model's differences are in its `differences.md`: the EC numbers (957 reactions; graph-importer#9), the cross-references (2,695 entries, still to decide in sbml-exporter#36), 3 last-modified dates, 1 `isHomologTo` and 4 SBO terms.
- [x] T038 [US1] [ext] In `sbml-exporter`: the layout from the diagram files. `LayoutConverter`'s algorithm, ported over `diagram/{stId}.json` of the same release (R3), keeping:
  - the same ids, order and glyph sets;
  - the same roles and backbone rules;
  - the hidden compartments, the SBO override and the root attributes.

  It is written only for an event whose own diagram draws a reaction. — sbml-exporter #41, #43, #45 (its spec 002 later replaces this rule)

- [x] T039 [US1] Compare the layouts with today's files (T004) over the sample's events with diagrams: glyph sets, ids, roles, order and targets exactly; coordinates against the recorded offset and the resized nodes. Compare every event's model again, element by element (FR-002). Record each difference in `contracts/differences.md`. — sbml-exporter #47, #50–#53, #57, its differences recorded in its `differences.md`
- [ ] T040 [US1] [ext] In `sbml-exporter`: a graph-only command line. The relational options are dropped (done in sbml-exporter #30, with no switch: its branch reads nothing relational; the diagram folder is left). The graph converter with its layout is used for listed ids, species and `all`, writing every pathway of a species as today. File names stay `{stId}.sbml`, and the archives stay as today.
- [ ] T041 [US1] A graph-only bulk dry run for one species, from T032's copy, compared with the release's published archive (T033): the same file names, every file valid (libSBML), and a sample of files compared as in T037 and T039. Record the run's time.
- [x] T042 [US1] [ext] In `sbml-exporter`'s CI: libSBML's consistency check over the converter's output for a small fixture graph, failing on any error. — sbml-exporter #29, #39
- [x] T043 [US1] Spec 010 amended for this spec (R10):
  - a notice at the top of each of its documents: SBML from the graph-only converter, proven by this spec's comparison; a BioPAX operation; the JDK 17 runtime; SBML cut over here;
  - its tasks T011, T014, T017, T028 and T029, and its plan's runtime line, changed to match.

  — #646

- ~~T044~~ (not a task any more) Superseded by T062–T067 (25 Oct 2026, research R10's amendment): SBML is served on beta from a service started in this repository, not after spec 010's repository exists. Its original text, kept for its list: route the website's SBML through spec 010's library service, once it serves the operation (spec 010 T011–T022) and T037 and T039 have passed:
  - node answers `/ContentService/exporter/event/{id}.sbml` and `/exporter/sbml/{id}.xml`, slashed forms included, with R6's headers and errors, through spec 010's pass-through;
  - it caches per release under spec 011, and answers 503 in the envelope when the service cannot answer;
  - the routes go in nginx and the dev proxy alike, and `routes.spec.ts` follows, with `.sbgn` kept as Java's neighbour;
  - the parity harness compares status, headers and errors with Java's, and T030 compares the body;
  - check before and after on beta.

### SBML on beta, from this repository (research R10, amended 25 Oct 2026)

- [x] T062 [US1] Amend research R10, these tasks and spec 010's notices for SBML served from a service started here (decided 25 Oct 2026). — #657, and its review in #658
- [ ] T063 [US1] The SBML service in `deploy/java-library/` (spec 010's library service, started here with SBML as its only operation):
  - **The build:** a Spring Boot application on JDK 17 with its own `pom.xml`, depending on `sbml-exporter-lib`.
  - **Pinned from source, never from a published snapshot.** `deploy/java-library/Dockerfile` first builds each library from its commit, then the service:
    - `reactome-parent` and its BOM;
    - `graph-core`;
    - `sbml-exporter-lib` from `graph-only`.

    Each commit gets its row in `deploy/java/PINS.md`, with how it was verified:
    - `graph-core` and the parent against the deployed ContentService's jar, as PINS.md's other rows are;
    - `sbml-exporter-lib` by `ci/compare.py` (T037, T039), since its body is not Java's relational answer.

    Changing that pin means rerunning T067's comparison, not `tools/java-parity`.

  - **Where it runs:** host networking, as `content-node`, bound to `127.0.0.1:4360` (`server.address`, never Spring's default 0.0.0.0). It runs as a non-root user.
  - **Time zone and locale:** UTC, which Tomcat's is (measured), with the `en_US` locale, sbml-exporter's dates. Spec 010 T018's "equal to Tomcat's" is to be checked again when SBGN joins, since SBGN's parity is byte for byte.
  - **Its one operation:** `GET /sbml/{stId}` answers the event's SBML from the library, and 404 for an id not in the graph. Node decides everything else (T065).
  - **The release:** the graph's `DBInfo` version, read for every request. It keys both the diagram files and the cached files, so a graph moved to a new release is never answered from the old one.
  - **The diagram files:**
    - fetched on demand from a configured base, `{base}/{release}/diagram/{stId}.json`, only for a pathway that has a diagram;
    - kept on disk per release.

    A fetch that fails is a 503. It never yields SBML without the layout.

  - **The files:** kept on disk per release, as ContentService does. One id is never converted twice at the same time. Node's share of 2 (T065) is the limit, and the service's own cap of 2 is a backstop.
  - **Settings, read at run time:**
    - the graph's address;
    - its credentials file, read literally as `graph.ts` reads it;
    - the diagram base;
    - the cache folder.

    Startup fails clearly when one is missing.

  - **Health:** `GET /health` reports the pinned commits and the graph's release (spec 010 T011).
  - **Checked:**
    - by unit tests, each seen failing first;
    - by a CI job that builds the image and runs it over `sbml-exporter`'s fixture graph at the pinned commit. Its answers must compare equal to that commit's `ci/fixture/expected` by its `ci/compare.py` (both done: sbml-exporter #32, #39).

    The Java build is CI's alone: `scripts/preflight.sh` does not build images. The PR says so.
- [ ] T064 [US1] The `java-library` service in `docker-compose.yml`:
  - host networking and `127.0.0.1:4360`, as T063;
  - a 1 GiB heap within a 1.5 GiB limit (spec 010 research R3);
  - the graph credentials file mounted read-only, as `content-node` mounts it;
  - a cache volume;
  - a health check;
  - `restart: unless-stopped`;
  - built only on the beta host and in CI, and never pushed to a registry.
- [ ] T065 [US1] Node answers `/ContentService/exporter/event/{id}.sbml` and `/ContentService/exporter/sbml/{id}.xml`, slashed forms included, in `exporters-endpoints.ts`.
  - **Node is the service's client here,** not spec 010's pass-through (its T020–T022, which are not prerequisites). It writes R6's headers itself and decides the 404 and 400 from the object's labels.
  - **The body is streamed, not buffered:** Signal Transduction's is 23.5 MB.
  - **The service's address** is a setting read at run time, `SBML_SERVICE`, as `RENDER_TARGET` is. Without it, the endpoint answers 503 in the envelope.
  - **Limits:** `deep`, with a share of 2. The request times out at 290 s, under nginx's 300 s, so the reader gets node's envelope rather than nginx's.
  - **Caching:** per release under spec 011.
  - **Failures:** 503 in the envelope when the service cannot answer or times out, and never a fallback.
  - **Tests,** seen failing first, against a stub service.
- [ ] T066 [US1] The routes, in nginx and the dev proxy alike, once T030, T037's whole-sample run, T039 and every file's validity are recorded (beta's condition under FR-009, below):
  - **nginx:** `routes.conf`, under the render budget, before Java's `exporter/(diagram|document|event)` location, which `routes-core.conf` does not hold; and `local.conf`, without the budget.
  - **`routes.spec.ts`** follows, with `.sbgn` kept as Java's neighbour.
  - **`nginx -t`** for every deployment.

  nginx never names `java-library`, since node reaches it, so spec 010 T019's neighbours do not change.

- [ ] T067 [US1] Check on beta, before and after the switch, over the 30-event sample:
  - status, headers and errors compared with Java's (the parity harness);
  - the bodies compared with today's files (T004) by `compare.py`, every difference one recorded in `sbml-exporter`'s `differences.md`;
  - Signal Transduction's time, cold and cached;
  - the download button on a pathway page.

**FR-009 on beta (decided 25 Oct 2026):** beta switches once the comparison over the whole sample is complete, every difference recorded and every file valid. The differences still open there (the cross-references asked in sbml-exporter#36, and the EC numbers in graph-importer#9) are settled before the release's files or a production site switch, not before beta, which is where the team looks at them.

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
- **SBML (US1):** T036 → T037 → T038 → T039 → T040 → T041. T042 follows T036. T063 → T064 → T065 → T066 → T067; T066 needs T030, T039, T037's whole-sample run and every file's validity (FR-009 on beta).
- **BioPAX (US2):** T035 sets the baseline. T045–T048 can go in any order the maintainers prefer. T049 and T050 need them all. T052 needs T049, T050 and spec 010's service; T053 and T054 follow T052.
- **US4:** T055 after T049. T057 after T041.
- **The libraries:** T061 comes before the website's switches (T066, T052). `sbml-exporter`'s half is done (its T022, sbml-exporter #58–#63); BioPAX3Exporter's is not.

## Parallel opportunities

- T030 and T031; T032 and T033.
- The SBML work (Phase 4) and the BioPAX content work (T045–T048), once the issues are agreed.

## Implementation strategy

1. **The issues first.** Nothing in either exporter changes before its maintainers agree.
2. **SBML first.** It has an exact reference and an existing graph-only converter.
3. **BioPAX second.** It has the larger gap, measured by T035's baseline before any building starts. Its main proof is the release's own `biopax.zip`.
4. **Every switch after its proof:** the website's and the release's alike (FR-009).
