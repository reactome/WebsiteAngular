# Feature Specification: The last ContentService operations move to node

**Feature Branch**: `spec033/content-service-last`
**Created**: 2026-11-28
**Status**: Draft
**Input**: Decided by the project's owner (28 Nov 2026): the remaining ContentService operations are converted to the node content service, PSICQUIC first and with a cache, so that the old Java ContentService answers nothing and `reactome/content-service` can be archived.

> **Supersedes** the amendment proposed for spec 010 on 23 Nov 2026 (PR #1042: the nine operations kept in Java, in `deploy/java-library`), spec 006 T101 and T102 (the PSICQUIC queries and the uploads "stay in Java"), and spec 006 research D26's decision. D26's measurements stand and are this spec's starting point. #1042's FR-027 (archive `reactome/content-service` once nothing is answered there) is carried over as FR-016.

## Where things stand

Node answers every operation the Java ContentService publishes, except nine, in two families. A tenth family, ORCID's "Claim your work" (spec 006 T110), was never in the deployed service and has its own spec; it is out of scope here.

| Family                 | Operations                                                                                                                                                                          | Who uses them                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| PSICQUIC queries (4)   | an accession's interactors from a named PSICQUIC resource, as details or a summary; and the same for many accessions at once (the diagram's proteins)                               | The Pathway Browser's interactor overlays: choosing a third-party resource, and the count shown beside each resource in the panel |
| Custom interactors (5) | upload a tuple file (as text, as a form, from an address), register a custom PSICQUIC service by its address, and read a diagram's interactors back by the token an upload returned | The Pathway Browser's "Add overlay resource" dialog, and every overlay link (`?overlay=<token>`) shared or bookmarked since 2019  |

**Measured on beta, 28 Nov 2026:** one resource (MINT) took **21 s** to answer for a small pathway (1.9 KB of identifiers). The Pathway Browser asks all thirteen live resources in the background to show their counts; each takes 6 to 21 s. Every visitor, and every reload, asks them all again: the Java service keeps no answer between requests. A server that does not answer at all holds a request for about 135 s, because the Java service sets no timeout (D26).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Third-party interactors without the wait (Priority: P1)

A researcher opens a pathway in the Pathway Browser and opens the interactors panel. Beside each third-party resource the panel shows how many interactions it holds for this diagram. Today those counts appear one by one over about twenty seconds, for every visitor and every reload. With this story, a pathway that anyone has opened recently shows its counts at once, and choosing a resource draws its interactors at once.

**Why this priority**: it is the slowness the project's owner reported, it is on a page researchers use, and it is the family with no stored data to carry over, so it can move first on its own.

**Independent Test**: open a pathway's interactors panel twice, from two different browsers. The first time the counts arrive as the third-party servers answer; the second time they are all there within a second. Then choose a resource and see its interactors drawn.

**Acceptance Scenarios**:

1. **Given** a pathway whose resources were asked in the last day, **When** a second visitor opens its interactors panel, **Then** every resource's count is shown within one second, with no request reaching the third-party servers.
2. **Given** a third-party server that fails or does not answer, **When** the panel asks it, **Then** each fetch ends within the stated timeout and is handled as the Java service handles a failed fetch, and the incomplete answer is not remembered: the next visitor asks again.
3. **Given** any of the four operations and any input the Java service accepts or refuses, **When** node answers it, **Then** the answer is the Java service's (status, headers and body, scores to Java's three decimal places), except for the timeout and the cache (FR-005).

---

### User Story 2 - Every overlay link keeps opening (Priority: P2)

Someone opens an overlay link that a colleague shared years ago (`?overlay=<token>`). The custom interactors it was made with are drawn on the diagram, exactly as before the move. Someone else uploads a new list of interactor pairs, or registers their own PSICQUIC service, and gets a token that works the same way.

**Why this priority**: the custom interactors are a stored, published promise: tokens have been handed out since 2019 and nothing expires. Moving them must not break one. They are used less than the third-party overlays, so they follow Story 1.

**Independent Test**: take every token in the existing store, ask both the Java service and node for each one's interactors over the same identifiers, and compare the answers; upload the same files to both and compare their parses, warnings and refusals.

**Acceptance Scenarios**:

1. **Given** any token in the existing store, **When** a diagram's interactors are asked for with it, **Then** node's answer is the Java service's for the same request.
2. **Given** a tuple file with a header line and two columns, **When** it is uploaded as text, as a form, or by address, **Then** node returns a new token, and the warnings and summary the Java service returns for the same file.
3. **Given** a file the Java service refuses or warns about (a missing header, a third column, a line with a missing field, an unreadable file), **When** it is uploaded to node, **Then** the refusal or warning is the Java service's, word for word.
4. **Given** the address of a custom PSICQUIC service, **When** it is registered, **Then** node returns a token, and reading with that token asks that service, with the same timeout and caching rules as Story 1.

---

### User Story 3 - The old ContentService is switched off (Priority: P3)

The team retires the old Java ContentService: nothing reaches it, it is removed from the shared application server after one release, and its repository is archived with a README that says where each operation went.

**Why this priority**: it is the payoff of Stories 1 and 2, and it can only follow them.

**Independent Test**: with the old ContentService stopped, every published ContentService operation still answers through the site, and the end-to-end suite passes.

**Acceptance Scenarios**:

1. **Given** every deployment's routing, **When** any ContentService path is requested, **Then** no route sends it to the old Java service.
2. **Given** the old ContentService stopped, **When** every published operation is called with its documented example, **Then** each answers as before.
3. **Given** one release has run with nothing routed to the old service, **When** the repository is archived, **Then** its README names each operation's home.

---

### Edge Cases

- **A resource name the PSICQUIC registry does not list**, or lists as inactive: the Java service's answer (today a 500 in its error format, naming the resource), not a cached one.
- **The registry itself unreachable**: the list of resources is already node's, re-read every five minutes; the queries use the last list that was read, and say so in a clear error when there has never been one.
- **The same diagram asked by many visitors at once**, before any answer is cached: the third-party server is asked once, and every visitor gets that answer.
- **A third-party answer that is partial** (some accessions answered, some failed): treated as a failure for caching, so only complete answers are kept.
- **A very large diagram** (thousands of identifiers): its answer is cached like any other, or, past a stated size, served without caching rather than refused.
- **A token that does not exist, or is malformed**: the Java service's answer for it.
- **A token file that cannot be converted** in the one-time conversion: listed, reported, and the conversion stops before any route moves; no token is silently lost.
- **An upload by address** that points at something unreachable, too large, or not a tuple file: the Java service's refusal, within a timeout.
- **The order of interactors, and of accessions**, where the Java service's order comes from its internal hash maps: matched as the Java service writes it (FR-005).

## Requirements _(mandatory)_

### Functional Requirements

**The PSICQUIC queries (Story 1)**

