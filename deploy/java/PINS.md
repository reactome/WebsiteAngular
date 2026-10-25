# Pinned Java sources

The Reactome Java this deployment builds (spec 010), each pinned to the commit that reproduces what is deployed today. Images build these from source, never from a published snapshot. Snapshot artifacts are republished under the same version: the shared parent POM already was once, on 9 Mar 2026, with newer Batik and FOP.

**Verified:** each commit was rebuilt (Maven 3.8.7, tests skipped) and its classes compared with the deployed ones byte for byte. Where bytes differed, `javap -c -p` output was compared with constant-pool indices removed. Details: [research R1](../../specs/010-java-services/research.md#r1-which-commits-reproduce-what-is-deployed).

| Artifact                                     | Repository                    | Commit                                                       | Match                                                                                                                                                                                                                                                              | Build JDK        |
| -------------------------------------------- | ----------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| content-service 2.1.11                       | `reactome/content-service`    | `7b9eceb` (branch `add-content-page-endpoints`, unmerged)    | 102/102 classes identical; 324 bundled jars identical                                                                                                                                                                                                              | 11               |
| analysis-service 3.1.8                       | `reactome/analysis-service`   | `9b147e1` (branch `feature/batik-upgrade`, PR #25, unmerged) | 28/28 classes identical                                                                                                                                                                                                                                            | 11               |
| analysis-core 3.6.0-SNAPSHOT                 | `reactome/analysis-core`      | `74e3ffe`                                                    | equal to the published snapshot; a rebuild differs only in string-concatenation bytecode                                                                                                                                                                           | 11               |
| analysis-report 1.4.0-SNAPSHOT               | `reactome/analysis-report`    | `67062e7`                                                    | classes identical                                                                                                                                                                                                                                                  | 11               |
| interactor-core 1.1.5                        | `reactome/interactors-core`   | `7513f42` ("Release 1.1.5")                                  | 74/77 identical; 3 differ only in string concatenation                                                                                                                                                                                                             | 11               |
| event-pdf 1.2.1-SNAPSHOT                     | `reactome/event-pdf`          | `2c070d5`                                                    | 91/91 identical                                                                                                                                                                                                                                                    | 17, targeting 11 |
| diagram-exporter 2.0.12                      | `reactome/diagram-exporter`   | `702ba70`                                                    | 203/205 identical; 2 differ only in string concatenation                                                                                                                                                                                                           | 11               |
| fireworks-exporter 1.2.8                     | `reactome/fireworks-exporter` | `e660857`                                                    | 99/99 identical                                                                                                                                                                                                                                                    | 11               |
| reactome-parent 1.0.5-SNAPSHOT (and its BOM) | `reactome/reactome-parent`    | `d93ad5a` (branch `feature/new-pwb`)                         | the BOM equal to the published snapshot; the parent differs only in Batik and FOP's versions (published 1.18 and 2.10, here 1.16 and 2.8), which nothing built on it here uses: the published snapshot matches no pushed commit                                    | 17               |
| graph-core 3.0.0-SNAPSHOT                    | `reactome/graph-core`         | `62aef35`                                                    | the deployed ContentService's jar is the published snapshot of 25 Sep 2025, byte for byte; rebuilt here, 172/377 classes identical, 203 identical by `javap`, 2 differ only in order (a method's place; which of three identical handlers each exception jumps to) | 17               |
| sbml-exporter-lib 3.0.0-SNAPSHOT             | `reactome/sbml-exporter`      | `f7b1034` (branch `graph-only`)                              | not Java's relational answer, so no byte comparison: proven by `ci/compare.py` against today's files (spec 015 T037, T039)                                                                                                                                         | 17               |

## Frozen on purpose

- **interactor-core 1.1.5 and Kryo 5.3.0, with content-service's `TupleManager`:**
  - **Why:** overlay tokens are stored as Kryo files that name their classes. A change to any of the three stops existing tokens reading.
  - **To change them:** a migration of the store, decided on its own.
- **Aspose.Slides, excluded:**
  - **What uses it:** only diagram-exporter's PPTX path, which no Java-homed operation uses, and it runs unlicensed today (research R8).
  - **To use it again:** a licence, and an operation that needs it.

## The library service (spec 015 T063)

`deploy/java-library/Dockerfile` builds the last three rows from these commits, and checks that its jar carries the libraries it built, byte for byte. `deploy/java-library/pins.spec.ts` checks that the Dockerfile's commits are this table's. Changing `sbml-exporter-lib`'s pin means rerunning spec 015 T067's comparison, not `tools/java-parity`: its body is not Java's.

## Changing a pin

1. **Update** the commit here and in the image.
2. **Run parity** against the running service (`tools/java-parity`).
3. **Review the differences:** any difference is either a stated upstream correction, accepted in the PR, or the pin is not changed.
