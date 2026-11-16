# Implementation Plan: ContentService answered by node

**Branch**: `port/*`, one per endpoint family | **Date**: 2026-10-17 (written after the fact) | **Spec**: [spec.md](spec.md)

## Summary

Port ContentService one endpoint family at a time to the node content service (`tools/content-node`), byte-identical to Java. Each port goes test-first and is compared live with Java. It is routed per operation in nginx and the dev proxy, adversarially reviewed, deployed, and checked on the deployed site. The decisions behind this are in [research.md](research.md) (D1–D20). Operations that stay in Java are planned in [spec 010](../010-java-services/spec.md).

## Technical Context

**Language/Version**: Node 24, plain ES modules (`.mjs`), no build step
**Primary Dependencies**: Express 4; the Neo4j driver (graph, read-only sessions); Solr over HTTP (search)
**Storage**: none of its own. It reads the release's graph database and search index, and holds Java-equivalent caches in memory (D9, D10).
**Testing**: Vitest, with the graph and Solr stubbed per spec; a live parity script against Java that sends node's own side effects (such as the no-result report) nowhere
**Target Platform**: a container behind nginx, beside the Java service until that is retired
**Constraints**: byte-identical to Java (D3, D11); no fallback to Java for a ported route; the shared database and search index carry the live site, so parity runs are small and spaced

## Constitution Check

- **I. Verify the instrument:** parity compares node with Java, never Java with itself. Which backend answered is checked on the deployed site by the content type each writes, a lesson from #468.
- **II. Measure in the thing:** every port is checked on the deployed site, on the page that calls it.
- **III. Prove tests fail:** each behaviour is shown failing by mutation before merge.
- **IV. Stable identifiers:** ids are read in every form Java reads; nothing new exposes a dbId.
- **V. Comments carry the failure:** the Java behaviour each quirk reproduces is named at the code.

## How one endpoint is ported

1. **Read Java first.** Read the controller, service and repository in content-service, graph-core or search-core, and the deployed jars where the source and the deployed version differ.
2. **Write the tests first,** from Java's measured answers, including its errors and quirks.
3. **Implement it** in `service.mjs`, or a module beside it for a family (`citation.mjs`, `psicquic.mjs`, …).
4. **Compare live with Java** on real ids, including edge forms. Every difference is fixed or declared with its rule (D19).
5. **Route it** in `deploy/nginx/common/routes-core.conf` and `proxy.conf.js`, with and without a trailing slash. Add it to the proxy-order test's node list, and its neighbours to the Java list.
6. **Open a PR,** with an adversarial review, then a follow-up review after any change, and CI green on the head commit.
7. **Merge and deploy:** rebuild the image, run `nginx -t`, check the build hash, then check on the deployed site by what a reader sees.
8. **Tick its task** in [tasks.md](tasks.md), with the PR number, in the same PR.

## Project Structure

```text
specs/006-content-service-to-node/
├── research.md   # decisions D1–D20
├── spec.md
├── plan.md       # this file
└── tasks.md      # every operation, its PR or its home

tools/content-node/
├── service.mjs   # endpoints, routing, Java's error envelopes
├── graph.mjs     # read-only graph access
├── solr.mjs      # search index access
├── domain.mjs    # the domain serialiser (Jackson's shapes)
└── *.spec.mjs    # tests, one or more per family

deploy/nginx/common/routes-core.conf   # which operations go to node
proxy.conf.js                          # the same, for the dev server
```
