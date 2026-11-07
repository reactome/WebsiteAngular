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
- [x] T008 A matrix parameter (`/data/diseases;jsessionid=x`) on any segment is Spring's 404, not Java's answer: nothing sends one on purpose, and each form of a path is one more URL to cache (decided 18 Oct 2026; tools/content-node/CACHING.md). Taking them on every literal segment (#525) was reverted — #526

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
- [x] T073 `GET /data/people/name/{name}`, `GET /data/people/name/{name}/exact`. Despite their descriptions, each part of the name matches a whole first name or surname. Compared with Java over real names by `tools/content-node/people-name-check.ts`, which prints counts only, since names are personal data. — #811
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
- [x] T085 `POST /contact` — its human check then runs where the site's secrets are (research D2). Ported in #836 (replacing #835), routed to node: Java's parameters and answers, with declared differences (research D23): Cloudflare Turnstile's check in place of hCaptcha; and, by awright's decision, one message from the support address with the reader as Reply-To and no copy to the reader. Sent through Amazon SES's API with the instance's role, not SMTP, in #838 (research D23). Limits from the review of #836 and #838 -- a 64KB body, one linear parse, field caps, stricter addresses and headers, no SES retry -- in #844, replacing #842 (research D23). Done when the role may send from the support address, the support address and Turnstile settings are set, and a test message, sent with awright's go-ahead, reaches the help desk. Done on beta, 6 Nov 2026 (#840): the instance role may send from the support address only, the settings are set, a test message sent with awright's go-ahead reached the help desk, and a made-up Turnstile token is refused.

## Phase 8: Exporters → node fronts, render service draws (issue #273)

- [x] T090 `GET /exporter/diagram/{identifier}.{ext}`, for the formats the render page draws — implemented in #479, not yet routed: Java still answers it until the log scan (#273). Routed by the decision of 8 Nov 2026 (awright; research D24), with no log scan: node answers it, the render service draws it, Java's errors in Java's order — #891
- [x] T091 `GET /exporter/diagram/{identifier}.{ext}`, the remaining formats and options (#273, after the log scan). Done by the same decision: gif drawn (a still, or the expression animation); quality as the render service's scale, sel and token drawn; ehld, flg, flgInteractors, title, margin, the profiles, resource and expColumn accepted and not drawn, and a selection on an illustration left off rather than refused (research D24's table) — #891
- [x] T092 `GET /exporter/reaction/{identifier}.{ext}`, `GET /exporter/reaction/{identifier}/diagram`. The second is the reaction's layout, which the render page and the site's reaction figure draw from. It is ported to node: awright, 5 Nov 2026, port as much of ContentService as has no Java-only dependency, and the reaction-exporter library has none. Java's answer varies between identical requests (ids, order, and sometimes the layout), so it is compared in canonical form against the layouts Java gives, not byte for byte (research D21). Node's layout is deterministic: Java's variation is not copied. First, read the library's layout algorithm and find where the variation comes from: done (research D21, #813). The port lands in the five steps of research D22 (#819), each compared with Java on the parts it decides. Step 1, the inputs: #823, identical to Java on 363 reactions, glyph ids, each glyph's roles and the reaction's compartment included (300 at random, and every reaction without a compartment, failed, disease and drug ones). Step 2, the sizes: #824, identical on 383 reactions (heavily modified proteins, genes and cells added to the sample); the text measure agrees with the deployed jar's on every entity name of release 98. From the 5 Nov review: Java fills its maps with computeIfAbsent, whose order is not put's, and the comparison now checks the orders Java's hash sets give: #826. Step 3, placement and connectors: #831 (replacing #830), identical to Java on 408 reactions (300 at random and the sample's chosen kinds), none on a later attempt, the whole diagram in canonical form, positions within a billionth (the declared sin and cos difference, research D22), and the orders Java's hash sets give. Before the comparison's last changes, 39 more, which the porting run picked by laying out 1,507 reactions of three compartments or more with node alone (their ids were not kept), for rules the sample met seldom or never: boxes stretched to a sibling's size, the reaction moved into a child compartment, rows and columns split, a catalyst beside the reaction, a gene, a column of inputs in two; all matched, one on asking again (the roles' random order, D21). Step 4, the graph and the answer: #833 (replacing #832), identical to Java on 424 reactions (300 at random and the sample's chosen kinds, regulated reactions and ones with entity functional statuses added), 46 of them on a later attempt: the canonical diagram and graph, the ids, the orders (each node's connectors' added), the status and media type, and the raw text character for character but for the declared differences (research D22: the top keys' order, with node's own framing still compared; a graph event's two fields whose order the JVM's start sets; and numbers within a billionth of their size, or 1e-9 below 1, written as Java writes them). An answer whose orders alone differ, beyond its connectors' order, stops after four requests (REACTION_LAYOUT_STEADY) if Java draws the same; one whose connectors' order alone differs is asked up to REACTION_LAYOUT_ATTEMPTS times (default 24). Step 5, the routing: #834, `/exporter/reaction/{identifier}/diagram` answered by node (`reaction-layout-endpoints.ts`) and routed to it in nginx and the dev proxy, Java's errors included (not a reaction-like event 400, not found 404, an id of dots or a dbId past a long 500, the library's Java exceptions as Java's handler answers them), each byte for byte with Java's but for the `url` field's host; stored at the edge, one answer per reaction per release (research D22, step 5). Done when both operations are routed to node and spec 018 T011's fresh-repeatability test passes with no reaction exempted. T011's test passed with none exempted on 6 Nov 2026 (#846); the image operation remains. The image operation is routed as T090 and T091 decide for diagrams, so T092 is done after them. Decided 8 Nov 2026 (awright; research D24): ContentService's image URLs are node's, drawn by the render service, with no log scan first. The image operation is answered by node (`exporters-endpoints.ts`), Java's errors in Java's order byte for byte but for `url`, its Content-Type, each of Java's parameters drawn (quality, as the render service's scale) or accepted and not drawn (D24's table), the figure the render service's reaction view in the website's look; the render page now draws that view as JPEG and as a GIF frame; routed under the render budget, the reaction's `.pptx` left to Java — #890 (replacing #880)
- [x] T093 The species overview image (the Reacfoam Voronoi map; there are no Fireworks images any more). Decided 22 Oct 2026: answered at `GET /exporter/voronoi/{species}.{ext}`, a URL named for what it draws, and the old `GET /exporter/fireworks/{species}.{ext}` is a 301 to it with the species, extension and query kept. Both are routed to node, within the render budget, ahead of T090's log scan (#273): the voronoi URL is new, so no caller depends on Java there. The render page reports the species it drew, which beta's site build (rebuilt 22 Oct) needs for the overview to render. — #613

## Phase 9: Homed in Java for now ([spec 010](../010-java-services/spec.md))

These were held in Java because their substance is a Java library or Java numerical work. awright, 19 Oct 2026: the held exports could be made, and the events hierarchy has no reason to need Java; each is reconsidered after spec 013 (types in the services) is done.

- [x] T100 `GET /exporter/event/{identifier}.sbml`, `GET /exporter/event/{identifier}.sbgn`, `GET /exporter/document/event/{identifier}.pdf`. Not ported one by one: each is replaced by an exporter Reactome keeps for both the bulk file and the website. **SBML** is done that way by [spec 015](../015-graph-exports/tasks.md) (node answers it through `sbml-exporter`, T065, #666; release and production wait for its T068). **PDF** is answered by `pdf-export`'s single-event service (its spec 001, Story 2 and FR-014): done, #882. Node answers `/exporter/document/event/{id}.pdf` (`eventPdfAnswer`), its parameters converted as Spring converts them under Java's own names (`level [0 - 1]`, the analysis options), its 404 and 400, then the PDF from the service (`deploy/pdf-export`: pdf-export pinned to a commit of its `main` in `deploy/java/PINS.md`, `PDF_SERVICE`; unset, a 503), passed on as it arrives with Java's type and the stable id as its file name (`"{stId}.pdf"`, the extension inside the quotes where Java's is outside: declared, #884), two at a time; an analysis token the AnalysisService does not know is a 404 and one whose result has gone a 410, where Java answers an empty 200 (declared). Routed on beta alone (dev.conf), locally and under ng serve. Java's errors compared live on 7 Nov 2026, spaced: the 404s (an unknown id, a versioned one, an old `REACT_` one), the 400 for a non-event and the three conversion 400s are Java's but for `url`. The service run against beta's graph, render service and AnalysisService (the same commit and entrypoint, outside its image): a reaction 6.3 s, a pathway of 13 reactions 27.7 s, an illustrated pathway 23.2 s, the mouse pathway 30.7 s, the pathway with a token 37.6 s, each within SC-005's 8 s and 3 s per figure, every figure drawn by the render service (its counters rose by each PDF's figures); `event-pdf` took 0.7 s, 5.4 s, 19.1 s, 4.4 s and 6.4 s (declared: no figures' folder yet). **SBGN** follows SBML's pattern, one exporter for the download page's bulk file and the website (decided 5 Nov 2026): done, node answers it through `sbgn-exporter` (its spec 001 T018), from the release's diagram files (`DIAGRAM_FILES`) or node's own reaction layout, routed on beta alone, #862. Compared on 7 Nov 2026 with Java's answers on a local deployment of release 98, spaced, by sbgn-exporter's `ci/compare.ts` with the layouts, for 62 events: 31 pathways across the bulk file's sizes (its largest among them, 8 with drugs, one by dbId and one by versioned stable id), a subpathway drawn in its parent's diagram, and 30 reactions by dbId. Node's documents were sbgn-exporter's from the layouts the endpoint reads: the release's diagram files, and node's own reaction layouts as beta answers them. Java's type, download name and CORS header were the same on every answer. The 32 pathway answers differ only in declared kinds. 24 reactions differ in every layout id, by Java's reaction-layout counter (offsets 225458 to 225691); with it removed, only in declared kinds (all 56: 99 D1, 74 D2, 213 D3, 815 D5, 283 D6, nothing undeclared). The other 6 reactions are drawn with a compartment that has no database object (the nuclear envelope around the nucleoplasm, say), which the library first pinned refused: fixed in [sbgn-exporter#34](https://github.com/reactome/sbgn-exporter/pull/34), and the pin moved to its dist commit `2144a05f`; with it, the six compare with only declared differences against Java's own converter run on the same layouts (the reference harness, offline: 9 D1, 7 D5). Java's 400 and 404 bodies are node's but for `url`. Java's 500 for a missing diagram file was read from its code, not provoked: it needs a file missing from Java's folder, and Java mails its error report for it.
- [ ] T101 `GET /interactors/psicquic/molecule/{resource}/{acc}/details` and `/summary`, `POST /interactors/psicquic/molecules/{resource}/details` and `/summary`
- [ ] T102 `POST /interactors/upload/tuple/content`, `/tuple/form`, `/tuple/url`, `POST /interactors/upload/psicquic/url`, `POST /interactors/token/{token}`
- [ ] T103 `GET /data/eventsHierarchy/{species}` — portable. Java reads two things from analysis-core (EventsController): every node's `totalEntity`/`totalEntityAndInteractors`, from the in-memory pathway hierarchy the AnalysisService's data file holds, on every request; and, with a `token`, the stored analysis result it overlays. Node can read the result through the AnalysisService's own `token` API (behind the gateway). The research question is the sizes: computed from the graph as analysis-core counts them, byte for byte, or read from the AnalysisService.

## Phase 9b: Endpoints Java does not publish

Found 19 Oct 2026 by comparing every mapping in the Java source with the published description (which the phases above follow). The site calls none of them; outside users of the API may. Each still answered by Java.

- [x] T104 Graph reads: `GET /data/query/abridged/{id}`, `/data/query/abridged/{id}/{attributeName}`, `/data/query/{id}/more`. Node answers all three (data-query family), routed in nginx and the dev proxy. The abridged object is graph-core's findByIdNoRelations: the node alone, by the id as getIdentifier reads it, written as `/query/{id}` writes an object; its attribute is ControllerUtils.getProperty on it, a relationship getter loading the relationship, outgoing ones too, as LazyFetchAspect does. `/more` is `/query/enhanced/v2/{id}` with its flags fixed (incoming relationships, no summary, disease data only if nothing is found without), reading no parameter. Spring's order kept: `/query/abridged/more` and `/query/enhanced/more` are the object called more. Dots alone are Java's 500 on all three, and on `/enhanced/v2/{id}`, which answered a 404 before. Compared with Java on 7 Nov 2026, spaced: its abridged answers for 26 objects of 14 classes (no Person or InstanceEdit) written by node's writer from their own properties, identical in all three views; its errors (404s, the attribute's 404, the 500s for dots and a dbId past a long) the same but for `url`. Node was not run against the graph here (no credentials in this environment): its queries were run against a stand-in in `query-abridged.spec.ts`. — #897
- [ ] T105 `GET /data/referenceMolecules`, `/data/referenceMolecules/identifiers`, `/data/referenceSequences`, `/data/referenceSequences/identifiers`
- [ ] T106 `GET /data/pathways/top/{species}/curated`, `/data/pathways/low/diagram/identifier/{id}/allForms`, `/data/diagram/{id}/entities/{instance}`, `/data/database/info`
- [ ] T107 `GET /data/detail/{id}/direction/…` (four forms), `/data/detail/{id}/getSubGraph`, `/data/detail/{id}/getReverseGraph`
- [ ] T108 `GET /citation/download`, `POST /download/{format}`
- [x] T109 Exporters: `/exporter/diagram/{id}.pptx`, `/exporter/reaction/{id}.pptx`, `/exporter/sbml/{id}.xml` (with Phase 9's exporters). The last is answered by node through `sbml-exporter` since spec 015 T065 (#666), on beta. The PowerPoints: node answers both, drawn by the render service's PowerPoint export (the user, 8 Nov 2026; research D24), Java's errors (a diagram id that resolves to nothing is its generic 500; a reaction's 404 and 400), type and download name `[stId] name.pptx`, routed in nginx and the dev proxy — #893

## Phase 10: Last

- [ ] T110 The ORCID endpoints, `/ContentService/orcid/**` ("Claim your work", #114): about eleven (OAuth login, callback, token, sign-out, authenticated; five claims; `{orcid}/works`; `let-us-know-your-orcid`). Not in the deployed service at all: their source is `org.reactome.server.orcid` in reactome/data-content. They need ORCID OAuth credentials and the report application. Ported last (awright, 15 and 19 Oct 2026), after reviewing ORCID's requirements with awright.

## Notes

- The published description lists 98 operations. When this note was written, before Phase 7's ports, node answered 52 of them in full (Phases 2–6); the ticked tasks are the current count. It answered one more in part: `/data/query/{id}/{attributeName}` for `stId` and `normalPathway` (T020, T029); T070 completes it. Operations outside the description are T026 and T060, which the site calls, and the summary in T054. Everything else is in Phases 7–9.
- An operation in Phase 7 that turns out to be library-bound moves to Phase 9, by the rule in spec 010.
