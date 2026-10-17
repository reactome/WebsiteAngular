# Tasks: The Java side of Reactome's services

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**:

- **Required.** The constitution (III) asks for every behaviour to be shown failing before it is trusted. Each test task below is run against the unfixed state (a misroute, a fallback, a deliberately altered candidate) and seen to fail, and the PR says so.

**Conventions**:

- **[EXT]** marks a task that needs people outside this repository: the owners of another Reactome repository, or access to the production logs. Raise it and record the answer here; do not work around it.
- **Paths:** paths are this repository's, unless a task names the new library-service repository (called `<library repo>` here until its owners name it).
- **Settings:** host-specific settings come from the deployment's environment, never from either repository.
- **Ticking:** the PR that completes a task ticks it here with its number (CLAUDE.md).

## Format: `- [ ] T### [P?] [US#?] Description`

---

## Phase 1: Setup

- [ ] T001 [EXT] Ask the Reactome organisation's owners to create the library-service repository, licensed AGPL-3.0 (research R2), and record its name in this file and in `plan.md`
- [ ] T002 [EXT] Ask the owners of `reactome/content-service` and `reactome/analysis-service` to merge the deployed branches (`7b9eceb` on `add-content-page-endpoints`; `9b147e1`, PR #25). The pins stay on these commits either way (research R1).
- [ ] T003 [P] Record the pinned commits of research R1 in one place, `deploy/java/PINS.md`, each with the reason it is pinned and how it was verified (byte comparison of classes)

---

## Phase 2: Foundational (blocks Stories 2 and 3)

**Purpose**: the routing tests know three outcomes and read every file that routes, and the parity harness exists.

### Tests first

- [ ] T004 Extend `deploy/nginx/routes.spec.ts`:
  - parse `deploy/nginx/common/routes.conf` as well as `routes-core.conf`, in nginx's order;
  - classify each `proxy_pass` as node, Java service or Tomcat;
  - assert that no URL in node's endpoint samples or the proxy-order node list reaches a Java service or Tomcat.
  - Show it failing by adding a location that sends a node URL to Tomcat.
- [ ] T005 Add a test in `deploy/nginx/routes.spec.ts` that an exporter address routed away from Tomcat keeps the exporter location's rate limit. Show it failing with a `routes-core.conf` location for `/ContentService/exporter/event/` (research R6 trap).

### Implementation

- [ ] T006 Create the parity harness in `tools/java-parity/`, per research R7:
  - same request to a reference and a candidate, same Host;
  - compare status, a fixed header set and the SHA-256 of the body;
  - per-class normalisers, declared in `tools/java-parity/normalisers.mjs`;
  - JSON report of identical, different and both-error counts, with no bodies or token values in the output.
- [ ] T007 Add a self-test to `tools/java-parity/parity.spec.mjs`. Two stub servers that differ in one byte must report a difference; identical stubs must not. Show it failing with the comparison disabled.
- [ ] T008 [P] Add the PDF normaliser to `tools/java-parity/normalisers.mjs`:
  - `qpdf --qdf --object-streams=disable --static-id`, run in a throwaway container;
  - mask CreationDate, ModDate and the cover-page date.
  - Test it in `tools/java-parity/parity.spec.mjs`: two PDFs differing only in those fields compare equal, and a PDF with a changed body does not.

**Checkpoint**: routing tests know three outcomes; the harness detects a one-byte difference.

---

## Phase 3: User Story 1 — the split is recorded (P1)

**Goal**: every published operation has one home and a reason.
**Independent test**: [quickstart](quickstart.md#story-1-the-split-is-recorded).

- [x] T009 [US1] Record all 137 published operations with home and reason in `specs/010-java-services/contracts/operation-homes.md` — #504
- [ ] T010 [US1] Add `specs/010-java-services/check-operation-homes.mjs`, which compares `contracts/operation-homes.md` against a freshly fetched API description of both services and fails on a missing, extra or duplicated operation. Show it failing by deleting one row.

---

## Phase 4: User Story 2 — the Java library service (P2)

**Goal**: the 13 Java-homed ContentService operations answer from a service built from Reactome's libraries at pinned commits, through node, byte-identical to today.
**Independent test**: [quickstart](quickstart.md#story-2-the-java-library-service).
**Depends on**: T001 (repository), Phase 2.

### The service (in `<library repo>`)

- [ ] T011 [US2] Scaffold the Spring Boot application in `<library repo>`, with Java 11 bytecode, an executable jar, and a health endpoint reporting the pinned library commits
- [ ] T012 [US2] Copy, unchanged, content-service's PSICQUIC controller and manager, and the `Interactors` JSON models, into `<library repo>`. Each file names its source commit (`7b9eceb`).
- [ ] T013 [US2] Copy the upload and token controllers, `CustomInteractorManager`, `TupleManager` with its Kryo set-up, and the store's LRU checker into `<library repo>`. Pin interactor-core 1.1.5 and Kryo 5.3.0 and freeze them, with a comment saying why: old tokens stop reading if either changes.
- [ ] T014 [US2] Copy the SBML, SBGN and event-PDF exporter controllers, `ExportManager` and its cache into `<library repo>`. Exclude Aspose.Slides from diagram-exporter (research R8).
- [ ] T015 [US2] Copy content-service's exception-to-status mapping (its error envelope) into `<library repo>`, so error bodies are Java's
- [ ] T016 [US2] Read every setting at run time, from system properties or environment, in `<library repo>`. None is baked in; startup fails clearly when one is missing.

### The image and deployment (this repository)

- [ ] T017 [US2] Create `deploy/java-library/Dockerfile`: a multi-stage build that builds each pinned Reactome library from its commit (`deploy/java/PINS.md`) and then the service, on JDK 11 (JDK 17 for event-pdf, targeting 11). Run as a non-root user.
- [ ] T018 [US2] Add the `java-library` service to `docker-compose.yml`:
  - loopback only;
  - heap and memory limit from research R3: 1 GiB heap, 1.5 GiB limit;
  - volumes per `data-model.md`: overlay-token store read-write, analysis tokens read-only, export cache read-write, release files read-only;
  - the JVM's timezone and locale equal to Tomcat's (research R7, SBML dates);
  - a health check.
- [ ] T019 [US2] Add `java-library` to `deploy/nginx/test-config.sh`'s neighbours, if nginx names it. Confirm `nginx -t` still passes for every deployment.

### Node's pass-through: tests first

- [ ] T020 [P] [US2] Write `tools/content-node/java-pass-through.spec.mjs` from [contracts/pass-through.md](contracts/pass-through.md), against a stub Java server. The cases:
  - method, path and query unchanged, including matrix parameters;
  - a streamed body over 10 MB arrives whole;
  - Host unchanged and X-Forwarded-For appended;
  - hop-by-hop headers dropped;
  - response headers and bytes unchanged, gzip included;
  - stub down gives 503 in ContentService's envelope;
  - no headers within the timeout gives 504;
  - a failure after headers truncates the response;
  - a client disconnect aborts the upstream request.
  - Show them failing before T022.
- [ ] T021 [P] [US2] Write a disjointness test in `tools/content-node/java-pass-through.spec.mjs`: no pass-through pattern matches any node endpoint sample or proxy-order node URL, and node holds no Tomcat address. Show it failing with an overlapping pattern.

### Node's pass-through: implementation

- [ ] T022 [US2] Implement `tools/content-node/java-pass-through.mjs` with `node:http` and `stream.pipeline`, one keep-alive agent per service, and no new package. Mount its table first in `app()` in `tools/content-node/service.mjs`.
- [ ] T023 [US2] Make content-node's shutdown in `tools/content-node/service.mjs` drain in-flight requests within a bound, and set the matching `stop_grace_period` in `docker-compose.yml`. Test that a request in flight completes across a stop.

### Parity, then cutover, one address group at a time

Each cutover is one PR. It adds the group's patterns to node's table, one nginx location per address in `deploy/nginx/common/routes-core.conf` (exporters: inside `routes.conf`'s rate-limited location), and the same in `proxy.conf.js` and `projects/website-angular/src/scripts/proxy-order.spec.ts`.

- [ ] T024 [US2] Run PSICQUIC parity: paired simultaneous requests against the running server and the candidate, plus a reference-against-reference pair, over every active resource from node's `/interactors/psicquic/resources` and error cases. Record the report.
- [ ] T025 [US2] Cut over the PSICQUIC queries (4 operations). Check on the deployed site that a PSICQUIC overlay draws interactors through node.
- [ ] T026 [US2] Run token and upload parity:
  - read every existing overlay token through both sides, from a read-only copy of the store; report counts only;
  - send uploads (tuple content, form, URL; a PSICQUIC URL on loopback) to a reference container and the candidate, each with a throwaway store;
  - compare the bytes, then have each side read the other's files.
- [ ] T027 [US2] Cut over uploads and tokens (5 operations). Check on the deployed site that a shared overlay link opens, and that a fresh upload's token reads back after a restart.
- [ ] T028 [P] [US2] Run SBGN and SBML parity: a byte comparison over a sample of pathways and reactions, with the candidate's timezone and locale equal to the reference's
- [ ] T029 [US2] Cut over SBGN and SBML (2 operations), inside the exporter's rate-limited location. Check on the deployed site that the download buttons return the files through node.
- [ ] T030 [US2] Run event-PDF parity with the PDF normaliser, including requests with an analysis token
- [ ] T031 [US2] Cut over the event PDF (1 operation). Check on the deployed site that the PDF download works.
- [ ] T032 [US2] Fail the Java service on purpose on the deployed site: stop `java-library` and check every cut-over address answers 503 in the envelope while node's own pages are unaffected. Start it again.
- [ ] T033 [US2] Adversarial review, CI, merge and deploy for each PR above. Tick T011–T032 with their PR numbers.

**Checkpoint**: 12 of the 13 Java-homed operations answer from the library service. The events hierarchy stays on Tomcat (research R3).

---

## Phase 5: User Story 3 — AnalysisService from this deployment (P3)

**Goal**: AnalysisService runs unchanged from its pinned commit in its own container, routed by nginx.
**Independent test**: [quickstart](quickstart.md#story-3-analysisservice).
**Depends on**: Phase 2. It can start in parallel with Phase 4's cutovers.

### Tests first

- [ ] T034 [US3] Build the replay corpus in `tools/java-parity/analysis-corpus/`:
  - the 11 example submissions from `projects/pathway-browser/src/assets/data/analysis-examples/`;
  - the request shapes seen in `e2e/har/`: projection, interactors, disease, sort, page size, resource, species comparison, token follow-ups, downloads;
  - no `/identifiers/url` call except to loopback.
  - Show the harness reporting a difference when the candidate is altered, for example a different page size.
- [ ] T035 [P] [US3] Add the analysis normalisers to `tools/java-parity/normalisers.mjs`: remove `summary.token`, compare `result.json.gz` decompressed, and apply the PDF normaliser plus the token to report PDFs. Test each.

### Implementation

- [ ] T036 [US3] Create `deploy/analysis/Dockerfile`: build `reactome/analysis-service` at `9b147e1`, with analysis-core at `74e3ffe` and analysis-report at `67062e7` built from source, Aspose excluded, JDK 11, non-root
- [ ] T037 [US3] Add the `analysis` service to `docker-compose.yml`:
  - loopback only;
  - 3 GiB heap and about 4 GiB limit (research R3);
  - volumes: the release's analysis data read-only (one file), tokens read-write, export temp on tmpfs, release files read-only;
  - settings at run time;
  - a health check.
- [ ] T038 [US3] Run analysis parity against the running server:
  - the reference and the candidate each get their own writable token folder, never a shared one;
  - first submission compared with first;
  - follow-ups use each side's own token.
  - Record the report.
- [ ] T039 [US3] Read a sample of at least 100 existing analysis tokens through the candidate, from a read-only copy of the token store, and compare with the running server (SC-003). Report counts only.
- [ ] T040 [US3] Route `/AnalysisService/` to the `analysis` container in nginx (`deploy/nginx/common/routes-core.conf`), and in `proxy.conf.js` for the dev server, keeping the existing rate limits. Extend `deploy/nginx/routes.spec.ts` with its outcome.
- [ ] T041 [US3] Check on the deployed site: run an analysis from the Pathway Browser, reopen it by its token, download the CSV and the report, and see the requests answered by the new container
- [ ] T042 [US3] Move the events hierarchy:
  - either load the analysis data in `java-library`, raising its budget to research R3's 3 GiB heap now that Tomcat's copy is gone;
  - or use a per-release sizes file, if the team prefers.
  - Then run parity per main species, cut over, and check the events tree on the deployed site.
- [ ] T043 [US3] Adversarial review, CI, merge and deploy for each PR above. Tick T034–T042.

**Checkpoint**: both Java services answer everything homed in them; Tomcat answers only what is not yet moved.

---

## Phase 6: User Story 4 — the shared application server switched off (P4)

**Goal**: Tomcat answers nothing and is switched off, reversibly.
**Independent test**: [quickstart](quickstart.md#story-4-tomcat-off).
**Depends on**: Phases 4 and 5, and the node ports of spec 006 for every operation homed in node.

- [ ] T044 [EXT] [US4] Measure each of the nine other Tomcat webapps' use from the production access logs over at least 30 days: request counts by path prefix and referrer domains, never client addresses. Record only the aggregates in `specs/010-java-services/webapp-inventory.md`.
- [ ] T045 [US4] Decide a home or a retirement for each of the nine (FR-020), with the team, in `specs/010-java-services/webapp-inventory.md`. Partner-embedded widgets and the search no-result report service are known to be in use.
- [ ] T046 [US4] Implement each decision from T045 as its own task (to be added here when decided)
- [ ] T047 [US4] Write a test in `deploy/nginx/routes.spec.ts` that no location reaches Tomcat. Show it failing while any prefix still does.
- [ ] T048 [US4] Point the `/ContentService/` and `/AnalysisService/` prefixes away from Tomcat in `deploy/nginx/common/routes-core.conf`. Keep one commented, ready-to-restore location per address for rollback (FR-013, FR-014).
- [ ] T049 [US4] With Tomcat stopped, run the end-to-end suite, the release checks, and a call to every published operation with a valid example. All pass (SC-004).
- [ ] T050 [US4] Prove one-address rollback: route one address back to a restarted Tomcat, check only it moves, then restore it (SC-005)
- [ ] T051 [EXT] [US4] Keep Tomcat installed but unrouted through one Reactome release, then switch it off at the host

---

## Phase 7: User Story 5 — one definition of the analysis result (P5)

**Goal**: the site's analysis types are checked against real results.
**Independent test**: [quickstart](quickstart.md#story-5-analysis-result-types).
**Depends on**: T038 (the recorded corpus).

- [ ] T052 [US5] Write a test that checks every recorded result from the parity corpus against the site's analysis result type (projects/pathway-browser's analysis model). Show it failing by removing a field the site reads from one recorded result.
- [ ] T053 [US5] Make the site's analysis model the one definition: generate it from, or check it against, the corpus, and remove hand-copied duplicates. Run the type check and the end-to-end suite.

---

## Phase 8: Polish and side findings

- [ ] T058 [EXT] Decide the analysis report's species overview figure. The PDF report embeds the retired Fireworks image, drawn by Java's fireworks-exporter; the site's overview is now the Reacfoam (Voronoi) map. Showing that in the report needs analysis-report changed upstream (its owners) or the figure supplied to it.

- [ ] T054 [P] Set `client_max_body_size` in `deploy/nginx/local.conf` to match the other deployments (64 MB), so local uploads over 1 MB are not refused. Test it with `deploy/nginx/test-config.sh`.
- [ ] T055 [P] Declare the proxy package that `projects/website-angular/src/scripts/serve-prod.js` uses in `package.json` (it is only present as a dev-only transitive dependency), and check the lockfile changes only that entry
- [ ] T056 Update `specs/006-content-service-to-node/tasks.md` Phase 9 rows with the PR that moved each Java-homed operation, as each moves
- [ ] T057 Update the curator-facing documents if any reader-visible behaviour is touched by a cutover (constitution: Development Workflow)

---

## Dependencies and order

- **Setup (T001–T003)** first. T001 blocks Phase 4's service work. T002 does not block anything.
- **Foundational (T004–T008)** blocks Phases 4 and 5.
- **Story 1** is done in this PR except T010, which is independent.
- **Story 2 (Phase 4) and Story 3 (Phase 5)** can run in parallel after Phase 2. The events-hierarchy move (T042) waits for both and for AnalysisService's cutover.
- **Story 4 (Phase 6)** waits for Phases 4 and 5 and for spec 006's node ports.
- **Story 5 (Phase 7)** waits for T038.
- **Within each cutover:** parity first, then the routing change, then verification on the deployed site.

## Parallel opportunities

- T003 alongside T001 and T002.
- T020 and T021 (pass-through tests) alongside T011–T016 (the service, in another repository).
- T028 (SBGN/SBML parity) alongside T026 (token parity).
- T034–T037 (AnalysisService build and corpus) alongside Phase 4's cutovers.
- T054 and T055 at any time.

## Implementation strategy

1. **MVP:** Phase 2 and Story 2's first group, PSICQUIC (T004–T008, T011–T025). It proves every part of the pattern on the smallest, most self-contained operations: building from pinned commits, the pass-through, parity, and a reversible cutover.
2. **Then** tokens and uploads, the exporters, AnalysisService, the events hierarchy, and Tomcat off, each a separately deployable and reversible step.
3. **Any step that fails parity is not routed.** The address stays on Tomcat until the difference is fixed or declared with its rule.
