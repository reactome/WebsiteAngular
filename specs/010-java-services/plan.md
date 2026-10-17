# Implementation Plan: The Java side of Reactome's services

**Branch**: `plan/010-java-services` | **Date**: 2026-10-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/010-java-services/spec.md`

## Summary

Keep the Java that should stay Java, and retire the shared application server.

- **ContentService:** its 13 Java-homed operations move to a new small Spring Boot service, built from Reactome's libraries at pinned commits, which node passes requests through to.
- **AnalysisService:** runs unchanged, built from its own repository at a pinned commit, in its own container, routed by nginx.
- **Cutover:** every address is cut over separately and reversibly, after byte-identical parity with the running server.
- **Tomcat:** switched off only once every one of its eleven webapps has a home or a retirement.
- **Last:** the site gets one checked definition of the analysis result.

The decisions behind this are in [research.md](research.md) (R1–R10).

## Technical Context

**Language/Version**:

- Java 11 runtime, as deployed today; event-pdf builds on JDK 17 with Java 11 as its target.
- Node 24 for content-node.

**Primary Dependencies**:

- **Java library service:** Spring Boot, interactor-core 1.1.5, Kryo 5.3.0, event-pdf, sbml-exporter, diagram-exporter (without Aspose), analysis-core, graph-core and reactome-base, each pinned to a commit (R1).
- **AnalysisService:** analysis-service at its deployed commit.
- **Node:** `node:http` and `stream.pipeline`, with no new package.

**Storage**: the volumes in [data-model.md](data-model.md):

- the overlay-token store
- analysis result tokens
- the per-release analysis data
- the export cache
- the read-only release files

The library service also reads the graph and the relational release database.

**Testing**:

- **Unit:** Vitest for node's pass-through and routing; the existing routing specs extended to `routes.conf` and three outcomes.
- **Parity:** the Java-against-Java harness (R7), plus a through-node transparency check.
- **Unchanged:** `deploy/nginx/test-config.sh` and the end-to-end suite.

**Target Platform**: Linux containers in this repository's compose, loopback-only, behind nginx.

**Project Type**: web services, plus deployment configuration.

**Performance Goals**: no reader-visible regression. Response times no worse than Tomcat's for the same request (SC-007), measured by the parity harness's timings.

**Constraints**:

- byte-identical answers
- existing tokens keep reading
- memory within the host while Tomcat still runs (R3)
- nothing internal in this public repository
- the shared graph database and search index carry the live site, so parity runs are small and spaced

**Scale/Scope**:

- 137 published operations recorded
- 13 operations moved to the library service
- 39 run by AnalysisService
- 11 Tomcat webapps inventoried

## Constitution Check

_GATE: passed before Phase 0; re-checked after Phase 1._

| Principle                     | How this plan meets it                                                                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Verify the instrument      | Parity compares the candidate against a reference that is the deployed artifact itself (R1), never against itself. A reference-against-reference pair calibrates PSICQUIC's live data. A through-node check proves the pass-through separately from Java parity. |
| II. Measure in the thing      | Each cutover is checked on the deployed site, on the page that uses the address: the interactor overlay, uploads, the export buttons, the analysis pages. Memory budgets come from a load test, not this plan's estimates (FR-017).                              |
| III. Prove tests fail         | Routing tests are shown failing on a misroute, pass-through tests on a fallback, and parity on a deliberately altered candidate.                                                                                                                                 |
| IV. Stable identifiers        | No reader-facing identifier changes; tokens keep their values and lifetimes.                                                                                                                                                                                     |
| V. Comments carry the failure | The pinned commits, the Kryo version freeze and the Aspose exclusion each record why at the place they are set.                                                                                                                                                  |
| Public repository             | Host paths, host names, credentials and release-process detail stay out of this repository and the new one. Settings are supplied at run time.                                                                                                                   |

Complexity is justified in the Complexity Tracking table below. Gate: **pass**.

## Phase 1 design outputs

- [contracts/operation-homes.md](contracts/operation-homes.md) is the decision record (Story 1), with every published operation's home and reason.
- [contracts/pass-through.md](contracts/pass-through.md) is node's contract with the Java services: what is forwarded, what is returned, and how failure looks.
- [data-model.md](data-model.md) covers the services, their state and volumes, and the per-address route state.
- [quickstart.md](quickstart.md) explains how to show each story working.

## Work order

Each phase is its own set of pull requests, each ending in review, CI, merge, deploy and verification on the deployed site.

1. **Decision record (Story 1).** Done in this plan: [operation-homes](contracts/operation-homes.md). Corrections to the spec from research (FR-005, FR-010, FR-018, FR-020) are made in the same PR.
2. **Java library service (Story 2).**
   - **The repository:** a new Reactome repository, which needs its owners. It holds the Spring Boot app with the glue from content-service, interactor-core and Kryo frozen, and Aspose excluded.
   - **The image:** a multi-stage build that builds the pinned libraries from source.
   - **This repository's side:**
     - a compose service with its volumes and run-time settings;
     - node's pass-through and graceful shutdown;
     - routing tests that read `routes.conf` and know three outcomes;
     - the parity harness.
   - **Cutover:** one address group at a time, in this order: PSICQUIC; tokens and uploads; SBGN and SBML; event PDF. The events hierarchy stays on Tomcat (R3).
3. **AnalysisService (Story 3).**
   - Build it from its pinned commit and run it in its own container, with token and data volumes.
   - nginx routes it directly (R5).
   - Prove parity with the replay corpus, then cut over.
   - Then move the events hierarchy to the library service, now that Tomcat's copy of the data is gone, or to a small per-release sizes file (R3, open question).
4. **Tomcat switch-off (Story 4).**
   - Inventory and decide the other nine webapps (FR-020).
   - Point both prefixes away from Tomcat.
   - Keep Tomcat installed but unrouted through one release (FR-014), then switch it off.
5. **Analysis result types (Story 5).** Generated or checked against the parity corpus.

## Project Structure

### Documentation (this feature)

```text
specs/010-java-services/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R10
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── operation-homes.md
│   └── pass-through.md
└── tasks.md             # next: /speckit-tasks
```

### Source Code

```text
# This repository
tools/content-node/
├── service.mjs            # pass-through table mounted first; graceful shutdown
├── java-pass-through.mjs  # new: node:http streaming proxy to the Java services
└── *.spec.mjs             # pass-through and disjointness tests

