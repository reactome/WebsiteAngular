---
description: 'Tasks for spec 033: the last ContentService operations move to node'
---

# Tasks: The last ContentService operations move to node

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [research-psicquic.md](research-psicquic.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Every task**:

- Is one pull request, with its own adversarial review, and ticks this file with its PR number in that same pull request (CLAUDE.md).
- Shows each new check failing before it is trusted (constitution III), on a mutant or on the unfixed code, and says how in the pull request.
- Makes only small, spaced requests: to beta's Java service one at a time with a pause between; to a third-party PSICQUIC server or EBI's ontology service, never a burst.
- Commits nothing server-specific (hosts beyond the public ones, paths, credentials), no token store and no upload's content. Fixtures that come from third-party data carry no personal names: MITAB's author column is replaced by a placeholder, as the fixtures' policy asks.

**Labels**: `[P]` can run beside the other `[P]` tasks of its phase (different files, no dependency between them). `[server]` is done by the session that runs a server holding a token store. `[owner]` needs the project's owner.

---

## Phase 1: Setup

**Purpose**: the versions to match, and the answers to match them against.

- [ ] T001 Record the IntAct libraries the deployed Java service ships in `deploy/java/PINS.md`: interactor-core 1.1.5, micluster 1.7.14, miscore 1.3.14, psimitab 1.8.6, psicquic-registry-client 1.4.0, psicquic-simple-client 1.4.0 and Kryo 5.3.0, each with its source (the tag research-psicquic.md names) and how it was verified (the deployed jars' names). `deploy/java-library/pins.spec.ts` keeps passing (rows the Dockerfile does not build are marked as reference-only, as the table's existing columns allow, or the spec gains that case, shown failing on a row with no source).
- [ ] T002 Record beta's Java answers for the nine operations into `tools/content-node/fixtures/interactors-java/`, small and spaced, as JSON files with their status and headers: each PSICQUIC operation for two resources (one that scores with `intact-miscore`, one whose score is computed) and three accessions; each error case of research R1 (an unknown resource, an empty body, an accession nothing has); an upload of each kind with a placeholder file and each of `Response.java`'s warnings and refusals; a token read for the uploads just made. Write `tools/content-node/fixtures/interactors-java/README.md`: when, how, and which declared fields vary between calls. Delete nothing on beta: the tokens these uploads create are content-addressed and harmless.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the types both families write through, Java's formats, and the settings.

- [ ] T003 [P] In `projects/contract/interactors.ts`: widen `Interactors.resource` from `'static'` to the resource's name as Java writes it (T002's recordings settle the form), and add `TupleResult`, `CustomPsicquicResource` and their `Summary` as the recordings show them. Regenerate `projects/contract/openapi.json` (`node tools/contract/generate.ts`). Add the nine operations' rows to `projects/contract/routes.ts`, so that `tools/api-types/schema.spec.ts` checks T002's recordings against the types. Show the schema check failing on a recording with a field renamed.
- [ ] T004 [P] JDK 11's `Float.toString`, and the conversion through it that miscore makes (`Float.toString` then `Double.parseDouble`), in `tools/content-node/java-float.ts` with `java-float.spec.ts`. Cases taken from Java itself: a table of floats and their strings, written by `jshell` on the JDK 11 binary (not 21: they differ), committed as `tools/content-node/fixtures/java-float.txt`, as `java-double.txt` was. Single-precision arithmetic (`Math.fround` at each step) is included where research-psicquic.md's score needs it.
- [ ] T005 [P] A model of `ConcurrentHashMap`'s iteration order, beside `HashMap`'s, in `tools/content-node/java-hashmap.ts` and its spec, with cases from Java for colliding keys. Research-psicquic.md §12 names where Java's PSICQUIC answers depend on it.
- [ ] T006 [P] The new settings in `tools/content-node/settings.ts` ([contracts/settings.md](contracts/settings.md)): the five `PSICQUIC_*` and the three upload settings, each typed, each with its default, each read when it was before (spec 013 T018's rule). In `docker-compose.yml`, mount `PSICQUIC_CACHE_DIR` and `CUSTOM_INTERACTORS_DIR` read-write from the deployment's `.env`, each defaulting to an empty folder in the repository (as `DIAGRAM_FILES_DIR` does). Create `deploy/content-node/compose.spec.ts`, modelled on `deploy/java-library/compose.spec.ts`, checking content-node's two new mounts and their empty defaults; show it failing with a mount missing.

**Checkpoint**: the contract, Java's formats and the settings are in place; both stories can start.

---

## Phase 3: User Story 1 - Third-party interactors without the wait (Priority: P1) 🎯 MVP

**Goal**: node answers the four PSICQUIC operations byte for byte as Java does, from a cache shared between visitors, with each fetch bounded.

**Independent test**: quickstart §1 and §2: paired answers equal over the sample; a second visitor's counts appear within a second; a server that never answers costs at most the timeout.

Each part is a pure module with its own spec, driven by fixtures from T002 and research-psicquic.md, and written from the published method and the recorded behaviour, not from IntAct's code (research R2).

- [ ] T007 [P] [US1] MITAB 2.5 parsing as psimitab 1.8.6 reads it, in `tools/content-node/psicquic-mitab.ts` with its spec: the fifteen columns, escapes, `-` for empty, multiple values, the errors research-psicquic.md §4 names (`"Couldn't parse PSICQUIC result"`, `"Empty String passed to create Field"`). Fixtures: MITAB fetched once per resource kind for two accessions, the author column replaced by a placeholder, in `tools/content-node/fixtures/psicquic-mitab/`.
- [ ] T008 [US1] Clustering as micluster 1.7.14 does it, in `tools/content-node/psicquic-cluster.ts` with its spec: the mapping database lists (the client's own for details, `uniprotkb,chebi` for summaries), which identifiers are merged, and the cluster order (§5, §12). Pinned by a fixture whose expected clusters come from T002's Java answers.
- [ ] T009 [US1] The MI-score as miscore 1.3.14 computes it, in `tools/content-node/psicquic-score.ts` with its spec, every quirk of §6 deliberate and commented with what breaks without it: single precision, the null-key count, the parent chosen by hash-map order, `Float.toString` (T004). The ontology terms are a snapshot of OLS4's **first page** for each of the eight branches, as Java receives it, in `tools/content-node/fixtures/psicquic-ontology.json`, with a script that retakes it (`tools/content-node/snapshot-psicquic-ontology.ts`, run by hand, its date recorded in the file). The spec shows the score from the full ontology differing (the 3-of-59 finding) and the first page matching.
- [ ] T010 [US1] The per-resource clients, in `tools/content-node/psicquic-clients.ts` with its spec: each client's database list, score column (`intact-miscore` then `miscore`; `NBC` for Reactome FIs; `intact-miscore` only for ZINC; the computed score otherwise), alias, evidence count, `accURL` and `evidencesURL`, as §7 lists them.
- [ ] T011 [US1] From clusters to the answer, in `tools/content-node/psicquic-answer.ts` with its spec: the swap so the asked accession is A, the `>= 0.45` filter before rounding, rounding to 0.001, de-duplication by a sorted set that compares the score only, the stable sort and reverse, entity order and id numbering by Java's hash-map order (T005 for the POST's two threads), the summary's count before de-duplication (§10), and Jackson's non-empty writing (no `entities` key when nothing is found). T002's answers are reproduced byte for byte from their recorded MITAB.
- [ ] T012 [US1] Fetching, in `tools/content-node/psicquic-fetch.ts` with its spec, against stub servers on loopback: the resource looked up in node's registry reading (`psicquic.ts`), case-insensitive, inactive ones asked as Java asks them; the URL `restUrl + "interactor/" + encoded accession` as Java builds it; `PSICQUIC_TIMEOUT_MS` per fetch; `PSICQUIC_PER_SERVER` at once per server, in arrival order; a failed or timed-out fetch handled as Java handles a failed fetch (left out of a POST, the "not responding" 500 for a GET); each of §11's errors in the envelope.
- [ ] T013 [US1] The cache, in `tools/content-node/psicquic-cache.ts` with its spec (research R3): the key (operation, registry name, accessions split as Java splits them, sorted); gzip files in `PSICQUIC_CACHE_DIR` named by the key's SHA-256; one day's life; only a 200 with every accession answered is kept; requests for a key in flight share one promise; the cap with least-recently-used eviction; an answer over a tenth of the cap served but not kept; the index rebuilt from the folder at start; no folder set means no cache. The spec's stub server counts what it is asked, so "served from the cache" is measured, not assumed (constitution I).
- [ ] T014 [US1] The four operations, in `tools/content-node/interactors-psicquic-endpoints.ts`, added to `tools/content-node/registry.ts` in the order `fixtures/route-order.json` records, writing through `nonEmptyJson<Interactors>` (T003); `boundaries.spec.ts` keeps the family importing only shared modules. Each operation's spec runs against stub servers. **Not routed yet**: `deploy/nginx/routes.spec.ts`'s `NOT_YET_ROUTED` names all four with this task's number.
- [ ] T015 [US1] Parity on beta (research R4, quickstart §1): node started on a spare port beside beta's; the 20-pathway sample crossed with every live resource; the POSTs (details and summary) and the GETs (three accessions a pathway); the error cases. Each pair sent at the same moment, with a second Java-only pair; a difference counts only if Java's own pair does not show it. The ontology snapshot retaken the same day. Record the run and its result in research.md (a new R8): counts compared, equal, explained by Java's own variation, and any left. **Any part left unmatched** gets a fallback task added here (node calls that part alone in `deploy/java-library`, at T001's versions), and this task stays open until it is matched.
- [ ] T016 [US1] Route the four: their locations in `deploy/nginx/common/routes-core.conf` (every deployment) and `proxy.conf.js`, removed from `NOT_YET_ROUTED`; `deploy/nginx/test-config.sh` passes for every deployment. In the same PR: the declared differences (the per-fetch timeout, the ontology snapshot) as rows in `documentation/declared-differences.md`; spec 006's T101 rewritten as "moved to node by spec 033"; spec 010's operation homes (`specs/010-java-services/contracts/operation-homes.md`) updated. Deploy to beta, then check on beta that the interactors panel's counts arrive, and arrive at once on a second visit.

