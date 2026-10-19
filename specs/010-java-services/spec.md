# Feature Specification: The Java side of Reactome's services

**Feature Branch**: `spec/010-java-services`

**Created**: 2026-10-17

**Status**: Draft

**Input**: User description: "The Java side of Reactome's services: what stays in Java, how it runs, and how Tomcat is retired." The brief is summarised in Background below.

## Background

ContentService is being moved, endpoint by endpoint, from the Java application server to the node content service in this repository. Most of ContentService is reading the graph database or the search index, and that work moves to node.

Some of it is not. A few endpoints exist to call a Java library that Reactome or a partner maintains — the IntAct interaction-clustering and scoring libraries, the SBML and SBGN writers, the event PDF builder — and AnalysisService as a whole is Java: its enrichment statistics, the pathway data it holds in memory, the result tokens curators cite, and its PDF report. Re-implementing those would mean re-checking published numbers to the last digit and taking on every future upstream fix by hand. Some of the libraries are also under a licence (GPL-3.0) that this repository (Apache-2.0) cannot absorb by translation.

So the decision (Reactome, 17 Oct 2026) is to **keep that Java, but stop running it the old way**: build it from Reactome's own source repositories, run it as services this repository deploys, put node in front of every public address, and switch the shared application server off.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A recorded split anyone can apply (Priority: P1)

A developer or curator can look up, for any ContentService or AnalysisService address, where it is answered — node, the Java library service, or AnalysisService — and why; and can decide a new case with the same rule, without asking.

**Why this priority**: every later step depends on agreeing which side each endpoint belongs to. It is useful on its own: it stops endpoints that should stay in Java from being ported, and the reverse.

**Independent Test**: take five endpoints at random from each service's published API description; the record names a home for every one, with the reason, and two people applying the rule to a new hypothetical endpoint reach the same answer.

**Acceptance Scenarios**:

1. **Given** the published API description of ContentService (98 operations) and AnalysisService (39), **When** the record is checked against it, **Then** every operation has exactly one home and a one-line reason.
2. **Given** an endpoint whose substance is a Java library or Java numerical work, **When** the rule is applied, **Then** its home is Java; **Given** one that reads the graph, the search index or logic Reactome writes for the website, **Then** its home is node.
3. **Given** the record, **When** a reader looks for it, **Then** it is in this repository next to the earlier content-service-to-node research, and contains no internal host names, file paths or incident detail.

---

### User Story 2 - Library-bound ContentService endpoints answer from a Java service this repository builds (Priority: P2)

A visitor drawing interactors from a PSICQUIC service, uploading a custom interactor file or opening a shared overlay token, or downloading an event as SBML, SBGN or PDF, gets exactly the answer they get today — from a Java service that is built from Reactome's source repositories at a recorded version and deployed with the rest of the site, not from the shared application server.

**Why this priority**: it is the smaller of the two Java services and proves the pattern — build from a pinned source version, run behind node, compare byte for byte — before AnalysisService is moved.

**Independent Test**: with the old server still running, send the same requests to the old server and to the new service; responses are identical. Switch one address at a time to the new service; the visitor-facing pages behave the same; switch it back.

**Acceptance Scenarios**:

1. **Given** a request that today returns PSICQUIC interactors, a custom upload's token, an existing overlay token's interactors, an event's SBML/SBGN/PDF, or the events hierarchy, **When** it is sent to the new service, **Then** status, headers that matter to clients and body are identical to the old server's.
2. **Given** every overlay token issued since uploads began (328 on 17 Oct 2026, the oldest from 2019), **When** each is read through the new service, **Then** it returns the same interactors as before; no token is lost or changed.
3. **Given** a new upload made through the new service, **When** the same token is read later, **Then** it is still readable after a restart, a redeploy and a release.
4. **Given** an address node already answers, **When** the Java service is unavailable, **Then** that address is unaffected; **Given** an address the Java service answers, **When** it is unavailable, **Then** the reader gets a clear error, never a silent answer from anywhere else.
5. **Given** the library service's dependencies, **When** an upstream library publishes a fix, **Then** taking it is a version change and a rebuild, with no code translated by hand.

---

### User Story 3 - AnalysisService runs from this deployment, unchanged (Priority: P3)