- **FR-001**: Node MUST answer the four PSICQUIC operations (an accession's details and summary; many accessions' details and summary), at the paths, methods and body formats the Java service accepts, slashed forms included.
- **FR-002**: An answer from a third-party resource MUST be kept and given to every later request for the same resource and the same accessions, for **one day**, so that a pathway asked about once is answered at once for everyone that day.
- **FR-003**: A failure (an error, a timeout, a partial answer, an unknown resource) MUST NOT be kept: the next request asks again.
- **FR-004**: Every fetch from a third-party server MUST end within a stated timeout (default **30 seconds** a fetch). A fetch that times out MUST be treated as the Java service treats a fetch that fails: in a request for many accessions that accession is left out, and a request for one is the Java service's "not responding" error. The Java service's unbounded wait is a declared difference.
- **FR-005**: The answers MUST be the Java service's: the same interactions, the same scores to the three decimal places the Java service writes (it rounds every score to 0.001), and the same order, so that each answer is byte-identical. Only the timeout (FR-004), the cache (FR-002) and the ontology (the score's ontology terms are a snapshot, where the Java service asks a live service on every request and scores every term as unknown when that service fails) are declared differences. The clustering and the MI-score are ported, with the score's ontology terms kept as a snapshot in this repository rather than fetched on every request. If any part cannot reach parity, node MUST call the Java logic for that part alone through this repository's library service (`deploy/java-library`), and still own the endpoint. No part MAY be left on the old ContentService. (Decided by the project's owner, 28 Nov 2026.)
- **FR-006**: Requests for the same resource and accessions that arrive while the first is still waiting MUST share its answer rather than each asking the third-party server.
- **FR-007**: The number of requests node makes to any one third-party server at once MUST be limited, so that a burst of visitors never floods another organisation's service.

**Custom interactors (Story 2)**

- **FR-008**: Node MUST answer the five custom-interactor operations: upload as text, as a form and from an address; register a custom PSICQUIC service; and read by token.
- **FR-009**: Every token in the existing store MUST keep working: the store MUST be converted once into a format node reads, and every converted token MUST be checked against the Java service's answer before any of these routes moves.
- **FR-010**: New uploads MUST follow the tuple format's rules as the Java service applies them: the header line, two identifier columns, a confidence of 1.0 for every pair, and the same warnings and refusals, word for word.
- **FR-011**: A new token MUST be as hard to guess as the Java service's, MUST never expire (as today), and MUST be stored where it survives a restart, a redeploy and a move to another server.
- **FR-012**: Reading by a token that names a custom PSICQUIC service MUST follow FR-002 to FR-007 for that service.
- **FR-013**: Uploads MUST be limited in size and in rate per client, and an upload by address MUST be bounded by a timeout and a size limit, so that the service cannot be used to fetch large or slow resources on someone else's behalf.

**Retiring the old service (Story 3)**

- **FR-014**: Every deployment's routing (beta, the release server and production) and the development proxy MUST send all nine operations to node, and the routing tests MUST show that no ContentService path reaches the old service.
- **FR-015**: Node MUST never pass one of these requests to the old Java service as a fallback (as for every other route node answers).
- **FR-016**: Once every ContentService operation has run from node through one release, the old ContentService MUST be removed from the shared application server, and `reactome/content-service` MUST be archived with a README naming each operation's home (carried from #1042).
- **FR-017**: Spec 006's tasks T101 and T102, spec 010's operation homes, and the register of declared differences MUST be updated in the same pull requests that move each family.

### Key Entities

- **PSICQUIC resource**: a third-party interaction service listed by the PSICQUIC registry, with a name, an address and whether it is active. Node already keeps this list.
- **Cached answer**: one resource's answer for one set of accessions, kept for one day; never a failure.
- **Custom interactor set**: the pairs of identifiers one upload contained (each with a confidence of 1.0), or the address of a custom PSICQUIC service; addressed by a token.
- **Token**: an unguessable name for a custom interactor set; handed out since 2019, put in overlay links, never expiring.
- **Token store**: every custom interactor set, today one file per token in the Java service's own serialised format, to be converted once into one node reads.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For a pathway whose resources were asked in the last day, every resource's count in the interactors panel appears within **1 second** (today 6 to 21 seconds per resource).
- **SC-002**: No fetch from a third-party resource takes longer than the stated timeout (today a fetch waits without limit: about 135 seconds measured on an unreachable server).
- **SC-003**: Over a sample of pathways and every live resource, asked of both services at the same moment, node's answers are the Java service's: the same interactions, scores and order, with no difference but the timeout and the cache.
- **SC-004**: **Every** token in the existing store (several hundred) opens the same overlay through node as through the Java service: zero lost.
- **SC-005**: Uploading the same files to both services gives the same tokens' contents, warnings and refusals.
- **SC-006**: With the old ContentService stopped, every published ContentService operation answers through the site and the end-to-end suite passes.
- **SC-007**: After one release with nothing routed to it, the old ContentService is switched off and its repository archived.

## Assumptions

- **One day** is a fair lifetime for a cached PSICQUIC answer: third-party interaction data changes on the scale of releases, not hours. It is a setting, and can be shortened.
- **A 30-second timeout per fetch** is enough for every resource that answers at all; it is a setting. It bounds each fetch, not the whole request: a large diagram is many fetches, and the Java service took 102 s for two accessions from one resource (most of it, the research suggests, its 16 ontology requests and repeated registry lookups, which node does not make).
- **The cache lives in the node service** (in memory and, if planning finds it worthwhile, on disk), not in the browser and not in the web server, so it serves every visitor and survives the move away from Java.
- **The existing token store is converted once**, by a step that reads the Java service's files with the Java library that wrote them, and writes a format node reads; the Java format is never read by node directly.
- **The IntAct libraries are not kept**: one of them is a snapshot build from a repository that no longer serves reliably, so keeping the Java logic would mean rescuing those libraries too. The library service is the fallback for a part that cannot be matched, not the plan.
- **The tuple format and its messages are unchanged**: the Pathway Browser's dialog already parses files in the browser (since Sept 2026), and uploads only to get a token.
- **ORCID** ("Claim your work") is out of scope: it has its own spec.
- **Release work comes first**: this spec is planned now and built in step with the December release's own work, not ahead of it.