**Checkpoint**: the PSICQUIC overlays and counts are node's on every deployment, cached, and Java's to three decimal places.

---

## Phase 4: User Story 2 - Every overlay link keeps opening (Priority: P2)

**Goal**: node answers the five custom-interactor operations; every existing token opens as before; new uploads behave as Java's.

**Independent test**: quickstart §3 and §4: every converted token's answer equals Java's; the upload corpus gives the same answers on both.

- [ ] T017 [US2] The conversion program in `deploy/java-library/` (a second entry point in the image, `convert-tokens`, built from T001's interactor-core 1.1.5 and Kryo 5.3.0, reading with `TupleManager`'s exact Kryo set-up): it reads every `<token>.bin` in a folder and writes `<token>.json` as [contracts/token-store.md](contracts/token-store.md) describes, and prints the report the contract names (counts, and each failure's token and exception class; no content). Its tests use `.bin` files the test itself writes with the same classes, one of each kind, plus one that cannot be read. Correct contracts/token-store.md in the same PR if a real object holds more than it lists.
- [ ] T018 [US2] [server] Run T017's program on a copy of beta's token store (by whoever runs beta, with the owner), then on a copy of production's (by the release server's session). Record in research.md (R8 or a new R9) the counts only: read, converted, failed. A failure stops this story until it is understood.
- [ ] T019 [P] [US2] The three upload parsers and their messages, in `tools/content-node/custom-interactors-parse.ts` with its spec (research R6): the format detection, the two-column tuple, the extended format, PSI-MITAB (reusing T007), and every message in `Response.java` word for word, `MessageFormat`'s number grouping included ("Line 1,234 …"). A corpus of placeholder files in `tools/content-node/fixtures/custom-interactors/`, one per accepted form and one per warning and refusal, each with Java's answer from T002 or recorded the same way.
- [ ] T020 [US2] The token store and tokens, in `tools/content-node/custom-interactors-store.ts` with its spec: the token as the MD5 of the name followed by the content; a re-upload returning the stored set; the token checked against its pattern before it names a file (a spec case tries a path with `..`); writing to a temporary file then renaming; `CUSTOM_INTERACTORS_DIR` unset answering the 503 in the envelope.
- [ ] T021 [US2] Reading by token, in `tools/content-node/interactors-custom-endpoints.ts` with its spec: the body split on `,` `;` newline or tab and trimmed; stored pairs answered in Java's `HashSet` order (`CustomInteraction`'s hash, the product of the two identifiers' string hashes, through `java-hashmap.ts`), then the stable sort and reverse; a custom PSICQUIC token answered live through T012 and T013, keyed by its address; an unknown token the envelope's 404.
- [ ] T022 [US2] The four uploads in `tools/content-node/interactors-custom-endpoints.ts`: content, form (the accepted types as Java's sniffing accepts them), by address, and a custom PSICQUIC service. Fetching an address follows research R6's declared differences: certificates checked, `UPLOAD_FETCH_TIMEOUT_MS`, the size limit enforced while reading, only `http` and `https`, no loopback, private or link-local address (checked after the name resolves, so a name pointing inside is refused too), and `UPLOAD_RATE_PER_MINUTE` per client. A spec case for each, each seen failing. All five operations join `registry.ts`, **not routed yet** (`NOT_YET_ROUTED`).
- [ ] T023 [US2] Parity (quickstart §3 and §4): every token converted from beta's store asked of both services, over its own identifiers plus three it does not hold; the upload corpus sent to both, as content, form and address (the address served from a scratch folder through a temporary local server). Record the counts in research.md. Every token must match (SC-004); any difference stops the routing until it is explained.
- [ ] T024 [US2] Route the five: `routes-core.conf` and `proxy.conf.js`, out of `NOT_YET_ROUTED`; `test-config.sh` for every deployment. In the same PR: the declared differences of research R6 (certificates, timeout, size, private addresses, rate) as rows in `documentation/declared-differences.md`; spec 006's T102 rewritten as "moved to node by spec 033"; spec 010's operation homes updated. Each deployment's `.env` gains `CUSTOM_INTERACTORS_DIR` pointing at its converted store before the route moves there (beta now; the release server and production by their session, [server]). Deploy to beta and open an old overlay link and a new upload.

**Checkpoint**: no interactor operation reaches the Java service on beta.

---

## Phase 5: User Story 3 - The old ContentService is switched off (Priority: P3)

**Goal**: nothing reaches the old Java ContentService on any deployment; after one release it is removed and its repository archived.

**Independent test**: quickstart §5: with it stopped on beta, every published operation answers and the end-to-end suite passes.

**Depends on**: US1 and US2 routed; spec 015 T068 (event SBML, SBGN and BioPAX on the release server and production) and spec 006 T100 (the event PDF there), which wait for those servers to run the library service and pdf-export (spec 032).

- [ ] T025 [US3] Send the `/ContentService/` catch-all in `deploy/nginx/common/routes-core.conf` to node, and its equivalent in `proxy.conf.js`; `NOT_YET_ROUTED` is empty and removed. Add a test in `deploy/nginx/routes.spec.ts` that no location in any deployment's configuration sends a `/ContentService` path to Tomcat, shown failing while one still does. Keep a commented line ready to send the catch-all back, with the condition for using it.
- [ ] T026 [US3] [owner] On beta, with the owner (stopping a webapp needs them): stop the old ContentService, call every published operation with its documented example through the site, and run the end-to-end suite (SC-006). Start it again afterwards. Record the result here.
- [ ] T027 [US3] [owner] After one release with nothing routed to it on any deployment: remove the ContentService webapp from each server's application server (each server's session), and record the date here.
- [ ] T028 [US3] [owner] Archive `reactome/content-service`, with a README naming each operation's home: node (most), the library service (any fallback part from T015, and the token conversion), or retired. Record it in `specs/010-java-services/contracts/operation-homes.md`.

