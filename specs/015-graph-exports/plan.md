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
  - It is proven by R4's comparison by meaning:
    - against the release's published `biopax.zip`, which is Pathway-Exchange's output (R9). This is the main proof;
    - against the legacy service's per-event files.
- **The website** gets both from spec 010's Java library service, fronted by node at the URLs R6 decided, with no fallback (R10). That service is spec 010's to build; this spec changes its SBML operation and adds BioPAX.
- **This repository keeps the instruments:**
  - the sample;
  - the corrected SBML reference;
  - today's answers, and the release's published bulk files;
  - the comparison tools;
  - the validator runs.

  They are run against each exporter's output before either the release or the website switches.

The changes to the two exporters go to their maintainers: an issue first, then pull requests once they agree (FR-010).

## Technical Context

**Language/Version**:

- `sbml-exporter`: Java (JDK 11 today).
- `BioPAX3Exporter`: Kotlin 1.7 on JDK 17.
- Spec 010's library service: Spring Boot, on a JDK 17 runtime (R10).
- This repository's instruments: TypeScript under Node 24, as the rest of `tools/`.

**Primary Dependencies**:

- graph-core, at spec 010's pinned version, agreed with both exporters (R10);
- JSBML (SBML);
- Paxtools and the BioPAX validator 6.0.0 (BioPAX);
- for the instruments: python-libsbml 5.21.2 and the BioPAX validator 6.0.0 on JDK 17 (R5).

**Storage**:

- the graph database;
- the diagram JSON of the same release (`diagram/{stId}.json`);
- the release's published bulk files, kept outside the repository, since they hold people's names;
- on-demand answers, cached per release (spec 011).

**Testing**:

- **In each exporter:**
  - unit tests, each failing without its fix;
  - the format's validator in its CI, over the output for a small fixture graph.
- **Here:**
  - the comparison tools ([contracts/checks.md](contracts/checks.md)) over the sample and the species files, against the private graph copy (R8);
  - `routes.spec.ts`;
  - the parity harness, for the website's status, headers and errors;
  - before and after on beta.

**Target Platform**:

- the release's run, for the bulk files;
- spec 010's library service, for the website.

**Project Type**:

- two libraries with command lines, each in its own repository;
- two operations of spec 010's service;
- routes and links in this repository.

**Performance Goals**:

- An on-demand answer asked for before, in the same release, is as fast as today's: 0.05–0.14 s for 23.5 MB, as measured.
- A first export of the largest sampled pathway completes within the deep-work limits.
- The bulk run finishes within the release's time.

**Constraints**:

- byte parity for SBML's model;
- comparison by meaning for SBML's layout and for BioPAX;
- the deep shares;
- no personal data in this repository's fixtures, logs or output;
- light load on the shared graph;
- the maintainers' agreement before any change lands in their repositories;
- **no request to the production site's services, ever** (decided 23 Oct 2026). Every reference uses the beta host's own services and the private graph copy, with one exception, decided with the user on 24 Oct 2026: the release's published bulk files, static files in its download directory (`download.reactome.org/{release}/`), are the bulk references. They are fetched one file at a time, only when a task needs them, and kept outside the repository.

**Scale/Scope**:

- **SBML:** five fixes with tests, a layout port (`LayoutConverter`, about 500 lines), and a graph-only command line.
- **BioPAX:** most of Level 3's content to build (data-model.md's table), three mode fixes and a per-reaction export.
- **Here:** the comparison tools, three routes and a redirect, two links, and amendments to spec 010.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **I. Verify the instrument.**
  - The SBML reference was checked against today's output; that is how its defects were found.
  - BioPAX is compared by canonical triples, because bytes differ even Java against Java (R4).
  - The bulk reference's generator was checked, not assumed: release 97's `biopax.zip` carries Pathway-Exchange's form and content (R9).
  - The validators' baselines come from today's files (T034).
  - BioPAX3Exporter's coverage was read (R9), and is measured before any work starts (T035).
  - **Pass.**
- **II. Measure in the thing.**
  - research.md's claims come from code read or from live answers.
  - The research of 23 Oct also took a few samples from production, before the rule against it existed; R4 records them. They are kept as history, and nothing since relies on them.
  - Unmeasured, and so named as risks: graph-core alignment, the bulk run's time from the graph, and the size of Paxtools' species files.
  - **Pass.**
