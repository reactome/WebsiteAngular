# Implementation Plan: SBML and BioPAX built from the graph

**Branch**: `spec/015-graph-exports` | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/015-graph-exports/spec.md`

## Summary

The node content service writes the SBML export (at its two existing URLs) and a BioPAX Level 3 export from the graph database, retiring the two exports that still read the relational release database.

- **SBML's model** is byte-identical to sbml-exporter's graph-only converter with its four measured defects corrected (research R1). It is written directly in the final form JSBML's tidy writer gives (R2).
- **SBML's layout** is ported from the relational converter's algorithm, over the diagram JSON the site draws, for the events that have one today. It is exact in structure. Its coordinates are the diagram's own (R3).
- **BioPAX** reproduces today's converter's classes and values, in a deterministic order, and is compared with today's file by meaning (R4).
- **Validators** for both formats run in a new CI job (R5).
- **Meanwhile,** the site's broken BioPAX link points at reactome.org (R7).

## Technical Context

**Language/Version**: TypeScript, run by Node 24's type stripping (no build), as the rest of `tools/content-node`.

**Primary Dependencies**:

- In the service: none new. The XML is written by hand, as the service writes JSON.
- In CI only: python-libsbml 5.21.2 and the BioPAX validator 6.0.0 on JDK 17.
- For generating references once: a small Java harness over sbml-exporter 2.2.7 and graph-core.

**Storage**:

- The graph database, read as the service already reads it.
- The diagram JSON of the same release (`diagram/{stId}.json`), from the release's download location or a mounted folder.
- Answers cached per release (spec 011's labels).

**Testing**:

- vitest specs over recorded graph rows and diagram fixtures, with personal values replaced;
- the comparison tools ([contracts/checks.md](contracts/checks.md));
- `routes.spec.ts`;
- the parity harness for SBML's status, headers and errors;
- before-and-after on beta.

**Target Platform**: the content-node container (Linux). nginx in front, as today.

**Project Type**: web service (two endpoint groups and a redirect added to an existing service).

**Performance Goals**: an answer asked for before, in the same release, as fast as today's cached one (0.1 s for 23.5 MB). A first export of the largest sampled top-level pathway within the deep-query limits (SC-006).

**Constraints**:

- byte parity for SBML's model;
- the 30 s per-query read timeout;
- the deep shares (SBML's own share of 2, as Java ran one at a time);
- no module over 1,500 lines (spec 014);
- the ratchets (no lint rise, no loose values or implicit `any`);
- no personal data in fixtures or logs;
- light load on the shared graph.

**Scale/Scope**:

- about 3,200 lines of Java (SBML) and 1,900 (BioPAX) of mapping logic, ported;
- two to three endpoints, one redirect, one CI job;
- a sample of 30 events.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **I. Verify the instrument.**
  - The SBML reference was checked against today's output before being chosen. That is how its four defects were found.
  - The BioPAX comparison is by canonical triples because byte comparison is invalid even Java against Java (R4).
  - The validators were run on today's files to learn their baseline (R5).
  - **Pass.**
- **II. Measure in the thing.**
  - Every claim in research.md comes from the code or a live answer. Today's SBML layout was compared glyph by glyph with the diagram JSON, and the timings are measured.
  - Unmeasured, and so named as risks: disease diagrams, Neo4j row order across plans.
  - **Pass.**
- **III. Prove a test fails first.** Each comparison tool and each validator step is shown failing on a deliberately wrong file ([contracts/checks.md](contracts/checks.md)). **Pass.**
- **IV. No unstable identifiers for the reader.** Downloads are named by stable id. The legacy dbId URL redirects to the new URL. **Pass.**
- **V. Comments carry the failure.** Every recorded difference states why ([contracts/differences.md](contracts/differences.md)). **Pass.**

**Re-check after design: pass.** No violation to justify.

## Project Structure

### Documentation (this feature)

```text
specs/015-graph-exports/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── endpoints.md
│   ├── checks.md
│   └── differences.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
tools/content-node/
├── exporters-endpoints.ts   # + SBML (two URLs), BioPAX, the legacy BioPAX redirect
├── xml-writer.ts            # escaping and the tidy writer's form (R2)
├── sbml-model.ts            # the two queries, species, reactions, annotations (R1)
├── sbml-layout.ts           # the diagram JSON to the layout (R3)
├── diagram-files.ts         # reads diagram/{stId}.json of the release
├── biopax-model.ts          # graph to BioPAX individuals (R4, data-model.md)
├── biopax-rdf.ts            # the RDF/XML writer
├── parameters.ts            # RECORD entries (cache labels)
├── settings.ts              # where the diagram files are
├── sbml-compare.ts          # the SBML comparison tool (contracts/checks.md)
├── biopax-compare.ts        # the BioPAX canonical comparison
└── fixtures/                # recorded rows and diagrams, personal values replaced
deploy/nginx/common/routes.conf, routes-core.conf, deploy/nginx/local.conf, proxy.conf.js
deploy/nginx/routes.spec.ts
.github/workflows/tests.yml  # the exports job
projects/pathway-browser/src/environments/environment.ts            # RESTFUL_API (interim)
projects/pathway-browser/src/app/details/tabs/download-tab/         # the BioPAX link
projects/website-angular/src/app/content/detail/detail-download-bar/ # the BioPAX link
```

**Structure Decision**: The endpoints join the exporters family. The new modules are leaves: they import only the graph, settings and domain modules, never a family. So `boundaries.spec.ts` holds without a change. Each stays under 1,500 lines, and a port that grows is split further.

## Order of work

1. **US3, the interim link:**
   - `RESTFUL_API` points at reactome.org.
   - It needs a beta site rebuild, with the user's approval.
2. **The instruments:**
   - the SBML reference harness and the 30-event sample's references, from a private graph of the same release where possible;
   - the SBML and BioPAX comparison tools, each shown failing;
   - the libSBML and BioPAX validator baselines on today's files.
3. **SBML model:**
   - the XML writer and the model;
   - byte-identical to the references over the sample, timestamp aside;
   - the endpoints implemented and listed as not yet routed.
4. **SBML layout:**
   - the diagram reader and the layout;
   - compared with today's over the sample;
   - differences recorded.
5. **SBML switch:**
   - routes in nginx and the dev proxy, the cache labels, the parity harness entry;
   - before and after on beta.
6. **BioPAX:**
   - the model and the writer;
   - compared with today's samples, differences recorded;
   - the endpoint, the redirect and the routes;
   - the site's two links, and `RESTFUL_API` deleted.
7. **The `exports` CI job.** It is added when the first export has fixtures, and grows with each.

## Complexity Tracking

None.
