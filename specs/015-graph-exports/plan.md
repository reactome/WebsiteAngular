# Implementation Plan: SBML and BioPAX from the graph, one exporter each

**Branch**: `spec/015-graph-exports` | **Date**: 2026-10-23, rewritten 2026-10-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/015-graph-exports/spec.md`

## Summary

Each format gets one implementation, reading the graph, used by both the release's bulk files and the website's on-demand downloads.

- **SBML is `reactome/sbml-exporter`'s graph-only converter.**
  - Its five defects are fixed and tested (R1, R9).
  - It gains a layout drawn from the site's diagram files, ported from the relational converter's algorithm in Java (R3).
  - Its command line makes the bulk archives with no relational database.
- **BioPAX Level 3 is `reactome/BioPAX3Exporter`.**
  - It is built out to the content today's files carry ([data-model.md](data-model.md), R4).
  - Its modes and `xml:base` are fixed, and it gains a per-reaction export.
  - It is proven by R4's comparison by meaning, against today's per-event and species files.
- **The website** serves both from a small `exports` service in this repository's compose, fronted by node at the URLs R6 decided, with no fallback to Java (R10).
- **This repository keeps the instruments:**
  - the sample;
  - the corrected SBML reference;
  - today's answers;
  - the comparison tools;
  - the validator runs.

  They are run against each exporter's output, before either the release or the website switches.

The changes to the two exporters go to their maintainers: an issue first, then pull requests once they agree (FR-010).

## Technical Context

**Language/Version**:

- `sbml-exporter`: Java (JDK 11 today).
- `BioPAX3Exporter`: Kotlin 1.7 on JDK 17.
- The `exports` service: a small JDK 17 HTTP wrapper.
- This repository's instruments: TypeScript under Node 24, as `tools/`.

**Primary Dependencies**:

- graph-core, aligned to one version for both exporters (R10);
- JSBML (SBML);
- Paxtools and the BioPAX validator (BioPAX);
- in CI only: python-libsbml 5.21.2 and the BioPAX validator 6.0.0 (R5).

**Storage**:

- the graph database;
- the diagram JSON of the same release (`diagram/{stId}.json`);
- on-demand answers cached per release (spec 011).

**Testing**:

- **In each exporter:** unit tests, one failing without each fix.
- **Here:** the comparison tools ([contracts/checks.md](contracts/checks.md)) over the sample, against the private graph copy (R8); `routes.spec.ts`; the parity harness for the website's status, headers and errors; before and after on beta.

**Target Platform**:

- the release's run, for the bulk files;
- the `exports` container beside content-node, for the website.

**Project Type**: two libraries with command lines (in other repositories), one small service and its routes (here).

**Performance Goals**:

- An on-demand answer asked for before, in the same release, is as fast as today's (0.1 s for 23.5 MB).
- A first export of the largest sampled pathway completes within the deep-work limits.
- The bulk run finishes within the release's time.

**Constraints**:

- byte parity for SBML's model;
- comparison by meaning for SBML's layout and for BioPAX;
- the deep shares;
- no personal data in this repository's fixtures, logs or output;
- light load on the shared graph;
- the maintainers' agreement before any change lands in their repositories;
- **no request to the production site, ever** (decided 23 Oct 2026). Every reference uses the beta host's own services and the private graph copy.

**Scale/Scope**:

- **SBML:** five fixes plus tests, a layout port (`LayoutConverter`, about 500 lines), and a graph-only command line.
- **BioPAX:** most of Level 3's content to build (data-model.md's table), three mode fixes and a per-reaction export.
- **Here:** one service, three routes and a redirect, two links, and one CI job.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **I. Verify the instrument.**
  - The SBML reference was checked against today's output; that is how its defects were found.
  - BioPAX is compared by canonical triples, because bytes differ even Java against Java (R4).
  - The validators' baselines come from today's files (R5).
  - BioPAX3Exporter's coverage was read, not assumed (R9).
  - **Pass.**
- **II. Measure in the thing.**
  - Every claim in research.md comes from code read or a live answer from this host.
  - Unmeasured, and so named as risks: graph-core alignment between the two exporters; the bulk run's time from the graph; species files' size from Paxtools.
  - **Pass.**
- **III. Prove a test fails first.** Each fix in an exporter comes with a test that fails without it. Each comparison tool and validator step is shown failing on a wrong file. **Pass.**
- **IV. No unstable identifiers for the reader.** Downloads are named by stable id. The legacy dbId URL redirects. **Pass.**
- **V. Comments carry the failure.** Every recorded difference states why ([contracts/differences.md](contracts/differences.md)). **Pass.**

**Re-check after design: pass.**

## Project Structure

### Documentation (this feature)

```text
specs/015-graph-exports/
├── spec.md, plan.md, research.md (R1–R10), data-model.md, quickstart.md
├── sample.md, reference-harness.md, today.md        # instruments, done
├── contracts/ endpoints.md, checks.md, differences.md
└── tasks.md                                         # links the maintainers' issues once posted
```

### Source code

```text
# In reactome/sbml-exporter (through its maintainers)
converter/ data/          # the five fixes, with tests
layout/                   # LayoutConverter over the diagram JSON (new)
Main                      # graph-only bulk run; relational options dropped

