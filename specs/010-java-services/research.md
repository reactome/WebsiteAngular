# Research: the Java side of Reactome's services

> **Amended by [spec 015](../015-graph-exports/spec.md) (24 Oct 2026).** Where this document says otherwise, spec 015 holds:
>
> - **SBML:** the library service's SBML operation uses `sbml-exporter`'s fixed graph-only converter, with its layout drawn from the diagram files. It needs no relational database, and its body is proven by spec 015's comparison rather than byte-identical to the old server's relational answer. Status, headers and errors are still Java's.
> - **BioPAX:** the service gains a BioPAX Level 3 operation through `BioPAX3Exporter`.
> - **Runtime:** the service runs on JDK 17, because BioPAX3Exporter is built for it. Libraries built for Java 11 run there unchanged.
> - **SBML is cut over by spec 015** (its T044), not here.

Phase 0 for [spec.md](spec.md). Each decision gives what was measured, what was chosen, and what was rejected. Measurements were taken on 17 Oct 2026 on the host that serves the site's beta. Host paths and names are deliberately left out of this public repository.

---

## R1. Which commits reproduce what is deployed

**Measured.** The jar manifests, and the pom.xml embedded in each jar, were matched against every commit of the source repositories. Candidate commits were rebuilt (Maven 3.8.7, tests skipped) and compared with the deployed classes byte for byte. Where bytes differed, `javap -c -p` output was compared with constant-pool indices removed. Every deployed artifact compiles to Java 11 bytecode.