A researcher submitting identifiers, reopening an analysis by its token, downloading results or the PDF report, or a curator citing a token in a paper, sees no difference: same numbers, same files, same tokens, same lifetimes — now served by an AnalysisService this repository builds and fronts.

**Why this priority**: it is the larger, heavier service, and the one where a regression would change published results; it goes second, on the pattern Story 2 proved.

**Independent Test**: replay a corpus of real analysis requests (identifier lists, species comparisons, projections, mappings, imports) against old and new; every result, download and report is byte-identical; tokens issued by one are readable by the other during the switch.

**Acceptance Scenarios**:

1. **Given** the same submission, **When** it is analysed by the old and the new service, **Then** p-values, FDRs, counts, found/not-found lists and every download are identical.
2. **Given** a token issued before the switch, **When** it is opened after, **Then** it returns the same result for as long as it would have before.
3. **Given** a Reactome release, **When** the release's analysis data is installed, **Then** the new service answers with the new release's data, with no manual step beyond the documented one.
4. **Given** analysis submissions do not go to external third-party services in testing, **When** parity is checked, **Then** it uses requests replayed against this deployment only.

---

### User Story 4 - The shared application server is switched off (Priority: P4)

An operator can switch the old application server off, and nothing a reader, integrator or curator uses stops working; and can switch it back on, one address at a time, if something does.

**Why this priority**: it is the goal of the whole migration, but only safe once Stories 2 and 3 are done.

**Independent Test**: with every address routed to its new home, stop the old server; run the site's end-to-end tests, the release checks and a crawl of every published API operation; all pass. Route one address back and start the old server; it answers again.

**Acceptance Scenarios**:

1. **Given** the old server is stopped, **When** every published operation of both services is called with a valid example, **Then** each answers from its new home exactly as before.
2. **Given** a problem with one address after the switch, **When** an operator reverses that one address, **Then** only that address moves back, by configuration, without a redeploy of anything else.
3. **Given** the old server is gone, **When** an integrator uses any old URL (including legacy exporter and analysis URLs), **Then** it still works.

---

### User Story 5 - The analysis result has one definition (Priority: P5)

A developer changing the site's analysis views works against one definition of what an analysis result contains, kept in this repository and checked against real results, instead of hand-copied models that drift.

**Why this priority**: it is what bringing AnalysisService closer buys the website directly; useful but not blocking.

**Independent Test**: run the shared definition against a corpus of real analysis results; every field the site reads is described, and a result with an unexpected shape fails a test.

**Acceptance Scenarios**:

1. **Given** a real analysis result, **When** it is checked against the shared definition, **Then** it passes; **Given** a result missing a field the site reads, **Then** the check fails.
2. **Given** the site's analysis pages, **When** they are built, **Then** they use the shared definition, not their own copies.

### User Story 6 - Analyses wait their turn instead of failing together (Priority: P3)

A researcher submits an analysis while the service is busy. Their analysis waits its turn and then runs at full speed, rather than every analysis in progress slowing down together until all of them pass the edge's time limit and fail. If the wait would be too long, they are told the service is busy and when to try again, at once, rather than after a timeout.

**Why this priority**: today nothing limits how many analyses run at once (measured 19 Oct 2026, research R12). Twelve at once took 10.5–12.6 s each against 2 s alone, so a large enough burst fails every analysis in it. The AnalysisService stays Java (decided 19 Oct 2026), so the limit goes in front of it, in this repository, without changing the Java service.

**Independent Test**: send more analyses at once than may run. The first ones answer in their usual time, the next wait and then answer, and those beyond the waiting limit get a "busy, try again in N seconds" answer at once. Reading a stored result is never held back.

**Acceptance Scenarios**:

1. **Given** the service is running its limit of analyses, **When** another is submitted, **Then** it waits and is answered when one finishes, with the same answer it would have had alone.
2. **Given** the waiting list is full, or an analysis has waited as long as it may, **When** it is waiting, **Then** it is answered at once with a busy status and when to retry.
3. **Given** analyses are waiting, **When** a stored result is read, a download is fetched or the service's metadata is asked for, **Then** that answer is not held back.
4. **Given** a waiting analysis whose reader gives up, **When** they go, **Then** their place is released and the analysis is never run.
5. **Given** any answer the AnalysisService gives, **When** it passes through, **Then** it reaches the reader unchanged.