- **III. Prove a test fails first.**
  - Each fix in an exporter comes with a test that fails without it.
  - Each comparison tool and validator step is shown failing on a wrong file.
  - **Pass.**
- **IV. No unstable identifiers for the reader.**
  - Downloads are named by stable id.
  - The legacy dbId URL resolves the dbId and redirects to the stable-id URL (T053).
  - **Pass.**
- **V. Comments carry the failure.** Every recorded difference states why ([contracts/differences.md](contracts/differences.md)). **Pass.**
- **The repository's working rules** (CLAUDE.md, and keeping `RELEASE-TESTING.md` and `CURATOR-REPORT.md` current):
  - **An explicit exception to "byte-identical to Java's answer".**
    - The SBML body is compared with the corrected reference and today's layout, by T030.
    - The BioPAX body has no Java counterpart at its URL, and is compared by T031.
    - Status, headers and errors are still compared live with the parity harness.
  - **T054 updates the two documents** when the site's links move.

**Re-check after design: pass.**

## Project Structure

### Documentation (this feature)

```text
specs/015-graph-exports/
├── spec.md, plan.md, research.md (R1–R10), data-model.md, quickstart.md
├── sample.md, reference-harness.md, today.md        # instruments
├── contracts/ endpoints.md, checks.md, differences.md
└── tasks.md                                         # links the maintainers' issues once posted
```

### Source code

```text
# In reactome/sbml-exporter (through its maintainers)
converter/ data/          # the five fixes, with tests
layout/                   # LayoutConverter over the diagram JSON (new)
Main                      # graph-only bulk run; relational options dropped
CI                        # libSBML over a fixture graph's output

# In reactome/BioPAX3Exporter (through its maintainers)
builders                  # entity references, xrefs, stoichiometry, controllers,
                          # regulation, components, locations, literature, evidence
Launcher, WriteBioPAX3    # species mode, orphans, -l, xml:base, per-reaction export
CI                        # the BioPAX validator over a fixture graph's output

# In spec 010's library service (its own repository)
the SBML operation        # the graph-only converter (spec 010 T014, amended)
a BioPAX operation        # WriteBioPAX3 (new)

# Here
tools/exports-compare/    # the SBML and BioPAX comparison tools (instruments)
tools/content-node/exporters-endpoints.ts   # SBML (two URLs), BioPAX, legacy redirect → the library service
deploy/nginx/…, proxy.conf.js, deploy/nginx/routes.spec.ts
projects/…/download-tab/, …/detail-download-bar/  # the BioPAX links
```

**Structure Decision**:

- **Node answers the URLs**, through spec 010's pass-through, with R6's headers, errors and caching. The library service writes only the body.
- **The comparison tools are standalone instruments** under `tools/exports-compare/`, comparing files from anywhere.

## Order of work

1. **Done:**
   - the sample, the corrected SBML reference made from a private graph copy (since removed; T032 recreates it), and today's answers (T001–T004);
   - the interim BioPAX link (T009, #634);
   - the issue drafts (T027);
   - the amendments to spec 010 (T043).
2. **The maintainers.**
   - The issues are posted once the user approves them (T028), and graph-core is agreed (T029).
   - Nothing lands in either exporter before its maintainers agree.
3. **The instruments** (T030–T035):
   - the comparison tools, each shown failing;
   - the private graph copy, when a comparison needs it;
   - the release's bulk references;
   - the validator baselines;
   - BioPAX3Exporter's baseline.
4. **SBML in `sbml-exporter`** (T036–T042): the fixes, the comparisons, the layout, the graph-only command line, a dry run against the published archive, and validation in its CI.
5. **The SBML switch on the website**, once spec 010's service serves it and the comparisons have passed (T044).
6. **BioPAX in `BioPAX3Exporter`** (T045–T051): the content, the comparisons against `biopax.zip` and the legacy service, validation, and its CI.
7. **The BioPAX switch on the website** (T052–T054): the endpoint, the legacy redirect and the site's links.
8. **The release's switches**, each after a full dry run (T055, T057). Level 2 is dropped (T056, decided).
9. **Throughout:** each exporter is split into a library and a command line, and the library is published (T061), so the release and the website run one codebase.

## Complexity Tracking

None in this repository. The Java service is spec 010's, decided there.
