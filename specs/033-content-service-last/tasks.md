---
description: 'Tasks for spec 033: the last ContentService operations move to node'
---

# Tasks: The last ContentService operations move to node

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [research-psicquic.md](research-psicquic.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Every task**:

- Is one pull request, with its own adversarial review, and ticks this file with its PR number in that same pull request (CLAUDE.md).
- Shows each new check failing before it is trusted (constitution III), on a mutant or on the unfixed code, and says how in the pull request.
- Makes only small, spaced requests: to beta's Java service one at a time with a pause between; to a third-party PSICQUIC server or EBI's ontology service, never a burst.
- Commits nothing server-specific (hosts beyond the public ones, paths, credentials), no token store and no upload's content. Fixtures from third-party data carry no personal names: MITAB's author column is replaced by a placeholder, as the fixtures' policy asks.
- Adds any new module where the service's own checks expect it: a shared module to `SHARED` in `tools/content-node/boundaries.spec.ts`, a script that does its work when loaded to `RUN_ON_LOAD` in `tools/load.spec.ts`, and each new route to `tools/content-node/fixtures/route-order.json`.

**Labels**: `[P]` can run beside the other `[P]` tasks of its phase (different files, no dependency between them). `[server]` is done on a server that holds a token store, by whoever runs that server. `[owner]` needs the project's owner.

---

## Phase 1: Setup

**Purpose**: the versions to match, and the answers to match them against.

- [ ] T001 Record in `deploy/java/PINS.md` the libraries the deployed Java service ships for these operations, each with its source and how it was verified (the deployed jars' names): micluster 1.7.14 (`MICommunity/micluster` tag `micluster-1.7.14`, `556205f`), miscore 1.3.14 (`MICommunity/miscore` tag `miscore-1.3.14`, `ae99268`), psimitab 1.8.6 (`MICommunity/psimi` tag `psimi-master-1.8.6`, `9baca51`), psicquic-registry-client 1.4.0 and psicquic-simple-client 1.4.0 (`PSICQUIC/…` tags `…-1.4.0`), and the versions of concurrent-trees and Objenesis the deployed jars carry (read the same way). interactor-core 1.1.5 (`7513f42`) and Kryo 5.3.0 are pinned already. These rows are reference only: no image builds them. Update "Frozen on purpose" with the classes the token conversion needs (research R5). `deploy/java-library/pins.spec.ts` keeps passing.
- [ ] T002 Record, at one moment and small and spaced, in `tools/content-node/fixtures/interactors-java/`: beta's Java answers for each PSICQUIC operation, for two resources (one that reads `intact-miscore`, one whose score is computed) and three accessions; **the MITAB each resource served for those accessions, and the ontology's first pages, at the same moment**, so the port can be checked against the inputs Java had; each error case of research R1 (an unknown resource, an empty body, an accession nothing has); an upload of each format with a placeholder file, and each of `Response.java`'s warnings and refusals; a custom PSICQUIC registration and a token read for each upload. Each answer is saved with its status and headers. Write `tools/content-node/fixtures/interactors-java/README.md`: when, how, and which fields vary between calls. The tokens these uploads create are content-addressed and harmless; nothing on beta is deleted.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the types both families write through, Java's formats, and the settings.

- [ ] T003 [P] In `projects/contract/interactors.ts`: widen `Interactors.resource` from `'static'` to the resource's name as the path gives it (T002 settles the form), and add `TupleResult`, `CustomPsicquicResource` and their `Summary` as the recordings show them. Regenerate `projects/contract/openapi.json` (`node tools/contract/generate.ts`). Add the nine operations' rows to `projects/contract/routes.ts`, so `tools/api-types/schema.spec.ts` checks T002's recordings against the types. Show the schema check failing on a recording with a field renamed.
- [ ] T004 [P] JDK 11's `Float.toString`, and miscore's round trip through it (`Float.toString` then `Double.parseDouble`), in `tools/content-node/java-float.ts` with `java-float.spec.ts`. Cases from Java itself: a table of floats and their strings, written by `jshell` on the **JDK 11** binary (not 21: they differ), committed as `tools/content-node/fixtures/java-float.txt`, as `java-double.txt` was. Include the single-precision steps (`Math.fround` at each operation) that research-psicquic.md §6 needs.
- [ ] T005 [P] `ConcurrentHashMap`'s iteration order, beside `HashMap`'s, in `tools/content-node/java-hashmap.ts` and its spec, with cases from Java for colliding keys. Research-psicquic.md §12 names where the answers depend on it.
- [ ] T006 [P] The new settings in `tools/content-node/settings.ts`, as [contracts/settings.md](contracts/settings.md) lists them (the container's names; each typed, with its default, read when it was before, per spec 013 T018). In `docker-compose.yml`, mount the host's `PSICQUIC_CACHE_DIR` and `CUSTOM_INTERACTORS_DIR` read-write, falling back to named volumes, and set `PSICQUIC_CACHE` and `CUSTOM_INTERACTORS` only when the host folder is set. Create `deploy/content-node/compose.spec.ts`, modelled on `deploy/java-library/compose.spec.ts`: it checks both mounts, their fallbacks, and that no read-write mount names a folder in the checkout. Show it failing with a mount missing and with a checkout folder mounted read-write.

**Checkpoint**: the contract, Java's formats and the settings are in place; both stories can start.

---

## Phase 3: User Story 1 - Third-party interactors without the wait (Priority: P1) 🎯 MVP

**Goal**: node answers the four PSICQUIC operations byte for byte as Java does, from a cache shared between visitors, with each fetch bounded.

**Independent test**: quickstart §1 and §2: paired answers equal over the sample; a second visitor's counts appear within a second; a server that never answers costs at most the timeout.

Each part is a pure module with its own spec, driven by T002's fixtures and research-psicquic.md, and written from the published method and the recorded behaviour, not from IntAct's code (research R2).

- [ ] T007 [P] [US1] MITAB 2.5 parsing as psimitab 1.8.6 reads it, in `tools/content-node/psicquic-mitab.ts` with its spec: the fifteen columns, escapes, `-` for empty, multiple values, and the errors research-psicquic.md §4 names (`"Couldn't parse PSICQUIC result"`, `"Empty String passed to create Field"`). Fixtures: T002's MITAB.
- [ ] T008 [US1] Clustering as micluster 1.7.14 does it, in `tools/content-node/psicquic-cluster.ts` with its spec: the mapping database lists (the client's own for details, `uniprotkb,chebi` for summaries), which identifiers are merged, and the cluster order (§5, §12). Expected clusters come from T002's answers for T002's MITAB.
- [ ] T009 [US1] The MI-score as miscore 1.3.14 computes it, in `tools/content-node/psicquic-score.ts` with its spec, every quirk of §6 deliberate and commented with what breaks without it: single precision, the null-key count, the parent chosen by hash-map order, and the round trip through `Float.toString` (T004). The ontology terms are T002's snapshot of OLS4's **first page** for each of the eight branches, in `tools/content-node/fixtures/psicquic-ontology.json`, with the script that retakes it, `tools/content-node/snapshot-psicquic-ontology.ts` (run by hand, its date recorded in the file, listed in `RUN_ON_LOAD`). The spec shows the full ontology's score differing (the 3-of-59 finding) and the first page's matching.
- [ ] T010 [US1] The per-resource clients, in `tools/content-node/psicquic-clients.ts` with its spec: each client's database list, score column (`intact-miscore` then `miscore`; `NBC` for Reactome FIs; `intact-miscore` only for ZINC; the computed score otherwise), alias, evidence count, `accURL` and `evidencesURL`, as §7 lists them, and the generic client custom services use.
- [ ] T011 [US1] From clusters to the answer, in `tools/content-node/psicquic-answer.ts` with its spec: the swap so the asked accession is A, the `>= 0.45` filter before rounding, rounding to 0.001, de-duplication by a sorted set that compares the score only, the stable sort and reverse, entity order and id numbering by Java's hash-map order (T005 for the POST's two threads), the summary's count before de-duplication (§10), and Jackson's non-empty writing (no `entities` key when nothing is found). T002's answers are reproduced byte for byte from T002's MITAB and snapshot.
- [ ] T012 [US1] Fetching from registry resources, in `tools/content-node/psicquic-fetch.ts` with its spec, against stub servers on loopback:
  - the resource found in node's registry reading (`psicquic.ts`), case-insensitively, and written back as the path gave it; inactive ones asked as Java asks them; the reading's age is the declared registry difference (research R3);
  - the URL `restUrl + "interactor/" + encoded accession`, as Java builds it;
  - `PSICQUIC_TIMEOUT_MS` per fetch; `PSICQUIC_PER_SERVER` at once per server, in arrival order; `PSICQUIC_QUEUE` waiting at most, past which a fetch fails at once;
  - a failed or timed-out fetch handled as Java handles one: left out of a POST **details** answer (still 200); the "PSICQUIC resource is not responding" 500 for a POST **summary** and for either GET;
  - each of §11's errors in the envelope.
- [ ] T013 [US1] The cache, in `tools/content-node/psicquic-cache.ts` with its spec (research R3):
  - the key: the operation, the resource's name exactly as the path gives it, and the accessions in the order Java's `HashSet` iterates them (split and trimmed as Java does; never sorted). A spec case shows two bodies Java orders differently never sharing an entry;
  - gzip files in `PSICQUIC_CACHE` named by the key's SHA-256; one day's life;
  - only a 200 with every accession answered is kept;
  - requests for a key in flight share one promise;
  - the cap with least-recently-used eviction; an answer over a tenth of the cap served but not kept;
  - the index rebuilt from the folder at start; no folder set means no cache.

  The spec's stub server counts what it is asked, so "served from the cache" is measured, not assumed (constitution I).

- [ ] T014 [US1] The four operations, in `tools/content-node/interactors-psicquic-endpoints.ts`, added to `tools/content-node/registry.ts` and to `fixtures/route-order.json`, writing through `nonEmptyJson<Interactors>` (T003). Each new shared module joins `SHARED` in `boundaries.spec.ts`. Each operation's spec runs against stub servers. **Not routed yet**: `deploy/nginx/routes.spec.ts`'s `NOT_YET_ROUTED` names all four with this task's number.
- [ ] T015 [US1] Parity on beta (research R4, quickstart §1). Start node on a spare port beside beta's, then compare:
  - the 20-pathway sample crossed with every live resource;
  - the POSTs (details and summary) and the GETs (three accessions per pathway);
  - the error cases.

  Send each pair at the same moment, with a second Java-only pair; a difference counts only if Java's own pair does not show it. Retake the ontology snapshot the same day. Record the run in research.md (a new R8): counts compared, equal, explained by Java's own variation, and any left. **Any part left unmatched** gets a fallback task added here (node calls that part alone in `deploy/java-library`, at T001's versions), and this task stays open until it is matched.

- [ ] T016 [US1] Route the four: their locations in `deploy/nginx/common/routes-core.conf` (every deployment) and `proxy.conf.js`, removed from `NOT_YET_ROUTED`; `deploy/nginx/test-config.sh` passes for every deployment. In the same PR:
  - rows in `documentation/declared-differences.md` for the per-fetch timeout, the ontology snapshot and the registry reading;
  - spec 006's T101 rewritten as "moved to node by spec 033";
  - spec 010's operation homes (`specs/010-java-services/contracts/operation-homes.md`) updated.

  The host's `PSICQUIC_CACHE_DIR` is set on beta before the route moves. Deploy to beta, then check there that the interactors panel's counts arrive, and arrive at once on a second visit.

**Checkpoint**: the PSICQUIC overlays and counts are node's on every deployment, cached, and Java's to three decimal places.

---

## Phase 4: User Story 2 - Every overlay link keeps opening (Priority: P2)

**Goal**: node answers the five custom-interactor operations; every existing token opens as before on every server; new uploads behave as Java's.

**Independent test**: quickstart §3 and §4: every converted token's answer equals Java's on each server; the upload corpus gives the same answers on both.

**Depends on**: Phase 2, and from US1: T007–T011 (PSI-MITAB uploads are clustered and scored as the queries are) and T013 (custom PSICQUIC tokens use the cache).

- [ ] T017 [US2] The conversion program in `deploy/java-library/` (a second entry point in the image, `convert-tokens`). It compiles only interactor-core 1.1.5's model classes from `7513f42` (`TupleResult`, `Summary`, `CustomResource`, `TreeInteraction`, `CustomInteraction`, `CustomPsicquicResource`), with concurrent-trees, Objenesis and Kryo 5.3.0 from Maven Central at T001's versions, so it needs no IntAct library. It reads with `TupleManager`'s exact Kryo set-up. For every `<token>.bin` in a folder it writes `<token>.json` as [contracts/token-store.md](contracts/token-store.md) describes, **`byIdentifier` from Java's own iteration of the stored set**. It prints the report the contract names: counts, and each failure's token and exception class, with no content. Its tests use `.bin` files the test writes with the same classes (one of each kind, a pair duplicated A/B-reversed, ties in score) plus one that cannot be read. Correct contracts/token-store.md in the same PR if a real object holds more than it lists.
- [ ] T018 [US2] [server] Run T017's program on a copy of each server's token store: beta first, with the owner, then the release server and production. Record in research.md the counts only for each: read, converted, failed. A failure stops this story on that server until it is understood.
- [ ] T019 [US2] The three upload parsers and their messages, in `tools/content-node/custom-interactors-parse.ts` with its spec (research R6): the format detection; the two-column tuple (confidence 1.0); the extended format (its confidence column, and the warning for pairs below 0.45, which are left out); PSI-MITAB (parsed by T007, clustered and scored by T008–T011). Every message in `Response.java` word for word, `MessageFormat`'s number grouping included ("Line 1,234 …"). A corpus of placeholder files in `tools/content-node/fixtures/custom-interactors/`, one per accepted form and one per warning and refusal, each with Java's answer from T002 or recorded the same way. For a new upload, `byIdentifier` is built by the same structures in the same insertion order Java uses, and the spec shows it equal to T017's for the same file.
- [ ] T020 [P] [US2] The token store, in `tools/content-node/custom-interactors-store.ts` with its spec (research R5):
  - both token forms: the MD5 of the name followed by the content, as bytes in the deployed service's default charset (T023 settles which), and `PSI-` and the product of the name's and the address's Java string hashes, after the `/` Java adds;
  - a re-upload returning the stored set;
  - a token checked against `^[0-9a-f]{32}$` or `^PSI--?[0-9]+$` before it names a file (a spec case tries `..` and a slash);
  - writing to a temporary file, then renaming;
  - a custom PSICQUIC token already naming a different service refused with the envelope's 409;
  - the bound as Java's checker applies it: past 2 GB, files not read for a week removed, least recently read first;
  - `CUSTOM_INTERACTORS` unset answering the 503 in the envelope.
- [ ] T021 [P] [US2] Fetching an address a user gave, in `tools/content-node/user-address-fetch.ts` with its spec, used by uploads by address and by every read of a custom PSICQUIC token (research R6):
  - only `http` and `https`, with certificates checked;
  - the name resolved, and a loopback, private or link-local address refused, then the connection made to that checked address; the same at every redirect;
  - a timeout; the size limit enforced while reading;
  - fetched once.

  A spec case for each, each seen failing, including a name that resolves to a private address and a redirect to one.

- [ ] T022 [US2] Reading by token, in `tools/content-node/interactors-custom-endpoints.ts` with its spec:
  - the body split on `,` `;` newline or tab and trimmed, into Java's `HashSet` order;
  - stored pairs answered from `byIdentifier` through Java's `HashSet<CustomInteraction>` (hash `hA × hB`, equal whichever way round) and the stable sort and reverse;
  - a custom PSICQUIC token asked live at Java's address (the service's address and the encoded accession, no `interactor/`, one accession after another, the generic client of T010), through T021 and the cache (T013, keyed by its address); its failure the 500 "Error querying your PSICQUIC Resource: …";
  - an unknown token the envelope's 404.
- [ ] T023 [US2] The four uploads, in `tools/content-node/interactors-custom-endpoints.ts`:
  - content, form (the types Java's sniffing accepts; 415 otherwise), and by address (Java's file-name encoding of the address; through T021; too large 431, unreadable or refused 422);
  - registering a custom PSICQUIC service, which only parses the address, as Java does;
  - `UPLOAD_MAX_BYTES` on every form (the upload routes' own `bodyLimit`), and `UPLOAD_RATE_PER_MINUTE` per client keyed on nginx's `X-Real-IP`, never `X-Forwarded-For`.

  A spec case for each, each seen failing. All five operations join `registry.ts` and `route-order.json`, **not routed yet** (`NOT_YET_ROUTED`).

- [ ] T024 [US2] Parity on beta (quickstart §3 and §4):
  - every token converted from beta's store, asked of both services over its own identifiers plus three it does not hold;
  - the upload corpus sent to both, as content, form and address (the address served from a scratch folder through a temporary local server), including one non-ASCII name and content, which settles the MD5's charset.

  Record the counts in research.md. Every token must match (SC-004); a difference stops the routing until it is explained.

- [ ] T025 [US2] [server] The same token parity on each other server that holds a store (the release server, production), on its converted copy, before that server's route moves. Record each server's counts in research.md. Every token must match (SC-004).
- [ ] T026 [US2] Route the five: `routes-core.conf` and `proxy.conf.js`, out of `NOT_YET_ROUTED`; `test-config.sh` for every deployment. In the same PR:
  - rows in `documentation/declared-differences.md` for research R5's and R6's declared differences: certificates, timeouts, the size while reading, one fetch, private addresses, the 409, and the rate limit;
  - spec 006's T102 rewritten as "moved to node by spec 033";
  - spec 010's operation homes updated.

  Each deployment's host `CUSTOM_INTERACTORS_DIR` points at its converted, checked store before the route moves there: beta now; the other servers after T025, [server]. Deploy to beta, then open an old overlay link and a new upload.

**Checkpoint**: no interactor operation reaches the Java service on beta.

---

## Phase 5: User Story 3 - The old ContentService is switched off (Priority: P3)

**Goal**: nothing reaches the old Java ContentService on any deployment; after one release it is removed and its repository archived.

**Independent test**: quickstart §5: with it stopped on beta, every published operation answers and the end-to-end suite passes.

**Depends on**: T016 and T026 on every deployment; spec 015 T068 (event SBML, SBGN and BioPAX on the release server and production) and spec 006 T100 (the event PDF there), which wait for those servers to run the library service and pdf-export (spec 032).

- [ ] T027 [US3] Send the `/ContentService/` catch-all in `deploy/nginx/common/routes-core.conf` to node, and its equivalent in `proxy.conf.js`; `NOT_YET_ROUTED` is empty and removed. Add a test in `deploy/nginx/routes.spec.ts` that no location in any deployment's configuration sends a `/ContentService` path to Tomcat, shown failing while one still does. Keep a commented line ready to send the catch-all back, with the condition for using it.
- [ ] T028 [US3] [owner] On beta, with the owner (stopping a webapp needs them): stop the old ContentService, call every published operation with its documented example through the site, and run the end-to-end suite (SC-006). Start it again afterwards. Record the result here.
- [ ] T029 [US3] [owner] After one release with nothing routed to it on any deployment, remove the ContentService webapp from each server's application server (by whoever runs that server), and record the date here.
- [ ] T030 [US3] [owner] Archive `reactome/content-service`, with a README naming each operation's home: node (most), the library service (any fallback part from T015, and the token conversion), or retired. Record it in `specs/010-java-services/contracts/operation-homes.md`.

---

## Phase 6: Polish & cross-cutting concerns

- [ ] T031 [P] Measure the interactors panel before T016 and after it, on beta, with a scripted browser: the time until every resource's count shows, for three pathways, on a first and a second visit (SC-001). Record it in research.md.
- [ ] T032 [P] `RELEASE-TESTING.md` and `CURATOR-REPORT.md`: the counts' speed (reader-visible), and any declared difference a reader could notice (an upload by address refused for a private address; a custom PSICQUIC name refused because its token is taken). Only what a reader sees.
- [ ] T033 Check every success criterion (SC-001 to SC-007) and record the result here.

---

## Dependencies and order

- **Phase 1** (T001, T002) before everything. T002 needs only beta and the public services.
- **Phase 2** (T003–T006) before the stories. T003–T006 are independent of each other.
- **US1:** T007 → T008 → T009 → T010 → T011 (each consumes the last; T009 also needs T004, T011 needs T005) → T012 → T013 → T014 → T015 → T016.
- **US2:** T017 → T018. T019 needs T007–T011. T020 and T021 are independent of each other. T022 needs T020, T021, T010 and T013. T023 needs T019, T020 and T021. T024 needs T018 (beta), T022 and T023. T025 needs T018 on that server and T024. T026 needs T024, and T025 for each other server.
- **US3:** needs T016 and T026 everywhere, spec 015 T068 and spec 006 T100; then T027 → T028 → (one release) → T029 → T030.
- **Polish:** T031's "before" is taken before T016 merges; T032 with T016 and T026; T033 last.

## Parallel opportunities

- T003, T004, T005 and T006 together.
- T007 can start beside T004 and T005.
- In US2, the conversion program (T017), the store (T020) and the address fetch (T021) can start beside US1's later tasks; the parsers (T019) wait for T011.
- In this project, "parallel" means independent pull requests in a queue: one agent at a time, each reviewed and merged in turn.

## Implementation strategy

- **MVP: User Story 1.** It is the reported slowness, and it carries no stored data. After T016, every visitor sees the counts at once for pathways asked about that day.
- **Then User Story 2.** It needs each server's store converted and checked (T018, T025), and the store mounted on each deployment.
- **Then User Story 3,** when the event exports have moved on the release server and production.
- **Release work comes first:** these tasks are taken in step with the December release's own work, not ahead of it.