| Artifact                                        | Repository and commit                                                               | Match                                                                                                               | JDK to build     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------- |
| content-service 2.1.11 (ContentService webapp)  | `reactome/content-service` `7b9eceb`, branch `add-content-page-endpoints`           | all 102 classes byte-identical; all 324 bundled jars identical by md5                                               | 11               |
| analysis-service 3.1.8 (AnalysisService webapp) | `reactome/analysis-service` `9b147e1`, branch `feature/batik-upgrade` (open PR #25) | all 28 classes byte-identical                                                                                       | 11               |
| analysis-core 3.6.0-SNAPSHOT                    | `reactome/analysis-core` `74e3ffe`                                                  | equal to the published snapshot; a rebuild differs only in string-concatenation bytecode from a newer JDK 11 update | 11               |
| analysis-report 1.4.0-SNAPSHOT                  | `reactome/analysis-report` `67062e7`                                                | classes byte-identical                                                                                              | 11               |
| interactor-core 1.1.5                           | `reactome/interactors-core` `7513f42` ("Release 1.1.5")                             | 74 of 77 classes identical; 3 differ only in string concatenation                                                   | 11               |
| event-pdf 1.2.1-SNAPSHOT                        | `reactome/event-pdf` `2c070d5`                                                      | all 91 entries byte-identical                                                                                       | 17, targeting 11 |
| diagram-exporter 2.0.12                         | `reactome/diagram-exporter` `702ba70`                                               | 203 of 205 identical; 2 differ only in string concatenation                                                         | 11               |
| fireworks-exporter 1.2.8                        | `reactome/fireworks-exporter` `e660857`                                             | all 99 entries byte-identical                                                                                       | 11               |

**What this means for building:**

- **Both deployed webapps run from unmerged branches.** content-service is 17 commits ahead of its `main`, with no PR. None of those commits touch the Java-homed routes. analysis-service runs from an open PR. The pins are these commits; asking the owners to merge them is a separate request.
- **A plain rebuild depends on what the snapshot repository serves that day.** The parent POM, the BOM it imports, and several libraries are `-SNAPSHOT` versions. The parent was already republished once, on 9 Mar 2026, with newer Batik and FOP. So each build is pinned by building the Reactome libraries from the commits above in a multi-stage image, never by resolving a moving snapshot.
- **Settings are baked into the WAR at build time** through `@…@` placeholders filled from a local Maven profile. From-source images supply them at run time instead (system properties or environment), which take precedence. Credentials never enter an image.
- **No private repository or credential is needed to build.** Every dependency came from Maven Central or EBI's public repository groups.

**Rejected:** using today's snapshot artifacts as they are. That was reproducible today by luck, and has already changed once.

## R2. The shape of the Java library service

**Measured.** content-service at `7b9eceb` scans every Reactome package and starts all of the following:

- Neo4j repositories, and Neo4j queries run at startup
- the Solr component
- a relational-database adaptor
- mail
- a header and footer fetcher
- a PSICQUIC registry poller
- the full analysis data file, which the events-hierarchy controller waits for at construction

It needs over twenty settings across those components. Its WAR has no main class and needs a servlet container.

What the Java-homed operations ([operation-homes](contracts/operation-homes.md)) actually need:

- **PSICQUIC:** interactor-core and outbound HTTP.
- **Uploads and overlay tokens:** interactor-core and the upload store.
- **SBML:** the graph and the relational release database (sbml-exporter's converter).
- **SBGN:** the graph and the diagram files.
- **Event PDF:** the graph, the diagram, EHLD and fireworks files, and the analysis-token store.
- **Events hierarchy:** the graph and the full analysis data.
- **None of them** needs Solr, mail, the header fetcher or the content-page queries.

**Decision: a new small Spring Boot application in its own Reactome repository**, depending on interactor-core, event-pdf, sbml-exporter, diagram-exporter, analysis-core, graph-core and reactome-base at the pinned versions. It exposes exactly the Java-homed operations, as an executable jar.

- **It copies the glue between the libraries and the web from content-service:** the controllers, the managers, the `Interactors` JSON models, `TupleManager` with its Kryo set-up, the store's LRU checker, export caching and the exception-to-status mapping. That is about 3,000 lines. The interactor glue last changed in 2021–22, and the events-hierarchy controller four times since 2023. Parity tests (R7) prove the copy byte for byte.
- **`TupleManager`, interactor-core 1.1.5 and Kryo 5.3.0 are kept exactly.** The overlay tokens are Kryo files that name their classes, so a change to any of the three would stop old tokens reading.
- **Licence:** event-pdf and analysis-report are AGPL-3.0, and fireworks-exporter GPL-3.0. The new repository is licensed AGPL-3.0. It is separate from this Apache-2.0 repository and only reached over HTTP.

**Rejected:**

- **Running content-service unchanged.** It reuses everything, but it starts Solr, mail and the relational adaptor, and holds a second copy of the analysis data. It also answers about 165 routes, so a misroute would answer quietly from Java.
- **A trimmed content-service build.** It is a standing patch on a repository this project does not own, re-merged on every bump. It is the worst of the three to maintain.

**Dependency:** a new repository in the Reactome organisation needs its owners to create it.

## R3. Memory: one JVM or two

**Measured.**

- **Today's JVM:** Tomcat runs one JVM with a 6 GiB heap (`-Xms6G -Xmx6G`) and a resident size of 7.85 GiB. Its service limit is 11 GiB. It hosts eleven webapps, not two (R10).
- **What the analysis data costs:** the analysis data is a 153 MiB Kryo file. Loading it with the deployed analysis-core under Java 11 measured:
  - **1,623 MiB** of heap for the data itself;
  - **142 MiB** for analysis-core's pool of five hierarchy copies;
  - about **1,766 MiB** retained in all, with a 2,235 MiB peak during the 9.6 s load.
- **It is held twice.** Both ContentService and AnalysisService load the file into their own classloaders: about 3.45 GiB, 58% of Tomcat's heap. ContentService holds it for one operation, the events hierarchy.
- **The host has 31 GiB.** 13.4 GiB was available, swap was full, and the graph database container held 4.3 GiB.

**Decision: two containers, and the library service does not hold the analysis data in its first release.**

| Service                                  | Heap  | Container limit | Holds                                                                                  |
| ---------------------------------------- | ----- | --------------- | -------------------------------------------------------------------------------------- |
| AnalysisService                          | 3 GiB | about 4 GiB     | the analysis data (1.8 GiB) and working room for concurrent analyses                   |
| Java library service, first release      | 1 GiB | about 1.5 GiB   | PSICQUIC, uploads and tokens, SBML, SBGN, event PDF                                    |
| Java library service, once Tomcat is off | 3 GiB | about 3.5 GiB   | the above plus the events hierarchy, if it is still served from the full analysis data |

- **Why:** while Tomcat still runs, both new services plus Tomcat need about 16 GiB if the library service loads the analysis data, but only about 13.9 GiB if it doesn't. Only the second comes close to fitting. So the events hierarchy stays on Tomcat until Tomcat's own copy is freed.
- **A smaller alternative,** tracked as an open question: the release could produce the hierarchy's pathway sizes as a small file, so the library service never loads the full data.
- **FR-017 is still binding.** These are measurements of loading the data, not of running under load. The budgets are set from a load test before go-live.

**Rejected:** one JVM for both services. Two webapps in one JVM still load the data twice (one copy per classloader). Merging them into one application would couple AnalysisService's releases to the library service's.

## R4. Where state lives

| State                                           | Size (measured)                                   | Lifetime as the code implements it                                                                                                                                                                                         | Volume                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Overlay-token store (custom interactor uploads) | 328 files, 11 MB; oldest 2019-05-01               | An LRU checker deletes files not accessed for a week, and only once the folder passes about 2 GB. At 11 MB nothing is deleted, which is why it looks permanent.                                                            | read-write, library service only                                                                       |
| Analysis result tokens                          | 228 files, 292 MB; median 604 KB, largest 10.9 MB | The same LRU checker (deletes only past about 2 GB). Tokens date themselves: a missing file within 7 days of its token's date answers 410, after that 404. The in-memory cache of repeated submissions is lost on restart. | read-write for AnalysisService; read-only for the library service, whose PDF and hierarchy read tokens |
| Analysis data, per release                      | 153 MiB per release                               | Loaded once at start-up, with no file watching. A release installs a new file and restarts the service.                                                                                                                    | read-only, mounted per release file                                                                    |
| Export cache (SBML, SBGN)                       | about 200 MB, keyed by database version           | never cleaned; safe to discard                                                                                                                                                                                             | read-write, library service, disposable                                                                |
| AnalysisService export temp                     | empty                                             | a scheduler deletes files older than 15 minutes                                                                                                                                                                            | tmpfs                                                                                                  |
| Diagram, EHLD and fireworks files, SVG summary  | diagram files 1.1 GB                              | read-only release downloads                                                                                                                                                                                                | read-only, shared                                                                                      |

**Findings:**

- **Retention.** The spec's "never expires" was imprecise: the stores are LRU-bounded, and the bound has never been reached. FR-010 is reworded to "retention as today".
- **Missing inputs.** On the measured host the fireworks folder does not exist, the EHLD folder is empty and the SVG summary file is missing. The event PDF and report features that need them cannot work there as configured, today. Parity therefore measures what Tomcat does now, and the gap is recorded.
- **A relational database.** SBML export needs the relational release database, a network dependency of the library service.

## R5. How requests reach the Java services

**Measured.**

- **content-node's only delegation today** (to the render service) uses `fetch` and buffers the whole body.
- **content-node's middleware** caps bodies at 10 MB, rewrites paths, sets its own CORS, and ends unmatched paths with Spring's 404.
- **Its shutdown** closes without draining requests in flight.
- **nginx** allows bodies up to 64 MB and gives upstreams 300 s.
- **Java** caps uploads at 50 MiB and sets its own CORS and Content-Disposition.

**Decision: ContentService's Java-homed operations pass through node, and AnalysisService is routed by nginx straight to its container.**

**Through node (ContentService):**

- **The routing table.** A declarative table of Java-homed patterns is mounted first in the app, before CORS, path rewriting and the 404. A test asserts it never overlaps node's own endpoints.
- **The proxy.** It uses `node:http` and `stream.pipeline`, with no new dependency. `fetch` was ruled out because it decompresses and buffers.
- **Requests and responses.** Requests are streamed, keeping the Host header, appending X-Forwarded-For, and dropping hop-by-hop headers. Responses are copied verbatim.
- **Timeouts.** The headers timeout is just under nginx's, so a reader gets node's 504 envelope rather than nginx's page.
- **Abandonment and retries.** The upstream request is aborted when the client leaves. One keep-alive agent per service; a stale socket is retried once, for GET only, to the same service.
- **Failures.** Connection failure gives 503 in Java's envelope. A failure after headers is a visibly truncated response. Never a second backend.
- **Shutdown.** It is changed to drain requests in flight within a bound.

**AnalysisService by nginx (amends FR-005):**

- **No benefit through node.** Node answers none of its 39 operations, so passing them through adds a hop and makes every content-node restart cut long analyses short.
- **nginx already provides what is needed:** loopback-only upstreams, streaming, body limits, rate limits and logs.
- **The no-fallback rule is unaffected.** It is about routes node answers, and none of these is one.
- **The amendment:** node owns every public ContentService address; AnalysisService addresses are owned by nginx and answered only by AnalysisService.

**Rejected:**

- **nginx routing ContentService's Java-homed paths straight to the library service.** It would split the Java-homed list between nginx and the dev proxy, and node would never become the owner of ContentService's addresses.
- **A generic proxy package.** It would be a new, undeclared dependency.

## R6. Cutover and rollback, one address at a time

**Measured.**

- **How an address moves today.** It moves to node when an nginx `location` sends it there; everything else falls through to Tomcat's prefix. Rollback is deleting the block.
- **The tests.** `deploy/nginx/routes.spec.ts` checks agreement with the dev proxy over the proxy test's URLs, but reads only `routes-core.conf`, not `routes.conf`.
- **A trap.** The rate-limited exporter location lives in `routes.conf`. A node location added in `routes-core.conf` for an exporter path would win and silently drop that rate limit.

**Decision: the same one-location switch, and node holds no Tomcat address at all.** A node route can then never be answered by Java, by construction. Per address:

1. **Stage it in node:** add the pattern to node's pass-through table, pointing at the new service, and deploy. It is inert until routed.
2. **Cut over:** add one nginx location sending the address to node, and the same pattern to the dev proxy. The existing routing tests apply.
3. **Roll back:** delete the location.
4. **Switch Tomcat off:** finally, both prefixes stop pointing at Tomcat. Rolling back an address is then one location to Tomcat, while it is kept (FR-014).

**Test changes:**

- `routes.spec.ts` reads `routes.conf` too, and checks three outcomes, not two (node, Java service, Tomcat).
- Exporter addresses are cut over inside the existing rate-limited location.

**Rejected:**

- **An nginx `map` choosing the upstream.** It cannot vary rate limits or timeouts per route, and `nginx -t` does not check its targets.
- **A switch held in node.** It would give node Tomcat's address.

## R7. Parity, per class of operation

A Java-against-Java harness sends the same request to the reference and the candidate, with the same Host. It compares status, a fixed set of headers, and the SHA-256 of the body. Normalisers are allowed only per class and must be declared.

A second check compares through node against direct to the candidate, so the pass-through is proved transparent independently of Java parity.

The reference is the deployed artifact (R1) run in a throwaway container. Parity never writes to the live stores and never contacts external analysis services.

| Class                             | Method                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PSICQUIC queries**              | Third-party data, and the registry address is fixed in the library, so recordings cannot be replayed into Tomcat. Instead, paired simultaneous requests, plus a reference-against-reference pair: a difference counts only when the reference agreed with itself. Error cases are included; several of these services often fail.                                                                                                                                                                                                                                                                    |
| **Uploads**                       | Never sent to Tomcat. Reference and candidate each write to their own throwaway store. Tokens are deterministic (a hash of name and content), so the bytes are compared, then each side reads the other's files.                                                                                                                                                                                                                                                                                                                                                                                     |
| **Existing overlay tokens**       | Every one is read through both, from a read-only copy. Only counts are reported (identical, different, both missing), never token values, which work like passwords.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **SBML, SBGN**                    | Byte compare. Dates come from the data but are formatted in the JVM's default timezone, so the candidate's timezone and locale must equal Tomcat's.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **PDFs** (event, analysis report) | Not byte-comparable as produced: the cover prints the current date, and the PDF library writes creation and modification dates and a time-based ID. Both sides are normalised with `qpdf` in a container (static ID, no object streams), those fields and the cover date are masked, and then the bytes are compared.                                                                                                                                                                                                                                                                                |
| **Events hierarchy**              | Byte compare per main species, after confirming both sides loaded the same release's data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **AnalysisService**               | Replay against this deployment only. Submissions come from the 11 example files the Pathway Browser offers. The request shapes come from the end-to-end recordings: projection or not, interactors, disease, sort, page size, resource, species comparison, token follow-ups and downloads. Result bodies are compared with the token removed; tokens embed the time and a per-process counter. First submission is compared with first, since a repeat returns the cached token. Reference and candidate never share a writable token folder, because simultaneous submissions mint the same token. |

## R8. Aspose.Slides

**Measured.**

- **Source:** neither service's source or POM names Aspose. The 32 MB jar arrives as a dependency of diagram-exporter.
- **Bytecode:** across every jar in both deployed webapps, only diagram-exporter's PPTX package references it.
- **AnalysisService** never calls that path.
- **ContentService** uses it only for PPTX export.
- **No licence is loaded:** the code looks for a licence resource that exists nowhere in the deployed webapps. Aspose runs in evaluation mode.

**Decision: leave Aspose out of both builds.** No Java-homed operation needs it, and PPTX is drawn by this repository's render service (exporter plan #273). Parity confirms that leaving it out breaks nothing on the SBGN and raster paths. Its classes are loaded only when the PPTX path runs.

**Spec correction:** FR-018 assumed AnalysisService used Aspose for report figures. It does not.

## R9. The analysis result contract

**Decision:** the site's analysis result types are generated from, or checked against, real results recorded by the AnalysisService parity corpus (R7). A test fails when a field the site reads is missing or changes type. This is the last phase, after AnalysisService runs from the new deployment.

## R10. The other webapps in Tomcat

**Measured.** Tomcat hosts eleven webapps. Besides ContentService and AnalysisService:

- ExperimentDigester
- the search no-result report service
- the old diagram and fireworks JavaScript widgets
- the old Pathway Browser
- PopularPathways
- overlays
- the old RESTful API
- the root application

**Decision:**

- **Each gets a home or a retirement before Tomcat is switched off** (Story 4). That inventory is a task in this plan, with a decision per webapp. Some are certainly in use: the widget is embedded by partners, and the report service receives the search no-result reports.
- **Spec change:** this adds a requirement (FR-020) and an assumption to the spec. Without it, Story 4 could not be met.

## R11. The species overview is the Reacfoam (Voronoi) map, not Fireworks

The site's species overview is the Reacfoam map, a Voronoi treemap drawn with FoamTree. The GWT and JavaScript Fireworks widgets are retired. "Fireworks" survives only in names fixed outside this repository: the public URLs `/search/fireworks` and `/exporter/fireworks/…`, Solr's handler and field, and the JSON keys in Java's answers. Those are kept, so answers stay byte-identical and old links work. Everything else should say what it is now.

- **The `/exporter/fireworks/{species}.{ext}` image is node's** (spec 006 T093). It is drawn as the Reacfoam map.
- **The AnalysisService PDF report still embeds a Fireworks figure,** made by Java's fireworks-exporter. AnalysisService runs unchanged under this spec, so the report keeps that figure until analysis-report is changed upstream, or the figure is supplied to it (task T058).

## Side findings, recorded for follow-up

- **Shutdown:** content-node's shutdown does not drain requests in flight (fixed under R5).
- **Local uploads:** the local nginx configuration sets no body-size limit, so local uploads over 1 MB are refused.
- **Undeclared dependency:** the production site server relies on a proxy package it does not declare.
- **The routing test** does not read `routes.conf` (fixed under R6).
- **The measured host** was short of memory: swap was full, and a CI server believed stopped was running.

## R12. Analyses at once: measured, and the queue in front (19 Oct 2026)

**Decision** (awright, 19 Oct 2026): the AnalysisService stays Java. A small gateway in this repository, its own container, admits a few computations at a time in front of it.

- **Not in Java:** that would be a fork of the upstream service, and Java releases are hard to make. The shared parent POM pins Spring Boot 2.7 and Java 11 for every Reactome project.
- **Not inside the node content service:** restarting that would cut off long analyses.

**Measured** against this host's AnalysisService, with the site's own example data. Nothing was sent to outside analysis services.

| Request                                 | Alone  |
| --------------------------------------- | ------ |
| demo (77 lines)                         | 0.25 s |
| microarray (1,204 lines)                | 0.37 s |
| tissue expression (5,110 lines, 2.6 MB) | 2.0 s  |
| tissue, with interactors                | 4.4 s  |
| species comparison, human to mouse      | 2.3 s  |

Twelve distinct tissue analyses at once (`identifiers/projection`):

- **Every one answered 200, in 10.5–12.6 s each.** Nothing waits and nothing is refused: every analysis shares the CPUs and all finish late.
- **Memory hardly moved:** the service's resident memory went from 8,069 to 8,148 MB, its heap being reserved up front. The pressure is the CPU, and the on-demand copies of the working data beyond the pool of 5 (`HierarchiesDataContainer.take()`, analysis-core).

So a large enough burst would take every analysis in it past the edge's 100-second limit, and all of them would fail together.

**Settings it suggests**, all configurable:

- **4 at a time.** That is below the pool of 5, so no copies are built on demand, and it leaves CPUs for the rest of the site on an 8-CPU host.
- **A waiting list of 40.**
- **A longest wait of 60 s**, so waiting plus running stays inside 100 s.
- **The PDF report on a lane of its own, 1 at a time**, as it draws figures and lays out a document.

**Alternatives considered:**

- **nginx's own connection limits:** these refuse, they do not queue.
- **A submit-then-poll API:** for analyses longer than the edge allows, but it changes the contract for outside clients, so it is kept apart.

**Through the gateway** (T062, 19 Oct 2026). The same burst of twelve distinct tissue analyses, run on the host against this host's AnalysisService, with 4 at a time:

| Analyses                | Answered in |
| ----------------------- | ----------- |
| 1–4                     | 2.4–3.0 s   |
| 5–8                     | 5.2–6.3 s   |
| 9–12                    | 8.4–9.4 s   |
| a read during the burst | 4 ms        |

Directly against Tomcat, every one of the twelve took 10.5–12.6 s. Through the gateway the first answers come four times sooner and the last sooner still, and a read is not held back. Byte for byte, a stored result, its not-found list, a CSV download, the version and an unknown token's 404 are each the same through the gateway as directly, headers included (apart from `Date` and connection headers).

**Review of #539, and what changed with it:**

- **Port:** the gateway listens on 127.0.0.1:4350. It was first given 4320, the MCP server's port. A routing test now fails when two upstreams share an address, except Tomcat's own.
- **A slot is held until the service has finished,** even when the reader has left. A Java handler does not stop when its connection drops, so the limit counts computations, not connections.
- **Bodies are read while waiting,** up to 256 MB held in all, so a reader who leaves after a large upload is seen leaving and their analysis is never run.
- **Requests are classified on the path as Tomcat routes it:** decoded, `;` parameters cut, slashes merged. HEAD counts as GET. Spelled `identifiers;x/projection` or `%69dentifier/…`, a computation had run past the queue.
- **ReactomeGSA's own requests** (the `dev.reactome.org` server block) go straight to Tomcat through `analysis_direct`. Decided with awright, 19 Oct 2026: GSA runs its own queue on its Google Cloud cluster, so its calls back into this AnalysisService already arrive paced. Putting them behind this queue as well would gain little, and its workers are not known to honour a 503's `Retry-After`.

**Second review of #539:**

- **A reader who leaves mid-upload** gives the place back at once. Tomcat would otherwise wait for the rest of a body that never comes until its own read timeout, holding the place with nothing computing.
- **A call the service goes silent on** is given up after 300 s (`UPSTREAM_TIMEOUT_MS`), nginx's own read timeout, after which the reader has gone. Without it four hung calls closed the lane until Tomcat restarted.
- **Tests now cover** a body still arriving at admission, the waiting budget, slot release after an unreachable or failing service, and connection headers stripped from the answer. Each was shown failing on the mutation it guards.
