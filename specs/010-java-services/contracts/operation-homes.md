# Contract: where every published operation is answered

The decision record of FR-001 and FR-002. It covers every operation in the two services' published API descriptions, as served on 2026-10-17: 98 for ContentService and 39 for AnalysisService. Paths are relative to each service's root.

**The rule (FR-002).** An operation whose substance is a Java library, or Java numerical work, stays in Java. One that reads the graph, the search index, or logic Reactome writes for the website moves to node. When the rule does not settle a case, the team decides and the decision is added here.

**Homes:**

- **node:** `tools/content-node`.
  - **ported:** node answers it today.
  - **to port:** its task is in [spec 006](../../006-content-service-to-node/tasks.md).
  - **exporter (#273):** node owns it and the render service draws. Of these, `/exporter/diagram` is implemented (#479) but not yet routed.
- **java-library:** the Java library service of this spec.
- **analysis:** AnalysisService, run unchanged.

## ContentService

| Method | Path                                                      | Home                   | Reason                                                                                        |
| ------ | --------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| POST   | `/contact`                                                | node — to port         | site logic; its human check belongs with the site                                             |
| GET    | `/data/complex/{id}/subunits`                             | node — ported          | graph or search index                                                                         |
| GET    | `/data/complexes/{resource}/{identifier}`                 | node — ported          | graph or search index                                                                         |
| GET    | `/data/content/contributors`                              | node — ported          | graph or search index                                                                         |
| GET    | `/data/content/doi`                                       | node — ported          | graph or search index                                                                         |
| GET    | `/data/content/toc`                                       | node — ported          | graph or search index                                                                         |
| GET    | `/data/database/name`                                     | node — ported          | graph or search index                                                                         |
| GET    | `/data/database/version`                                  | node — ported          | graph or search index                                                                         |
| GET    | `/data/discover/{identifier}`                             | node — to port         | graph or search index                                                                         |
| GET    | `/data/diseases`                                          | node — to port         | graph or search index                                                                         |
| GET    | `/data/diseases/doid`                                     | node — to port         | graph or search index                                                                         |
| GET    | `/data/entity/{id}/componentOf`                           | node — ported          | graph or search index                                                                         |
| GET    | `/data/entity/{id}/in-depth`                              | node — ported          | graph or search index                                                                         |
| GET    | `/data/entity/{id}/otherForms`                            | node — ported          | graph or search index                                                                         |
| GET    | `/data/event/{id}/ancestors`                              | node — ported          | graph or search index                                                                         |
| GET    | `/data/event/{id}/in-depth`                               | node — ported          | graph or search index                                                                         |
| GET    | `/data/eventsHierarchy/{species}`                         | java-library           | pathway sizes from analysis-core data; a graph count disagrees on 776 of 2,883 human pathways |
| GET    | `/data/instance/{id}/referrers`                           | node — ported          | graph or search index                                                                         |
| GET    | `/data/mapping/{resource}/{identifier}/pathways`          | node — to port         | graph or search index                                                                         |
| GET    | `/data/mapping/{resource}/{identifier}/reactions`         | node — to port         | graph or search index                                                                         |
| POST   | `/data/orthologies/ids/species/{speciesId}`               | node — ported          | graph or search index                                                                         |
| GET    | `/data/orthology/{id}/species/{speciesId}`                | node — ported          | graph or search index                                                                         |
| GET    | `/data/participants/{id}`                                 | node — ported          | graph or search index                                                                         |
| GET    | `/data/participants/{id}/participatingPhysicalEntities`   | node — ported          | graph or search index                                                                         |
| GET    | `/data/participants/{id}/referenceEntities`               | node — ported          | graph or search index                                                                         |
| GET    | `/data/pathway/{id}/containedEvents`                      | node — to port         | graph or search index                                                                         |
| GET    | `/data/pathway/{id}/containedEvents/{attributeName}`      | node — to port         | graph or search index                                                                         |
| GET    | `/data/pathways/low/diagram/entity/{id}`                  | node — ported          | graph or search index                                                                         |
| GET    | `/data/pathways/low/diagram/entity/{id}/allForms`         | node — ported          | graph or search index                                                                         |
| GET    | `/data/pathways/low/entity/{id}`                          | node — ported          | graph or search index                                                                         |
| GET    | `/data/pathways/low/entity/{id}/allForms`                 | node — ported          | graph or search index                                                                         |
| GET    | `/data/pathways/top/{species}`                            | node — ported          | graph or search index                                                                         |
| GET    | `/data/people/name/{name}`                                | node — to port         | graph or search index                                                                         |
| GET    | `/data/people/name/{name}/exact`                          | node — to port         | graph or search index                                                                         |
| GET    | `/data/person/{id}`                                       | node — ported          | graph or search index                                                                         |
| GET    | `/data/person/{id}/authoredPathways`                      | node — ported          | graph or search index                                                                         |
| GET    | `/data/person/{id}/authoredReactions`                     | node — ported          | graph or search index                                                                         |
| GET    | `/data/person/{id}/publications`                          | node — ported          | graph or search index                                                                         |
| GET    | `/data/person/{id}/reviewedPathways`                      | node — ported          | graph or search index                                                                         |
| GET    | `/data/person/{id}/reviewedReactions`                     | node — ported          | graph or search index                                                                         |
| GET    | `/data/person/{id}/{attributeName}`                       | node — to port         | graph or search index                                                                         |
| GET    | `/data/query/enhanced/v2/{id}`                            | node — ported          | graph or search index                                                                         |
| GET    | `/data/query/enhanced/{id}`                               | node — ported          | graph or search index                                                                         |
| POST   | `/data/query/ids`                                         | node — to port         | graph or search index                                                                         |
| POST   | `/data/query/ids/map`                                     | node — to port         | graph or search index                                                                         |
| GET    | `/data/query/{id}`                                        | node — ported          | graph or search index                                                                         |
| GET    | `/data/query/{id}/{attributeName}`                        | node — to port         | graph or search index                                                                         |
| GET    | `/data/schema/model`                                      | node — ported          | graph or search index                                                                         |
| GET    | `/data/schema/{className}`                                | node — to port         | graph or search index                                                                         |
| GET    | `/data/schema/{className}/attributes`                     | node — ported          | graph or search index                                                                         |
| GET    | `/data/schema/{className}/count`                          | node — ported          | graph or search index                                                                         |
| GET    | `/data/schema/{className}/min`                            | node — ported          | graph or search index                                                                         |
| GET    | `/data/schema/{className}/reference`                      | node — to port         | graph or search index                                                                         |
| GET    | `/data/schema/{className}/referrals`                      | node — ported          | graph or search index                                                                         |
| GET    | `/data/species/all`                                       | node — ported          | graph or search index                                                                         |
| GET    | `/data/species/main`                                      | node — ported          | graph or search index                                                                         |
| GET    | `/exporter/diagram/{identifier}.{ext}`                    | node — exporter (#273) | drawn by the render service; Java exporters not needed                                        |
| GET    | `/exporter/document/event/{identifier}.pdf`               | java-library           | event-pdf (iText, html2pdf)                                                                   |
| GET    | `/exporter/event/{identifier}.sbgn`                       | java-library           | libSBGN                                                                                       |
| GET    | `/exporter/event/{identifier}.sbml`                       | java-library           | JSBML                                                                                         |
| GET    | `/exporter/fireworks/{species}.{ext}`                     | node — exporter (#273) | drawn by the render service; Java exporters not needed                                        |
| GET    | `/exporter/reaction/{identifier}.{ext}`                   | node — exporter (#273) | drawn by the render service; Java exporters not needed                                        |
| GET    | `/exporter/reaction/{identifier}/diagram`                 | node — exporter (#273) | drawn by the render service; Java exporters not needed                                        |
| GET    | `/interactors/psicquic/molecule/{resource}/{acc}/details` | java-library           | IntAct clustering and scoring (micluster, miscore, psimitab)                                  |
| GET    | `/interactors/psicquic/molecule/{resource}/{acc}/summary` | java-library           | IntAct clustering and scoring (micluster, miscore, psimitab)                                  |
| POST   | `/interactors/psicquic/molecules/{resource}/details`      | java-library           | IntAct clustering and scoring (micluster, miscore, psimitab)                                  |
| POST   | `/interactors/psicquic/molecules/{resource}/summary`      | java-library           | IntAct clustering and scoring (micluster, miscore, psimitab)                                  |
| GET    | `/interactors/psicquic/resources`                         | node — ported          | graph or search index                                                                         |
| GET    | `/interactors/static/molecule/enhanced/{acc}/details`     | node — ported          | graph or search index                                                                         |
| GET    | `/interactors/static/molecule/{acc}/details`              | node — ported          | graph or search index                                                                         |
| GET    | `/interactors/static/molecule/{acc}/pathways`             | node — to port         | graph or search index                                                                         |
| GET    | `/interactors/static/molecule/{acc}/summary`              | node — to port         | graph or search index                                                                         |
| GET    | `/interactors/static/molecule/{acc}/withEntities`         | node — ported          | graph or search index                                                                         |
| POST   | `/interactors/static/molecules/details`                   | node — ported          | graph or search index                                                                         |
| POST   | `/interactors/static/molecules/summary`                   | node — to port         | graph or search index                                                                         |
| POST   | `/interactors/token/{token}`                              | java-library           | interactor-core tuple and PSI-MITAB parsers; the existing Kryo token store                    |
| POST   | `/interactors/upload/psicquic/url`                        | java-library           | IntAct clustering and scoring (micluster, miscore, psimitab)                                  |
| POST   | `/interactors/upload/tuple/content`                       | java-library           | interactor-core tuple and PSI-MITAB parsers; the existing Kryo token store                    |
| POST   | `/interactors/upload/tuple/form`                          | java-library           | interactor-core tuple and PSI-MITAB parsers; the existing Kryo token store                    |
| POST   | `/interactors/upload/tuple/url`                           | java-library           | interactor-core tuple and PSI-MITAB parsers; the existing Kryo token store                    |
| POST   | `/references/mapping/xrefs`                               | node — to port         | graph or search index                                                                         |
| GET    | `/references/mapping/{identifier}`                        | node — to port         | graph or search index                                                                         |
| GET    | `/references/mapping/{identifier}/xrefs`                  | node — to port         | graph or search index                                                                         |
| GET    | `/search/diagram/{diagram}`                               | node — ported          | graph or search index                                                                         |
| GET    | `/search/diagram/{diagram}/occurrences/{instance}`        | node — ported          | graph or search index                                                                         |
| GET    | `/search/diagram/{pathwayId}/flag`                        | node — ported          | graph or search index                                                                         |
| GET    | `/search/facet`                                           | node — ported          | graph or search index                                                                         |
| GET    | `/search/facet_query`                                     | node — ported          | graph or search index                                                                         |
| GET    | `/search/fireworks`                                       | node — ported          | graph or search index                                                                         |
| GET    | `/search/fireworks/flag`                                  | node — ported          | graph or search index                                                                         |
| GET    | `/search/icon/facet`                                      | node — ported          | graph or search index                                                                         |
| GET    | `/search/icon/query`                                      | node — ported          | graph or search index                                                                         |
| GET    | `/search/icon/{identifier}`                               | node — ported          | graph or search index                                                                         |
| GET    | `/search/pathways/of/{dbId}`                              | node — ported          | graph or search index                                                                         |
| GET    | `/search/query`                                           | node — ported          | graph or search index                                                                         |
| GET    | `/search/query/paginated`                                 | node — ported          | graph or search index                                                                         |
| GET    | `/search/spellcheck`                                      | node — ported          | graph or search index                                                                         |
| GET    | `/search/suggest`                                         | node — ported          | graph or search index                                                                         |

Partly ported: `GET /data/query/{id}/{attributeName}`. Node answers it for `stId` and `normalPathway`; the other attributes are still to port.

## AnalysisService

All 39 operations are homed in **analysis**: the enrichment statistics, the pathway data held in memory, the Kryo result tokens and the PDF report are Java and stay as they are.

| Method | Path                                                         |
| ------ | ------------------------------------------------------------ |
| GET    | `/database/name`                                             |
| GET    | `/database/version`                                          |
| GET    | `/download/{token}/entities/found/{resource}/{filename}.csv` |
| GET    | `/download/{token}/entities/notfound/{filename}.csv`         |
| GET    | `/download/{token}/pathways/{resource}/{filename}.csv`       |
| GET    | `/download/{token}/result.json`                              |
| GET    | `/download/{token}/result.json.gz`                           |
| GET    | `/identifier/{id}`                                           |
| GET    | `/identifier/{id}/projection`                                |
| POST   | `/identifiers/`                                              |
| POST   | `/identifiers/form`                                          |
| POST   | `/identifiers/form/projection`                               |
| POST   | `/identifiers/projection`                                    |
| POST   | `/identifiers/url`                                           |
| POST   | `/identifiers/url/projection`                                |
| POST   | `/import/`                                                   |
| POST   | `/import/form`                                               |
| POST   | `/import/url`                                                |
| POST   | `/mapping/`                                                  |
| POST   | `/mapping/form`                                              |
| POST   | `/mapping/form/projection`                                   |
| POST   | `/mapping/projection`                                        |
| POST   | `/mapping/url`                                               |
| POST   | `/mapping/url/projection`                                    |
| GET    | `/report/{token}/{species}/{filename}.pdf`                   |
| GET    | `/species/homoSapiens/{species}`                             |
| GET    | `/token/{token}`                                             |
| POST   | `/token/{token}/filter/pathways`                             |
| GET    | `/token/{token}/filter/species/{species}`                    |
| POST   | `/token/{token}/found/all`                                   |
| GET    | `/token/{token}/found/all/{pathway}`                         |
| GET    | `/token/{token}/found/entities/{pathway}`                    |
| GET    | `/token/{token}/found/interactors/{pathway}`                 |
| GET    | `/token/{token}/notFound`                                    |
| GET    | `/token/{token}/page/{pathway}`                              |
| GET    | `/token/{token}/pathways/binned`                             |
| POST   | `/token/{token}/reactions/pathways`                          |
| GET    | `/token/{token}/reactions/{pathway}`                         |
| GET    | `/token/{token}/resources`                                   |
