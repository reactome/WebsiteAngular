# Tasks: ContentService answered by node

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md)

**Written after the fact on 2026-10-17.** The ticked tasks were done before this file existed and carry the pull request that did each. They come from the merged PRs and from a comparison of Java's 98 published operations with the operations node answers on that date. From now on, **the PR that completes a task ticks it here**, with its number.

Each port follows the eight steps in [plan.md](plan.md#how-one-endpoint-is-ported). "Operation" means one published method and path. Paths are relative to `/ContentService`.

## Format: `- [x] T### Operation(s) — PR`

---

## Phase 1: Foundations (done)

- [x] T001 The node service's first routed endpoints, with its graph access and the parity harness — #267
- [x] T002 Java's CORS headers on node's answers — #359
- [x] T003 One copy of the node routes for every environment; a node route is never answered by Java — #390
- [x] T004 Java's path rules: matrix parameters (since refused, T008), `//`, encoded slashes and backslashes, ids past `long` — #474
- [x] T005 Percent-encoded literal segments routed as Java routes them; Spring's JSON 404 for an unmatched path — #490
- [x] T006 Every node route takes a trailing slash, as Spring's do; nginx and the dev proxy tested to agree — #498
- [x] T007 `nginx -t` on every deployment's image in CI — #499
- [x] T008 A matrix parameter (`/data/diseases;jsessionid=x`) on any segment is Spring's 404, not Java's answer: nothing sends one on purpose, and each form of a path is one more URL to cache (decided 18 Oct 2026; tools/content-node/CACHING.md). Taking them on every literal segment (#525) was reverted

## Phase 2: Content and species (done)

- [x] T010 `GET /data/content/toc`, `GET /data/content/doi` — #267
- [x] T011 `GET /data/content/contributors` — #270
- [x] T012 `GET /data/species/main`, `GET /data/species/all` — #289
- [x] T013 `GET /data/database/version`, `GET /data/database/name`, `GET /data/pathways/top/{species}` — ported in the spike, routed in #468; parity gaps closed in #467

## Phase 3: Graph queries (done)

- [x] T020 `GET /data/query/{id}/stId` — #445
- [x] T021 `GET /data/event/{id}/ancestors` — #447
- [x] T022 `GET /data/pathways/low/entity/{id}` — #451
- [x] T023 `GET /data/participants/{id}/referenceEntities` — #454
- [x] T024 `GET /data/participants/{id}` — #461
- [x] T025 `GET /data/entity/{id}/otherForms` — #462
- [x] T026 `GET /data/detail/{id}/locationsInPWB` (not in the published description; called by the site) — #464
- [x] T027 `GET /data/schema/{className}/count`, `GET /data/schema/{className}/min` — #465
- [x] T028 `GET /data/schema/model`, `GET /data/schema/{className}/attributes`, `GET /data/schema/{className}/referrals` — #466
- [x] T029 `GET /data/query/{id}/normalPathway` — #469
- [x] T030 `GET /data/query/{id}` and the domain serialiser every later port reuses — #470
- [x] T031 `GET /data/person/{id}`, `GET /data/person/{id}/publications` — #471
- [x] T032 `GET /data/person/{id}/authoredPathways`, `/authoredReactions`, `/reviewedPathways`, `/reviewedReactions` — #277
- [x] T033 `GET /data/entity/{id}/in-depth`, `GET /data/event/{id}/in-depth` — #472
- [x] T034 `GET /data/query/enhanced/{id}` — #475
- [x] T035 `GET /data/query/enhanced/v2/{id}` — #476
- [x] T036 `GET /data/orthology/{id}/species/{speciesId}`, `POST /data/orthologies/ids/species/{speciesId}` — #477
- [x] T037 `GET /data/instance/{id}/referrers` — #496

## Phase 4: Interactors from the static store (done)

- [x] T040 `GET /interactors/static/molecule/{acc}/details`, `GET /interactors/static/molecule/enhanced/{acc}/details`, `GET /interactors/static/molecule/{acc}/withEntities`, `POST /interactors/static/molecules/details` — #478
- [x] T041 `GET /interactors/psicquic/resources` — #500

## Phase 5: Search (done)

- [x] T050 `GET /search/suggest`, `GET /search/spellcheck` — #486
- [x] T051 `GET /search/facet`, `GET /search/icon/facet` — #487
- [x] T052 `GET /search/facet_query` — #488
- [x] T053 `GET /search/icon/query`, `GET /search/icon/{identifier}` — #489
- [x] T054 `GET /search/diagram/{diagram}`, `GET /search/diagram/{diagram}/occurrences/{instance}`, and `GET /search/diagram/summary` (Java serves it, though it is not in the published description) — #491
- [x] T055 `GET /search/diagram/{pathwayId}/flag`, `GET /search/fireworks/flag` — #492
- [x] T056 `GET /search/pathways/of/{dbId}` — #493
- [x] T057 `GET /search/fireworks` — #494
- [x] T058 `GET /search/query`, `GET /search/query/paginated` — #495

## Phase 6: Citations (done)

- [x] T060 `GET /citation/pathway/{id}`, `GET /citation/static/{id}`, `GET /citation/export` (not in the published description; called by the Pathway Browser) — #497

---

## Phase 7: Remaining graph and index operations → node

- [x] T070 `GET /data/query/{id}/{attributeName}` for the attributes not yet ported (only `stId` and `normalPathway` are) — #523
- [x] T071 `POST /data/query/ids`, `POST /data/query/ids/map` — #509
- [x] T072 `GET /data/person/{id}/{attributeName}` — #523
- [ ] T073 `GET /data/people/name/{name}`, `GET /data/people/name/{name}/exact`
- [x] T074 `GET /data/schema/{className}` — #511
- [x] T074b `GET /data/schema/{className}/reference` — #512
- [x] T075 `GET /data/complex/{id}/subunits`, `GET /data/complexes/{resource}/{identifier}` — #514
- [x] T076 `GET /data/entity/{id}/componentOf` — #515
- [x] T077 `GET /data/participants/{id}/participatingPhysicalEntities` — #517
- [x] T078 `GET /data/pathway/{id}/containedEvents`, `GET /data/pathway/{id}/containedEvents/{attributeName}` — Java maps the whole hasEvent subgraph into Events (Neo4jTemplate.findAll over `RETURN e, COLLECT(r), COLLECT(p)`), and `{attributeName}` reads a getter by reflection: do with T070/T072's getter table — #524
- [x] T079 `GET /data/pathways/low/entity/{id}/allForms`, `GET /data/pathways/low/diagram/entity/{id}`, `GET /data/pathways/low/diagram/entity/{id}/allForms` — #513
- [x] T080 `GET /data/mapping/{resource}/{identifier}/pathways`, `GET /data/mapping/{resource}/{identifier}/reactions` — #516
- [x] T081 `GET /data/diseases`, `GET /data/diseases/doid` — #510
- [x] T082 `GET /data/discover/{identifier}` — #519
- [x] T083 `GET /references/mapping/{identifier}`, `GET /references/mapping/{identifier}/xrefs`, `POST /references/mapping/xrefs` — #520
- [x] T084 `GET /interactors/static/molecule/{acc}/pathways`, `GET /interactors/static/molecule/{acc}/summary`, `POST /interactors/static/molecules/summary` — #522
- [ ] T085 `POST /contact` — its human check then runs where the site's secrets are (research D2)

## Phase 8: Exporters → node fronts, render service draws (issue #273)

- [ ] T090 `GET /exporter/diagram/{identifier}.{ext}`, for the formats the render page draws — implemented in #479, not yet routed: Java still answers it until the log scan (#273)
- [ ] T091 `GET /exporter/diagram/{identifier}.{ext}`, the remaining formats and options (#273, after the log scan)
- [ ] T092 `GET /exporter/reaction/{identifier}.{ext}`, `GET /exporter/reaction/{identifier}/diagram`
- [ ] T093 `GET /exporter/fireworks/{species}.{ext}`: the species overview image at its old URL, drawn as the overview is now, the Reacfoam (Voronoi) map, not the retired Fireworks layout

## Phase 9: Homed in Java — not ported ([spec 010](../010-java-services/spec.md))

These stay in Java because their substance is a Java library or Java numerical work. They move with the Java side, not here.

- [ ] T100 `GET /exporter/event/{identifier}.sbml`, `GET /exporter/event/{identifier}.sbgn`, `GET /exporter/document/event/{identifier}.pdf`
- [ ] T101 `GET /interactors/psicquic/molecule/{resource}/{acc}/details` and `/summary`, `POST /interactors/psicquic/molecules/{resource}/details` and `/summary`
- [ ] T102 `POST /interactors/upload/tuple/content`, `/tuple/form`, `/tuple/url`, `POST /interactors/upload/psicquic/url`, `POST /interactors/token/{token}`
- [ ] T103 `GET /data/eventsHierarchy/{species}` — needs the analysis data's pathway sizes

## Phase 10: Last

- [ ] T110 The ORCID endpoints (not in the published description) — ported last, decided 15 Oct 2026

## Notes

- The published description lists 98 operations. Node answers 52 of them in full (Phases 2–6). It answered one more in part: `/data/query/{id}/{attributeName}` for `stId` and `normalPathway` (T020, T029); T070 completes it. Operations outside the description are T026 and T060, which the site calls, and the summary in T054. Everything else is in Phases 7–9.
- An operation in Phase 7 that turns out to be library-bound moves to Phase 9, by the rule in spec 010.