### Edge Cases

- A library-bound endpoint is called while its Java service is restarting: the reader gets an error, not a stale or substitute answer.
- An overlay token file that cannot be read (corrupt, or written by an older library version): the same answer the old server gives for it today.
- A release changes the analysis data while analyses are running: running analyses finish on the data they started with, as today.
- Both Java services need the same large analysis data: memory on the host must hold it twice, or the services share it, or they run as one — decided by measurement, not assumed.
- An upstream library's new version changes an answer: the version change is caught by the parity check before it reaches readers, and either accepted as an upstream correction (stated in the PR) or held back.
- A third-party PSICQUIC server is slow or down: the answer is what the old server gives in the same situation; the Java service is not blocked for other readers.
- An endpoint node has ported is accidentally also served by Java: it is a failure, detected by the routing tests, because answers must come from one place.

## Requirements _(mandatory)_

### Functional Requirements

**The split**

- **FR-001**: The project MUST keep a record assigning every published operation of ContentService and AnalysisService to exactly one home — node, the Java library service, or AnalysisService — with the reason.
- **FR-002**: The record MUST state the rule: an operation whose substance is a Java library or Java numerical work stays in Java; one that reads the graph, the search index, or logic Reactome writes for the website moves to node. Cases the rule does not settle are decided by the team and added to the record.
- **FR-003**: The record MUST place, at minimum: PSICQUIC molecule queries and custom PSICQUIC queries; custom interactor uploads and overlay tokens; event SBML, SBGN and PDF export; the events hierarchy (it needs the analysis data's pathway sizes, which a graph count does not reproduce); and all of AnalysisService — in Java.

**Running the Java**

- **FR-004**: Each Java service MUST be built from Reactome's own source repositories at a recorded version, by this repository's deployment, with no Java source copied into this repository.
- **FR-005**: Java services MUST be reachable only from the same host. Node MUST own every public ContentService address and pass requests for Java-homed operations through unchanged. AnalysisService addresses are owned by nginx and answered only by AnalysisService: node answers none of them, and passing them through would cut long analyses short whenever node restarts (amended after research R5).
- **FR-006**: An operation whose home is node MUST never be answered by Java, including when node fails; an operation whose home is Java MUST fail visibly when its service is down.
- **FR-007**: The library service and AnalysisService MUST run separately unless measurement on the target host shows one process serves both within the memory available; the decision and its numbers MUST be recorded.
- **FR-008**: Taking an upstream fix in any Java library MUST be a version change and rebuild, verified by the parity check.

**Behaviour**

- **FR-009**: Every Java-homed operation MUST answer byte-identically to the current server for the same request, verified per operation before its address is switched.
- **FR-010**: Every existing overlay token and analysis token MUST remain readable with unchanged content and unchanged lifetime. Retention of both stores MUST stay as it is today: an LRU bound, never reached, that deletes files unread for a week only once a store passes about 2 GB. Any change is a separate Reactome decision.
- **FR-011**: Each Reactome release MUST be able to install new analysis data and new interactor data into the Java services by a documented step.
- **FR-012**: Parity testing of analysis MUST NOT submit to external analysis services; it replays requests against this deployment.

**Cutover**

- **FR-013**: Each address MUST be switchable to its new home, and back, independently, by configuration.
- **FR-014**: The old server MUST stay available, unrouted, until every address has run from its new home through at least one release; switching it off MUST be reversible.
- **FR-015**: The site's end-to-end tests, the release checks and the routing tests MUST pass with the old server stopped.

**Operations**

- **FR-016**: Each Java service MUST report its health and its build version, and MUST log requests and failures where the other services' logs are.
- **FR-017**: Memory for each Java service MUST be measured on the target host under a realistic load and set from that measurement.
- **FR-018**: The licence position of every commercially licensed Java dependency MUST be settled before the service that carries it goes live. Aspose.Slides is used only by the diagram exporter's PPTX path, which no Java-homed operation needs, and it runs unlicensed today; it is left out of both builds (research R8).

**The analysis result contract**

- **FR-019**: The shape of an analysis result, as the site reads it, MUST be defined once in this repository and checked against real results by tests.
- **FR-021**: Requests that start a computation (submitting identifiers, mapping, importing, a single identifier, a species comparison, and the PDF report) MUST be admitted a limited number at a time, set by configuration. Those beyond the limit MUST wait in arrival order on a waiting list of bounded length, for no longer than a bounded time.
- **FR-022**: A request that cannot be admitted, because the waiting list is full or its wait ran out, MUST be answered at once with a "service unavailable" status, in the service's own error format, saying when to retry. It MUST NOT be run later.
- **FR-023**: Every other request (stored results, downloads, metadata) MUST pass through without waiting. Every answer MUST reach the reader byte-identical to the AnalysisService's own, headers included.
- **FR-024**: A waiting request whose reader disconnects MUST lose its place and never be run. The limit, the waiting list's length and the longest wait MUST be reported with the queue's current state on a health check.
- **FR-020**: Before the shared application server is switched off, each of its other webapps MUST have a recorded home or retirement, decided on measured use. Besides ContentService and AnalysisService it hosts nine: the experiment digester, the search no-result report service, the old diagram and fireworks widgets, the old Pathway Browser, popular pathways, overlays, the old RESTful API and the root application (research R10).

### Key Entities

- **Operation**: one published endpoint (method and path) of ContentService or AnalysisService; has exactly one home and a reason.
- **Home**: where an operation is answered — node, the Java library service, or AnalysisService.
- **Java service**: a deployable unit built from named Reactome repositories at recorded versions; has a health check, a version, a memory budget, and the operations homed in it.
- **Overlay token**: identifies one custom interactor upload; readable by anyone holding it; kept under the store's LRU bound, which in practice keeps every token.
- **Analysis token**: identifies one analysis result; cited by curators; has the lifetime the current service gives it.
- **Release data**: the analysis data and interactor data a Reactome release provides to the Java services.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of the 137 published operations (98 ContentService, 39 AnalysisService) have a recorded home and reason ([contracts/operation-homes.md](contracts/operation-homes.md)).
- **SC-002**: Every Java-homed operation returns byte-identical answers to the current server across its parity corpus before it is switched — zero unexplained differences.
- **SC-003**: All existing overlay tokens (328 on 17 Oct 2026) and a sample of at least 100 existing analysis tokens read back identically after the switch.
- **SC-004**: With the old server stopped, the end-to-end suite, the release checks and a call to every published operation all pass.
- **SC-005**: Reversing any single address takes one configuration change and under five minutes, without affecting any other address.
- **SC-006**: Taking a new version of an upstream Java library is a change to a version number plus the parity run — no hand-translated code.
- **SC-008**: In a burst of analyses larger than the limit, the first ones are answered in their usual time, the rest in arrival order, and none of them passes the edge's time limit: each is either answered or told to retry within the longest wait.
- **SC-007**: Readers notice no change: analysis results, downloads, reports, exports and interactor overlays are the same as before, and response times are no worse than today's.

## Assumptions

- The source repositories can build the versions now deployed. **Confirmed by research R1:** every deployed artifact was traced to a commit and rebuilt to matching classes, with no private repository or credential needed.
- Both deployed webapps run from unmerged branches. The pins are those commits; asking their owners to merge them is a separate request.
- The Java library service lives in a new Reactome repository, which its owners create (research R2).
- The host has room for the Java services alongside the current ones once the old server stops; FR-017 measures this rather than assuming the amounts.
- Analysis token storage and lifetimes are kept exactly as the current service has them; changing them is a separate decision.
- BioPAX files are produced by the release pipeline, not by these services, and are out of scope; a BioPAX endpoint, if ever wanted, would belong to the Java side by the rule in FR-002.
- The ORCID endpoints, porting any analysis maths, porting the GPL-licensed scoring libraries, and changing any response shape are out of scope.
- Running GPL-3.0 libraries as a separate service on Reactome's own servers is not distribution of this repository's code; if the Java service's own source is published, its licence is chosen to be compatible with them.
- This repository is public: the record, the plan and the configuration name no internal hosts, file paths or incidents.