deploy/
├── java-library/          # new: Dockerfile (multi-stage, pinned commits), no source
├── analysis/              # new: Dockerfile for AnalysisService at its pinned commit
└── nginx/
    ├── common/routes-core.conf, routes.conf   # per-address cutover
    └── routes.spec.ts     # reads routes.conf too; three outcomes

tools/java-parity/         # new: Java-against-Java harness, normalisers per class
docker-compose.yml         # two Java services, volumes, loopback-only

# New Reactome repository (owners to create)
reactome/<java library service>   # Spring Boot app: the 13 operations, AGPL-3.0
```

## Complexity Tracking

| Added                                     | Why it is needed                                                                 | Simpler alternative rejected because                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A new repository and service              | Holds only the 13 Java-homed operations, and only their dependencies.            | content-service unchanged would start Solr, mail, a relational adaptor and a second copy of the analysis data, and answer about 165 routes (R2). |
| Multi-stage builds of pinned libraries    | Reproducible from source.                                                        | Snapshot artifacts are republished; the parent POM already was once (R1).                                                                        |
| A Java-against-Java parity harness        | Byte-identical proof that also covers PDFs, live PSICQUIC data and token stores. | The existing `diff.mjs` compares node with Java over node's endpoint table only (R7).                                                            |
| AnalysisService routed by nginx, not node | Node adds a hop and would cut analyses short on restart (R5).                    | Strict FR-005 through node costs more than it buys for a service node answers none of.                                                           |