---

## Phase 6: Polish & cross-cutting concerns

- [ ] T029 [P] Measure the interactors panel before T016 and after it, on beta, with a scripted browser: the time until every resource's count shows, for three pathways, on a first and a second visit (SC-001). Record it in research.md.
- [ ] T030 [P] `RELEASE-TESTING.md` and `CURATOR-REPORT.md`: the counts' speed (reader-visible), and any declared difference a reader could notice (an upload by address refused for a private address). Only what a reader sees.
- [ ] T031 Check every success criterion (SC-001 to SC-007) and record the result here.

---

## Dependencies and order

- **Phase 1** (T001, T002) before everything. T002 needs only beta.
- **Phase 2** (T003–T006) before the stories. T003–T006 are independent of each other.
- **US1:** T007 → T008 → T009 → T010 → T011 (each consumes the last; T009 also needs T004, T011 needs T005) → T012 → T013 → T014 → T015 → T016.
- **US2:** T017 → T018; T019, T020 in parallel with them; T021 needs T020 (and T012, T013 for custom PSICQUIC tokens); T022 needs T019 and T020; T023 needs T018, T021 and T022; then T024.
- **US3:** needs T016 and T024, and spec 015 T068 and spec 006 T100; then T025 → T026 → (one release) → T027 → T028.
- **Polish:** T029's "before" is taken before T016 merges; T030 with T016 and T024; T031 last.

## Parallel opportunities

- T003, T004, T005, T006 together.
- T007 can start beside T004 and T005.
- In US2, the parsers (T019) beside the conversion program (T017).
- US2 can run beside US1 once Phase 2 is done, except T021's custom PSICQUIC tokens, which need T012 and T013.
- In this project, "parallel" means independent pull requests in a queue: one agent at a time, each reviewed and merged in turn.

## Implementation strategy

- **MVP: User Story 1.** It is the reported slowness, and it carries no stored data. After T016, every visitor sees the counts at once for pathways asked about that day.
- **Then User Story 2.** It needs the server sessions for T018 and the store mounted on each deployment.
- **Then User Story 3,** when the event exports have moved on the release server and production.
- **Release work comes first:** these tasks are taken in step with the December release's own work, not ahead of it.
