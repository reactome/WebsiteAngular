# Research: SBML and BioPAX built from the graph

> **Rewritten direction, 24 Oct 2026.** The spec now makes `sbml-exporter` and `BioPAX3Exporter` the single implementation of each format, for the bulk files and the website ([spec.md](spec.md), "What changed"). R1, R3 and R8 stand as written. R5's validators and versions stand; its CI decision (exports built here from recorded rows) is superseded, because the exporters are Java libraries that need a graph: each validates in its own CI (FR-008, contracts/checks.md). R2 (JSBML's bytes, for a TypeScript writer) is no longer needed, since JSBML itself writes them. R4's mapping and comparison stand; its decision to write BioPAX in TypeScript is superseded by R9. R6's routes, headers and errors stand for the website, with the answer now coming from R10's service. R7 is done (#634). R9 and R10 are new.

Measured on 23 Oct 2026 (release 97). Sources: the code of `reactome/sbml-exporter` (main, v2.2.7), `reactome/content-service` (main), `reactome/graph-core` (main), JSBML 1.5 and JTidy r938, `reactome/restfulapi_mini` and `reactome/Pathway-Exchange` (BioPAX); live answers from the Java services on the beta host (ContentService, and the legacy RESTful service, which serves today's BioPAX from the relational database on the same host); a few samples from reactome.org's copy of that service, first, before the local one was found; the diagram JSON for R-HSA-69620.

Personal data: SBML's History (creators) and BioPAX's citations and curation comments carry people's names. They were compared by hash only, are never printed in this research, and no sample containing them is in the repository (R8).

## R1. What the graph-only SBML converter writes, and the reference

**Measured.**

- **Today's export is the relational converter** (`SbmlConverterForRel`), run by `SbxxExporterController` on `/exporter/event/{id}.sbml` and on a hidden `/exporter/sbml/{id}.xml`. `/data/discover` links the second form.
- The graph-only `SbmlConverter`'s call is commented out, and, as far as the code shows, **it has not run in production**.
- **It has four data defects** (sbml-exporter `DataFactory`, since July 2021). Each reaction keeps only the last row of each participant list, because one `Participant` is reused. Catalysts are filled from the positive regulators. Negative regulators are also filled from the positive regulators. Positive regulators are never set. Today's relational answer is correct on all four.
- `Helper.setUseIdentifierURL(true)` is static. Inside ContentService it is on once any relational conversion has run, and it rewrites URLs to identifiers.org forms (`url2identifier.txt`). A standalone graph-only run leaves it off.
- **What the graph-only converter writes, in document order:**
  - the declaration, then the root;
  - the provenance note: `SBML generated from Reactome version {N} on {M/d/yy, h:mm a} using JSBML version 1.5.`, in UTC and en_US;
  - `<model id="pathway_{dbId}" metaid="metaid_0" name>`, for the event or, for a reaction, its first parent by `hasEvent.order` (`no_parent_pathway` when it has none);
  - the model's notes, from its summations;
  - the model's annotation: History, then `bqbiol:is` and `isDescribedBy`;
  - `listOfCompartments`, `listOfSpecies` and `listOfReactions`.
  - **Species** come from PARTICIPANTS_QUERY's rows, and reactions from REACTIONS_QUERY's rows (neither query has `ORDER BY`). Each has fixed attributes, SBO terms from a fixed table, notes (an explanation fixed for the class, then summations) and CVTerms in a fixed order.
  - **metaids** interleave species with the compartments each species brings in first.
  - **Never written:** units, parameters, rules, rate laws, amounts.
- **Quirks to reproduce:**
  - History dates are parsed with `hh` (an hour of 12 becomes 00) and written in GMT.
  - `removeTags` rewrites notes: `<->`, control characters, `&`, `<>` and tags.
  - Reaction literature repeats the direct references through `summation|literatureReference*`, using the graph's `url` property.
- **Today's relational answer differs besides the layout:**
  - a reaction's model is `no_parent_pathway`;
  - species and reaction order is HashSet order, which cannot be reproduced;
  - complexes are walked differently, including `hasCandidate`, counting occurrences and using `identifier`;
  - EC numbers are sorted;
  - reaction literature leaves out the direct references;
  - URLs are built from `accessUrl`.

**Decision.**

- **The reference** for FR-002 was first the graph-only converter with the defects corrected and `setUseIdentifierURL(true)` (the harness, [reference-harness.md](reference-harness.md)). **Changed 24 Oct 2026:** it is today's relational file of the same release, compared element by element, since the files people use are today's and their order (HashSet order) cannot be reproduced. The harness stays as the record of how the defects were found.
- **It is run by a harness** of about 40 lines of Java (a throwaway module, depending on sbml-exporter and graph-core): `findById`, then `SbmlConverter(event, version, ads).convert().toString()`, written as UTF-8. It runs on JDK 11 with UTC, en_US and UTF-8.
- **The fixes are offered upstream**, and recorded as accepted deviations.

**Rationale.** Unpatched, the converter regresses the model against today's file (User Story 1). With the fixes, it is an exact, reproducible reference, unlike today's HashSet-ordered answer.

**Alternatives considered.**

- _The unpatched converter_: rejected, because it regresses.
- _Today's relational answer, by meaning only_: rejected, because it gives no exact reference.

## R2. JSBML's bytes

**Measured.**

- **ContentService serialises with `TidySBMLWriter`.** woodstox writes the document, then JTidy re-parses and pretty-prints it, so the final bytes are JTidy's.
- **Lines and indentation:**
  - every element is on its own line, with 2 spaces per depth;
  - an element with text is written inline;
  - an empty element is written `<x a="b" />`;
  - lines end in `\n`, including the last.
- **Attributes** are alphabetical by qualified name. On the root, the default namespace is first and `xmlns:layout` is last.
- **Text:**
  - any run of whitespace collapses to one space, and one leading and one trailing space are trimmed;
  - `<`, `>` and `&` are escaped; `"` and `'` are raw;
  - U+00A0 is written `&#160;`;
  - other non-ASCII is written raw as UTF-8.
- **In attributes**, `"` is written `&quot;`.
- **RDF:**
  - namespaces are declared only when used, in the order rdf, dc+vCard, dcterms, bqmodel, bqbiol;
  - content is in the order creators, created, modified, then each CVTerm as its own element, with repeated qualifiers kept separate;
  - numbers: `SBO:%07d`, and stoichiometry is written as an integer.

**Superseded (24 Oct).** No TypeScript writer is needed: the exporter's JSBML and its tidy writer produce these bytes themselves. Kept as the description of the bytes the comparison expects.

**Decision (23 Oct).** The node writer emits JTidy's final form directly, from an in-memory tree, following these rules. It does not use a generic XML library and normalise afterwards.

**Rationale.** The final form is the byte contract. Emulating woodstox and then JTidy would be more code for the same bytes.

## R3. The SBML layout from the diagram files

**Measured.** R-HSA-69620, R-HSA-69481 (a sub-pathway with no diagram of its own) and R-HSA-69562 (a reaction).

- **Today's layout comes only from the event's own diagram,** and only when it draws at least one reaction (`LayoutConverter.getDiagram`, `hasReactions`). A reaction or a sub-pathway without its own diagram has **no layout**.
- **The layout also changes the model.** Each drawn species' SBO term is overridden by its render class: Protein 252, Complex 297, Chemical 247, RNA 278, Gene 243, EntitySet 289 (or 298 with a Drug member), otherwise 285. The root gains `layout:required="false"` and `xmlns:layout`.
- **Elements**, in order: compartment glyphs (plus one hidden 1×1 glyph per model compartment not drawn), species glyphs (one per drawing, so an entity drawn twice has two), reaction glyphs (with the backbone rules: an int midpoint, and the single-input or single-output split), species-reference glyphs (`layout_{rid}_{role}_{i}`, with no `role` attribute), and text glyphs. Each list is ascending by renderable id. The layout has no `id` and no `dimensions`.
- **Against the JSON for R-HSA-69620**, the counts are compartment 3, species 153, reaction 63, species reference 251 and text 155.
  - Every glyph id, set, role and target matches the JSON.
  - Coordinates are the JSON's translated by (+48, +29), with no scaling.
  - 143 of 153 species boxes match exactly. The other 10 were resized by Java's `tightNodes`, which fits each node to its text with AWT font metrics; 14 curves end on those 10 nodes.
  - Label sizes come from the same font metrics. Neither result, nor the offset, is stored anywhere.
- **Where the JSON comes from:** `diagram/{stId}.json` from the release's download base (the site: `diagram.service.ts:208`). The type is `projects/pathway-browser/src/app/model/diagram.model.ts`, which omits the nodes' `textPosition` that the files carry. Beta does not serve `/download/current/diagram/` locally.

**Decision.**

- Port `LayoutConverter`'s algorithm literally over the diagram JSON, for the events that have one today and only those: the same ids, order, glyph sets, roles, backbone rules, RNA inset, hidden compartments, SBO override and root attributes.
- **Accepted differences:**
  - coordinates are the diagram's own, not offset by the curator tool's origin;
  - node sizes are the stored ones, not resized to fit text, with the edges ending on them following;
  - a label's size is its node's box.
- The JSON is read from the release's own download location (by version), or from a mounted folder of the same release, never mixed across releases.

**Rationale.** Everything structural is exact. Every coordinate difference traces to font rendering in Java, which is not reproducible and is not what the site draws.

**Alternatives considered.**

- _Reimplementing `tightNodes`_: rejected; it needs AWT's fonts and fixes 10 of 153 nodes.
- _A layout for sub-pathways and reactions from their parent's diagram_: rejected, as not today's behaviour.

## R4. BioPAX Level 3: today's converter, mapped to the graph

**Measured.**

- **The legacy service runs on the beta host too.** Its Tomcat answers `/ReactomeRESTfulAPI/RESTfulWS/biopaxExporter/Level3/{dbId}` (200, BioPAX, 0.02 s for a reaction) from the relational database on the same host, release 97. Only nginx does not route it, which is why beta's links answer the site's page. The same reaction from reactome.org has the same size and the same 80 individuals, in another order. **This local service is the reference** for the BioPAX comparison.
- **Production runs `restfulapi_mini`.** `GET /RESTfulWS/biopaxExporter/{level}/{dbId}` uses Pathway-Exchange's `ReactomeToBioPAX3XMLConverter` and writes with JDOM (`Format.getPrettyFormat()`): CRLF line endings, a 2-space indent and trimmed text. Every data property carries `rdf:datatype`.
- **Samples:** a reaction (109862), a degradation black box (201425), a disease reaction (1248655), a pathway of 14 events (112409) and Apoptosis (109581, 3.2 MB, 4,731 top-level elements).
- **The answer is identical when asked twice, but the order and ids are not reproducible across runs:**
  - several lists iterate Java HashMaps keyed by objects with no `hashCode`;
  - ids are `rdf:ID="{Class}{n}"`, per class in creation order;
  - `xml:base="http://www.reactome.org/biopax/{release}/{topDbId}#"`.
- **Headers:** `text/plain;charset=UTF-8`, with no Content-Disposition. A missing or non-event id is a **200** with a text error. A stId is a 400 JSON (the route takes a number).
- **The mapping** of every class and property, from relational attribute to graph property or relationship, is recorded in [data-model.md](data-model.md). It covers:
  - events (Pathway, BiochemicalReaction, Degradation, TemplateReaction), with Catalysis, Control, PathwayStep, Evidence, Provenance and the curation comments;
  - physical entities, typed by reference (sets typed by their members' common type, as the samples show; the source on GitHub differs);
  - features, entity references, xrefs, BioSource and PublicationXref.
- **Not in the graph:**
  - multiple EC numbers per molecular function: the graph keeps one, and 60 of Apoptosis's 142 reactions carry EC numbers;
  - `Book.chapterAuthors`;
  - `hasDomain`, absent from every sample.
- **Unreachable under today's schema:** the Modulation branch and the legacy classes.

**Superseded (24 Oct):** the writing moves to BioPAX3Exporter (R9). The mapping, the canonical comparison and the recorded differences below stand, and are what BioPAX3Exporter is built and proven against.

**Decision (23 Oct).**

- Write BioPAX Level 3 in TypeScript, emitting the same classes, properties, values, `rdf:ID` scheme, `xml:base`, namespaces and header, in a **deterministic** order: graph order, then dbId.
- The comparison with today's file is by meaning. Each file is canonicalised to a multiset of (class, property, target-key) triples, with each `rdf:ID` replaced by a content key: the event's or entity's DB_ID, an xref's db+id, a vocabulary's term, or recursive content for features and steps.
- **Recorded differences:** order and ids; the EC numbers; `chapterAuthors`; the converter's early return on a repeated cross-reference or disease (the exporter is to write all of them); and the answers' headers and errors (R6).

**Rationale.** Byte parity is impossible even Java against Java, and a deterministic order is strictly better.

**Alternatives considered.**

- _Paxtools on a JVM_: rejected on 23 Oct, because there was no runtime JVM. Superseded on 24 Oct: R10 serves the exporters from spec 010's Java library service.
- _The legacy service_: rejected, because it keeps the relational database.
- _The bulk exporter_: rejected, as out of scope.

## R5. Validators in continuous integration

**Measured.**

- **SBML:** python-libsbml 5.21.2 (an 8 MB wheel, a 2.7 s install).
  - `checkConsistency()` with UNITS_CONSISTENCY and MODELING_PRACTICE off.
  - Errors fail the check and warnings don't. libSBML sets no exit code, so the script sets it.
  - The layout package is validated: a broken glyph reference gave error 6020608.
  - Today's files have 0 errors. Signal Transduction gave 14 warnings (an invalid species sboTerm) in 3.3 s.
- **BioPAX:** the BioPAX validator 6.0.0 (from Maven Central, a 78 MB zip, JDK 17).
  - It runs offline: its ontologies are on the classpath.
  - Start-up takes about 230 s, then under 1 s per file.
  - **Its exit code is always 0**, so its XML reports must be read.
  - Today's legacy output has never been validated, so a baseline run on the samples comes first.

**Decision.** A new CI job, `exports`, runs in parallel with `unit`:

1. It builds the sample exports from **recorded graph rows and diagram fixtures**, since CI has no graph database.
2. It runs libSBML over the SBML samples.
3. It runs the BioPAX validator (cached, its sha1 checked, JDK 17) once over a directory, and fails on any error in the reports.

**Rationale.** The validators are pinned, offline and outside production, and the job runs alongside the end-to-end shards, so it adds no wall-clock time.

**Alternatives considered.**

- _The validators inside `unit`_: rejected; it would add about 4 minutes to a serial job.
- _libsbmljs_: rejected; unmaintained since 2019.
- _The biopax.org web service_: rejected; it needs the network.

## R6. Routes, headers, errors, cache and limits

**Measured.**

- **SBML today:**
  - The success answer is `application/sbml+xml;charset=UTF-8`, `attachment; filename="{stId}.sbml"`.
  - A missing id is a 404 in the JSON envelope (`Identifier 'X' not found`).
  - An id that exists but is not an event is a **400** (`The identifier 'X' does not correspond to a pathway or reaction`). Java decides that by loading every relationship of the object, which took about 30 s for ATP.
  - Both handlers are `synchronized`.
  - Files are cached on disk per release.
  - Signal Transduction (23.5 MB) is answered in 0.14 s from that cache.
- **The download guard.** The service marks a download `inline;filename=f.txt` when the URL's extension is not in Spring's trusted list. `sbml` is trusted, `biopax` and `owl` are not, and `rdf` and `xml` are.
- **The parity harness** compares JSON only; it compares a text body as one string.

**Decision.**

- **SBML.** Node answers `/exporter/event/{id}.sbml` and `/exporter/sbml/{id}.xml`, slashed forms included:
  - with the headers and errors above;
  - deciding "not an event" from the object's labels;
  - as a `deep` endpoint, with its own share of 2 (as Java runs one at a time);
  - cached per release under spec 011 (path kind `oid`; Java's described `includeRef` and `view` marked ignored).
  - `diff.ts` compares status, headers and errors live. The 200 body is compared by an SBML comparison tool against the reference (R1), with the generation note set aside.
- **BioPAX.**
  - Node answers `/exporter/event/{id}.biopax` as `application/rdf+xml` with `attachment; filename="{stId}.biopax"`. Because `biopax` is not a trusted extension, the endpoint opts out of the download guard: it is no URL of Java's, so there is nothing to imitate, and the name is the server's own.
  - A missing id is a 404 and a non-event a 400, in the service's envelope.
  - It is `deep` and cached per release.
  - The legacy `/ReactomeRESTfulAPI/RESTfulWS/biopaxExporter/Level3/{dbId}` is a node endpoint answering **301** to it, routed in routes-core and the dev proxy alike.
- **Routing:**
  - **nginx:** a node location before Java's `exporter/(diagram|document|event)` location, under the render budget. `local.conf` has the same without the budget, `proxy.conf.js` agrees, and `routes.spec.ts` covers them.
  - **Staying in Java:** SBGN and the event PDF. `.sbgn` is added to the spec's list of Java neighbours, so a regex that takes too much fails the test.
  - **Code** (superseded on 24 Oct): the endpoints join `exporters-endpoints.ts`, but the bodies come from the library service (R10). No writer or model module is added here.

**Rationale.** Matching Java where it has an answer, and choosing the clearest answer where it has none (BioPAX).

**Alternatives considered.**

- _BioPAX as `text/plain` with no name, and errors as 200 text, as today_: rejected. A download should be named, and an error should not be a 200.
- _A trusted extension (`.rdf`)_: rejected; `.biopax` is the name users expect.

## R7. The interim BioPAX link (User Story 3)

**Measured.** Both site links build `${RESTFUL_API}/biopaxExporter/Level3/{id}` (`environment.ts:128`). On beta, `RESTFUL_API` is the page's own origin. The legacy service that answers that path runs on the beta host's Tomcat (R4), but no nginx location sends `/ReactomeRESTfulAPI/` there, so it falls to the site.

**Decision.** Route `^/ReactomeRESTfulAPI/RESTfulWS/biopaxExporter/Level3/` to the host's Tomcat in nginx, and in the dev proxy alike, until User Story 2 ships. Then that route is replaced by node's 301 to the new export, the two links move to it, and `RESTFUL_API` is deleted. It needs only an nginx rebuild; the site is unchanged.

**Rationale.** Beta then serves its own BioPAX, from its own release, with no dependency on reactome.org and no site rebuild. It is undone by removing one location.

**Alternatives considered.**

- _Pointing `RESTFUL_API` at reactome.org_: rejected. Beta would depend on production, it would need a site rebuild, and it would serve another release's file.
- _Hiding the links_: kept as the fallback.

## R8. Load on the shared graph, and fixtures

**Measured.** The Java converters make many small queries, plus one query that loads all relationships for the top event. One probe for this research (a non-event id) caused two 30-second reads on beta's shared graph.

**Decision.**

- **Reference outputs** come from a **private graph database of the same release**, run apart from beta's.

**Measured for T002 (23 Oct 2026).**

- **Where beta's graph keeps its data.** It runs from a local image of the release (4.49 GB), with its data in a Docker volume.
- **Disk.** There was not enough free for a copy until Docker's build cache (cached build layers only) was cleared, which left 8.6 GB free.

**Decision (T002).**

- **The copy.** The private graph is a copy of beta's own release-97 volume, made read-only into a new volume by a helper container. Nothing is downloaded, and no request leaves the host.
- **The container.** It is started from the same local image, bound to loopback only, with a smaller memory setting than beta's, so the host's memory is shared safely. Beta's graph is neither stopped nor restarted; its store is not written after the release load, so a copy taken while it runs is consistent in practice, and Neo4j checks the store when the copy starts.
- **Afterwards.** The copy is stopped once the references are made (T003), and recreated for each comparison that needs it (T032), and its volume is deleted, giving the disk back.
- **The fallback** is small, spaced runs against the shared graph. It is used only if the copy fails to start cleanly.
- **Committed fixtures** have personal values replaced: SBML vCard names; BioPAX `bp:author` and the `Authored:`, `Reviewed:` and `Edited:` comments. The comparison tools hash those values and never print them.

**Rationale.** FR-014 and the organisation's rule on personal information.

## R9. The three repositories (measured 24 Oct 2026)

Read on each default branch, cloned shallowly, with nothing run against Reactome's services. None of the three has a licence file or code owners.

**`reactome/sbml-exporter`** (Java, Maven, version 2.2.7; JDK 11 runtime):

- **The command line is the release's SBML step.** Its Jenkinsfile packs the output into `all_species.3.1.sbml.tgz` and `homo_sapiens.3.1.sbml.tgz`; `release-download-directory` has no SBML step.
  - It requires the relational options and always builds a relational adaptor.
  - It runs only the relational converter (`SbmlConverterForRel`), over every pathway of a species, one by one, writing `{stId}.sbml` each.
- **The graph-only `SbmlConverter`** (packages `converter` and `data`) imports nothing relational. It runs per event as a library call, `new SbmlConverter(event, version, ads).convert()`. Its data comes from two Cypher queries in `DataFactory`, through a statically injected service, so a caller needs graph-core's Spring context.
- **Five defects** are present on `main` and on every other branch:
  1. catalysts are set from the positive regulators;
  2. negative regulators are set from the positive regulators;
  3. positive regulators are never set;
  4. one `Participant` is reused across the loop;
  5. `ReactionBaseResult.build` never reads `catalysts`, although the query returns it.

  R1 counted the first four, with the fifth as part of the catalyst fix.

- **The layout** (`LayoutConverter`) reads the relational `PathwayDiagram`, through `DiagramGKBReader` to a `RenderablePathway`, and only in the relational converter.
- **No tests.** CI lints, builds a Docker image and pushes it. The release run adds a file-size check.
- **Dependencies:** the parent pom is a SNAPSHOT of `reactome-parent`. graph-core and JSBML come from the Reactome BOM.

**`reactome/BioPAX3Exporter`** (Kotlin 1.7, Maven, JDK 17; graph-core 2.0.9, Paxtools 4.3.1, BioPAX validator 5.1.0):

- **Reads** only the graph, through graph-core's services. It uses no Cypher and nothing relational.
- **Writes** Level 3 only:
  - `{dbId}.owl` per pathway (`-t`, `-m`);
  - `{Species_Name}.owl` per species (`-s`, or every species with no selector).

  Its Jenkinsfile zips them as `biopax.zip`. Its run command has a stray quote, so the step as written would fail; whether it has ever run cannot be read from the repository.

- **As a library:** `WriteBioPAX3(pathway, version).createModel()`. A single reaction cannot be exported.
- **Content, against today's files and [data-model.md](data-model.md):**
  - pathways: name, summation and organism, with an empty evidence per element;
  - reactions: left and right, without stoichiometry;
  - physical entities: by name only. There are no entity references, cross-references, components or locations;
  - catalysis: without its controller;
  - missing entirely: regulation, literature and stable-identifier cross-references.
- **Other defects:**
  - species mode writes every pathway of the species as its own component, sub-pathways included;
  - the events in no pathway are computed but never written;
  - `-l` writes an empty pathway;
  - `xml:base` is `https://…/biopax/{version}/species/{dbId}#`, where the release's check of `biopax.zip` (in `release-download-directory`'s Jenkinsfile, run once the file is in the download directory) requires every Level 3 file to contain `xml:base="http://www.reactome.org/biopax/{release}`. Today's per-event files (`…/biopax/{release}/{topDbId}#`, data-model.md) begin the same way;
  - the base is a static field, so it is not thread-safe.
- **Tests:** seven unit test files, all on mocks. There is no comparison with the old files.

**`reactome/release-download-directory`** (Java 8 source, JDK 11 image; Paxtools 5.1, Pathway-Exchange built from source):

- **BioPAX.** For each species, Pathway-Exchange's `SpeciesAllPathwaysConverter` (Level 2) and `SpeciesAllPathwaysLevel3Converter` (Level 3) write one `.owl`, zipped as `biopax2.zip` and `biopax.zip`.
- **What release 97 published.** Its `biopax.zip` in the download directory (174 MB, 15 species files) is that converter's output:
  - `xml:base="http://www.reactome.org/biopax/97/{species dbId}#"` (48887 for human), not BioPAX3Exporter's form;
  - `rdf:ID`s are class counters;
  - the content is Pathway-Exchange's. _Plasmodium falciparum_'s file has 658 pathways, 966 reactions, 993 protein references, 17,026 unification xrefs, 5,648 publication xrefs, 2,960 stoichiometries and 689 catalyses.

  So it is a valid reference for BioPAX3Exporter. Read on 24 Oct 2026; the file is kept outside the repository. The validator step is commented out, so the validator archives its README lists are not made.

- **Its other steps, all relational:**
  - database dumps;
  - GSEA `.gmt` and `ReactomeToBioSystems.zip`, both through Pathway-Exchange;
  - the Protégé ontology files;
  - `reactome_stable_ids.txt`, which needs the stable-identifier database;
  - `gene_association.reactome`;
  - optionally, `pathway2summation.txt` and `humanPathwaysWithDiagrams.txt`.

**`reactome/data-export`** (Java; graph-core and Cypher only, "the files to be placed in the download section"). Some of those steps already have a graph-based counterpart here, read from its task list on 24 Oct 2026:

- **`pathway2summation` and `humanPathwaysWithDiagrams`:** made by its `PathwaySummationMapping` and `HumanPathwaysWithDiagrams` tasks.
- **A GSEA-style GMT:** its `GmtExporter` writes `Reactome_GeneName.gmt` from the graph. Whether that is the same set as `release-download-directory`'s `ReactomePathways.gmt.zip`, under another name, is not shown by the code. A file comparison would settle it.
- **No counterpart** for the database dumps (MySQL by nature), the Protégé ontology files, `reactome_stable_ids.txt`, `gene_association.reactome` or the BioSystems export.

So retiring `release-download-directory` is smaller than its step list suggests. That work remains out of this spec's scope (T058 records it for whoever retires it).

**Decision.**

- **SBML:** `sbml-exporter`. Fix and test the graph-only converter, add the layout from the diagram files (R3, ported in Java), and make the command line graph-only for the bulk run. The website calls the same library.
- **BioPAX Level 3:** `BioPAX3Exporter`. Build its content to [data-model.md](data-model.md)'s mapping, fix its modes and `xml:base`, add a per-reaction export, and prove it by R4's comparison against the per-event and species files. The website calls the same library.
- **Both:** the changes go to each repository's maintainers as issues first, then as pull requests once they agree (FR-010). The comparison tools and the sample stay in this repository, as instruments run against each exporter's output.

**Rationale.** One implementation per format is the user's aim. Both repositories already read the graph, in the languages their release runs use. A third implementation in TypeScript would have left the bulk files on separate code.

**Alternatives considered.**

- _Writing both in TypeScript in the node service_ (23 Oct): rejected, because the bulk files would keep a second implementation.
- _A new SBML repository_: rejected unless its maintainers prefer it, since the graph-only converter and its history are in `sbml-exporter`.
- _Porting Pathway-Exchange's converters to the graph_: rejected, because BioPAX3Exporter already reads the graph through Paxtools, which also gives the validator.

## R10. Serving the exporters to the website

**Measured.**

- **Spec 010 already plans the home.** Its library service (spec 010 research R2) is a small Spring Boot application in its own Reactome repository, licensed AGPL-3.0, reached only over HTTP through node's pass-through. It hosts the operations that stay in Java, the SBML export among them, built from pinned library commits (`deploy/java/PINS.md`). It is not built yet: its repository waits for the organisation's owners (spec 010 T001).
- **The exporters' licences.** None of the three repositories has a licence file (R9). Bundling them into an image built in this Apache-2.0 repository would need that settled; spec 010's AGPL service is where Reactome's Java libraries are already meant to be combined.
- **graph-core.** BioPAX3Exporter pins 2.0.9. `sbml-exporter` takes its version from the Reactome BOM. The library service pins one version for all its libraries.

**Decision.**

- **The website's exports are operations of spec 010's library service.**
  - Its SBML operation uses the fixed graph-only converter with the layout from the diagram files, not the relational converter that spec 010 first planned. Its parity with Java is then this spec's comparison, not a byte comparison with Java's relational answer.
  - It gains a BioPAX Level 3 operation through `WriteBioPAX3`.
  - **Each exporter's repository is organised as a library and a command line** (decided with the user, 24 Oct 2026):
    - a library module: graph in, model out (`SbmlConverter` with its layout; `WriteBioPAX3`), with its tests, published as a versioned Maven artefact;
    - a thin command-line module that the release's bulk run uses, depending on that library.

    The library service depends on the same library at a pinned version. So the release and the website run one codebase, and keeping the website current is a version bump. Until a library is published, the service builds it from a pinned commit, as spec 010 builds every library.
- **Node** answers `/ContentService/exporter/event/{id}.sbml`, `/exporter/sbml/{id}.xml` and `/exporter/event/{id}.biopax` through spec 010's pass-through, with R6's headers and errors, cached per release under spec 011. When the library service cannot answer, node answers 503 in the envelope, never a fallback.
- **The runtime is JDK 17.** BioPAX3Exporter is built for JDK 17, so a Java 11 runtime cannot load it. The libraries built for Java 11 run on 17 unchanged, so spec 010's service runs on JDK 17. Its bytecode stays Java 11 where its libraries need that. Spec 010's T011 and T017 are amended. Kryo and interactor-core's behaviour on 17 is checked by spec 010's token parity (its T026).
- **graph-core** is aligned in both exporters to the version spec 010's service pins. BioPAX3Exporter moves up from 2.0.9, and `sbml-exporter` follows from the BOM. The pinned version is the one the deployed ContentService runs, unless spec 010 records otherwise. Each exporter's maintainers are asked to accept it (T029).

**Rationale.** One Java service for what stays in Java, as spec 010 decided. Its licence suits combining Reactome's libraries. The website runs the exact code the release runs. And this repository gains no second JVM.

**Amended 25 Oct 2026 (decided with the user): SBML is served on beta now, from this repository.** Spec 010's library service waits for its own repository (spec 010 T001), and the website's SBML should not wait for it. So the service is started here, in `deploy/java-library/`, with SBML as its only operation:

- **The library comes from source.** Its Dockerfile builds `sbml-exporter-lib` from the `graph-only` commit pinned in `deploy/java/PINS.md`. The library cannot be published to Maven while it is on a branch. Once it is published, that build stage goes and the service's pom names the published version.
- **The licences.** This repository holds only the service's own code and a Dockerfile naming the pinned commit, not the libraries. The image is built on the beta host and published nowhere. Settling the libraries' licences stays a condition for publishing the library or the image (sbml-exporter#14).
- **The diagram files** are fetched on demand from the release's download directory: the same static `diagram/{stId}.json` files the site's browser loads. One file per converted pathway that has a diagram, cached on disk per release. Beta has no local copy of the folder.
- **Moving later.** When spec 010's repository exists, the service moves there unchanged, and its BioPAX operation joins it there.

**Alternatives considered.**

- _A second Java service in this repository's compose_ (this research's first answer, 24 Oct): rejected then. It would duplicate spec 010's service, and bundle unlicensed libraries into an Apache-2.0 repository's image. Taken up on 25 Oct for SBML on beta (above): it is the start of spec 010's service rather than a second one, and nothing is bundled into the repository or published.
- _The Java ContentService calling the exporters_: rejected. ContentService is being retired route by route.
- _The exporters' command lines, run per request_: rejected. That starts a JVM per download, at seconds each.