# In reactome/BioPAX3Exporter (through its maintainers)
builders                  # entity references, xrefs, stoichiometry, controllers,
                          # regulation, components, locations, literature, evidence
Launcher, WriteBioPAX3    # species mode, orphans, -l, xml:base, per-reaction export

# Here
deploy/exports/           # the exports service: Dockerfile, wrapper, compose entry
tools/content-node/exporters-endpoints.ts   # SBML (two URLs), BioPAX, legacy redirect → exports
tools/exports-compare/    # the SBML and BioPAX comparison tools (instruments)
deploy/nginx/…, proxy.conf.js, deploy/nginx/routes.spec.ts
.github/workflows/tests.yml                 # the exports job
projects/…/download-tab/, …/detail-download-bar/  # the BioPAX links
```

**Structure Decision**:

- **Node answers the URLs**, with R6's headers, errors and caching. The `exports` service writes only the body.
- **The comparison tools are standalone instruments** under `tools/exports-compare/`. They are not part of content-node, since they compare files from anywhere.

## Order of work

1. **Done:**
   - the sample, the private graph copy, the corrected SBML reference, and today's answers (T001–T004);
   - the interim BioPAX link (T009, #634).
2. **The issues.** The two maintainers' issues are drafted outside the repository, read by the user, then posted and linked from tasks.md. Nothing lands in either repository before its maintainers agree.
3. **The instruments:** the comparison tools, each shown failing; the validator baselines on today's files.
4. **SBML in `sbml-exporter`:**
   - the five fixes, with tests;
   - the comparison over the sample;
   - the layout port, compared;
   - the graph-only command line;
   - a release dry run compared with today's archives.
5. **The `exports` service and the SBML switch on the website:** routes, cache labels, parity entry, and before and after on beta.
6. **BioPAX in `BioPAX3Exporter`:**
   - content, built class by class against data-model.md;
   - per-event comparisons, then three species' files;
   - the mode fixes and the per-reaction export;
   - a release dry run.
7. **The BioPAX switch:**
   - the website's endpoint, the legacy redirect replacing #634's route, and the two links;
   - the release's Level 3 step moved to BioPAX3Exporter;
   - Level 2's decision recorded.
8. **The `exports` CI job**, added with the first exporter's fixtures.

## Complexity Tracking

| Addition                                | Why needed                                                                              | Simpler alternative rejected because                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| An `exports` service (a JVM) in compose | The exporters are Java libraries, and the website must run the same code as the release | Running their command lines per request starts a JVM per download. ContentService is being retired route by route. |
