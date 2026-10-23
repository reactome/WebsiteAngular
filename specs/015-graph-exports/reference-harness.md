# The SBML reference harness (T003)

How spec 015's SBML references are made: sbml-exporter's graph-only converter, with four defects fixed, run against a private copy of the release's graph. The harness and its output stay outside the repository; the output holds people's names (SBML creators). Host-specific paths below are placeholders.

## What runs

- **The jars** are the Java ContentService's own (`$CONTENT_SERVICE_LIB`, its `WEB-INF/lib`): sbml-exporter 2.2.7, graph-core 3.0.0-SNAPSHOT, JSBML 1.5, JTidy r938, the Neo4j driver. They are the versions the host runs today, and nothing is downloaded.
- **Leave out** the jars of other Reactome libraries. sbml-exporter's configuration scans every `org.reactome.server` package, and their components fail to start outside ContentService: analysis-core, diagram-exporter, diagram-reader, event-pdf, fireworks-exporter, interactor-core, reaction-exporter and search-core.
- **Three classes are compiled ahead of the jars**, from sbml-exporter's `main` (whose pom is 2.2.7):
  - `GraphNeo4jConfig`, which the deployed jar leaves out. It enables graph-core's lazy-fetch aspect, without which the converter's getters return nothing.
  - `DataFactory` and `ReactionBaseResult`, with the fixes below.
- **Harness.java** initialises graph-core with `(bolt-uri, user, password, database, GraphNeo4jConfig.class)` and turns on `Helper.setUseIdentifierURL(true)`, as it is inside ContentService. For each id it runs `findById`, then `new SbmlConverter(event, version, ads).convert()`, and writes `toString()` as UTF-8 to `{stId}.sbml`.
- **The runtime** is JDK 11, with `-Duser.timezone=UTC -Duser.language=en -Duser.country=US -Dfile.encoding=UTF-8`. The classes are compiled with JDK 17's `javac --release 11`.

## The four fixes (research R1)

In `org/reactome/server/tools/sbml/data/DataFactory.java`:

```diff
-                reactionBase.setCatalysts(getParticipantResults(ds, reactionBaseResult.getPositiveRegulators()));
-                reactionBase.setNegativeRegulators(getParticipantResults(ds, reactionBaseResult.getPositiveRegulators()));
+                reactionBase.setCatalysts(getParticipantResults(ds, reactionBaseResult.getCatalysts()));
+                reactionBase.setPositiveRegulators(getParticipantResults(ds, reactionBaseResult.getPositiveRegulators()));
+                reactionBase.setNegativeRegulators(getParticipantResults(ds, reactionBaseResult.getNegativeRegulators()));
 ...
-        Participant participant = new Participant();
         for (ParticipantResult participantResult : participantsQueryResults) {
+            Participant participant = new Participant();
```

In `org/reactome/server/tools/sbml/data/result/ReactionBaseResult.java` (`build`):

```diff
+        if (!r.get("catalysts").isNull()) reactionBaseResult.setCatalysts(r.get("catalysts").asList(ParticipantResult::build));
```

**Checked on R-HSA-69604.** The reference has two reactants, two products and one catalyst, as today's file has. Unfixed, the converter keeps one of each and writes the positive regulators as its catalysts.

## The private graph (research R8, T002)

Copy beta's release volume read-only into a new volume, then start the same local image on another loopback port. Leave out the compose wrapper, so authentication stays off as the image is built; leave beta's credentials out too; and use smaller memory settings:

```sh
docker volume create graphdb-ref97
docker run --rm --entrypoint sh \
  -v <beta's release volume>:/from:ro -v graphdb-ref97:/to <release image> -c 'cp -a /from/. /to/'
docker run -d --name graphdb-ref97 -p 127.0.0.1:7697:7687 -v graphdb-ref97:/var/lib/neo4j/data \
  -e NEO4J_dbms_default__database=graph.db \
  -e NEO4J_dbms_memory_heap_max__size=1g -e NEO4J_dbms_memory_pagecache_size=1500m \
  <release image> neo4j
```

On 23 Oct 2026 the copy started cleanly, with no recovery, and reported release 97 and 119,384 events. Beta's graph was neither stopped nor restarted. Once the references were made, the copy was stopped and its volume removed.

## Run

```sh
java -Duser.timezone=UTC -Duser.language=en -Duser.country=US -Dfile.encoding=UTF-8 -Xmx4g \
  -cp "classes:<the jars above>" Harness bolt://127.0.0.1:7697 graph.db <outdir> <ids...>
```

## The sample's references (23 Oct 2026)

All 30 events of [sample.md](sample.md) were made in one run against the private copy, 67 MB in all. Times are as measured, cold:

- **Signal Transduction (R-HSA-162582):** 22.7 M characters, 193 s.
- **Disease:** 18.6 M characters, 134 s.
- **Cytokine Signaling in Immune system:** 6.8 M characters, 44 s.
- **Cell Cycle:** 4.5 M characters, 38 s.
- **Pathways with diagrams:** 0.1–1.3 M characters, 1–9 s each.
- **Every reaction and other event:** 10,000–29,000 characters, under 0.2 s.
