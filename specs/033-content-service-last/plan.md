# Implementation Plan: The last ContentService operations move to node

**Branch**: `spec033/content-service-last` | **Date**: 2026-11-28 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/033-content-service-last/spec.md`

## Summary

Node takes over the nine operations the old Java ContentService still answers, so it can be switched off.

- **Story 1, the PSICQUIC queries:** ported to TypeScript and matched to Java's answers byte for byte. That means the same interactions, the same scores to Java's three decimal places, and Java's order, including what follows from Java's hash maps. Answers are cached on disk for a day and shared between visitors. Failures are never kept, and every third-party request has a timeout.
- **Story 2, custom interactors:** the parsers, their messages and Java's token scheme (the MD5 of name and content) are ported. Every existing token is converted once, by a small Java program built from the same classes, and checked one by one against Java.
- **Story 3, switching off:** routing moves the nine on every deployment. Once spec 015 T068 and spec 006 T100 have moved the event exports on the release server and production, the `/ContentService/` catch-all moves too. After one release, the webapp is removed and the repository archived.
- **The fallback:** for any part that cannot reach parity (research R1 names the candidates), node calls the Java logic for that part alone through the library service, and still owns the endpoint.

## Technical Context

**Language/Version**: TypeScript on Node 24, as `tools/content-node` (type-stripped, `noImplicitAny`, contract types). The conversion program, and any fallback part, is Java 17 in `deploy/java-library`.
**Primary Dependencies**: none new in node. It already has Express 5, the PSICQUIC registry reader (`psicquic.ts`), the envelope and `downloadGuard` (`answers.ts`, `server.ts`), and the shares (`deepShare`). The conversion uses interactor-core 1.1.5 and Kryo 5.3.0, and any fallback part micluster 1.7.14, miscore 1.3.14 and psimitab 1.8.6: the versions content-service ships, read from the deployed jars, to be pinned in `deploy/java/PINS.md`.
**Storage**: two folders, mounted from the deployment's `.env`: the PSICQUIC cache (gzip files, research R3) and the token store (JSON files, [contracts/token-store.md](contracts/token-store.md)).
**Testing**: Vitest specs beside each module, each seen failing first. Stub third-party servers and registry on loopback. Paired live comparisons with the Java service for parity ([quickstart.md](quickstart.md)). `routes.spec.ts` and `test-config.sh` for routing.
**Target Platform**: the content-node container on beta, the release server and production.
**Project Type**: web service (the node content service), plus routing and one Java program.
**Performance Goals**: a cached answer in under a second (SC-001); a third-party request ends within 30 s (SC-002).
**Constraints**: byte-identical to Java apart from the declared differences (FR-005); small, spaced requests to third-party servers; no Java ContentService on any request path when done; nothing server-specific in the repository.
**Scale/Scope**: 9 operations; about 14 PSICQUIC resources; about 320 tokens on production since 2019. The PSICQUIC port is about 1,800–2,000 lines of TypeScript, plus 1,000–1,500 of tests and fixtures (a prototype from the reading was about 650 lines of Python). The upload parsers add about 1,700 lines of Java behaviour to match.

## Constitution Check

_GATE: checked before Phase 0 research, and again after Phase 1 design._

| Principle                                                                | How this plan meets it                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Verify the instrument**                                             | The parity comparison is checked against itself first: Java against Java at the same moment (R4), so a difference in the third-party data is never mistaken for one in the port. The cache's "served from the cache" claim is checked by a stub server that counts the requests it receives. |
| **II. Measure in the thing**                                             | Every behaviour to match is read from the deployed source (R1, R5, R6) and checked against beta's answers. Answer sizes (R3) and timings (spec) were measured on beta. The contract types follow the recorded answers, never the other way round.                                            |
| **III. Prove a test fails**                                              | Each spec is shown failing on a mutant: the cache keeping a failure, the order without Java's hash-map layout, a score rounded differently, a token read from an unchecked path, a route sent to Tomcat.                                                                                     |
| **IV. Stable identifiers**                                               | Not touched: these operations take accessions and tokens, and return what Java returns.                                                                                                                                                                                                      |
| **V. Comments carry the failure**                                        | Where the port copies a Java quirk (hash-map order, `MessageFormat`'s grouping, the summary counting before de-duplication), the comment says what breaks without it.                                                                                                                        |
| **Quality gates** (preflight, ratchets, contract, routes in both tables) | Every PR passes preflight. The contract's `Interactors.resource` is widened through the contract module, with the OpenAPI description regenerated. nginx and `proxy.conf.js` change together.                                                                                                |
| **This repository is public**                                            | Folders, store locations and server details are in each deployment's `.env`. Neither the token store nor any upload's content is ever committed or printed.                                                                                                                                  |

**Result:** passes. No principle is set aside, so Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/033-content-service-last/
├── spec.md
├── plan.md            # this file
├── research.md        # R1–R7
├── research-psicquic.md  # R1 and R2 in full: the Java pipeline, with citations
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── operations.md  # the nine operations, their answers and the declared differences
│   ├── token-store.md # node's token file
│   └── settings.md    # the new settings
├── checklists/requirements.md
└── tasks.md           # /speckit-tasks
```

### Source Code (repository root)

```text
tools/content-node/
├── psicquic.ts                      # the registry (exists); gains the per-resource lookup
├── psicquic-mitab.ts                # MITAB parsing (R1)
├── psicquic-cluster.ts              # clustering (R1)
├── psicquic-score.ts                # the MI-score, with the ontology snapshot (R1)
├── psicquic-clients.ts              # the per-resource clients: score column, alias, URLs (R1)
├── psicquic-cache.ts                # the disk cache, in-flight sharing, limits (R3)
├── java-collections.ts              # Java's HashMap/HashSet iteration order, String.hashCode, number formats (R1, R5)
├── interactors-psicquic-endpoints.ts  # the four PSICQUIC operations
├── custom-interactors-parse.ts      # the three upload parsers and their messages (R6)
├── custom-interactors-store.ts      # the token store (R5)
├── interactors-custom-endpoints.ts  # the five upload and token operations
└── fixtures/psicquic-ontology.json  # the MI ontology terms the score uses: OLS4's first page, as Java gets it (R1)
projects/contract/interactors.ts     # Interactors.resource widened; TupleResult, CustomPsicquicResource
deploy/java-library/                 # the conversion program; any fallback part (R4)
deploy/nginx/common/routes-core.conf, proxy.conf.js, deploy/nginx/routes.spec.ts
docker-compose.yml                   # the two folders mounted into content-node
```

**Structure Decision**: each family of endpoints is a module of its own, and what they share sits in shared modules, as spec 014 laid the service out. The two new families import only shared modules (`boundaries.spec.ts`), and `registry.ts` adds them in the order `fixtures/route-order.json` records. The names above are a plan: the first PR of each story settles them.

## Order of work

1. **Contract and recordings:** record beta's answers for each of the nine (small and spaced), widen `Interactors.resource`, and add the upload types.
2. **Story 1, in parts, each a PR:** Java's collections and number formats; MITAB parsing; clustering; scoring with the ontology snapshot; the per-resource clients; the endpoints behind the cache, not yet routed; parity over the sample (R4), with any fallback decided per part; then routing on every deployment.
3. **Story 2:** the conversion program and its run on a copy (by the server's session for production's store); the parsers; the store and the endpoints, not yet routed; parity for every token and the upload corpus; then routing.
4. **Story 3:** once spec 015 T068 and spec 006 T100 are done, the catch-all; one release; the webapp removed; the repository archived.

## Complexity Tracking

None: the Constitution Check passes without exceptions.
