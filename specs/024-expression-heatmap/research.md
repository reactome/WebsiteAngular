# Research: An Expression Heatmap of the Selection's Own Genes

All figures were measured on 2026-11-10 unless stated otherwise. Reactome data is release 98 (2026-10-18).

## R1. May the data be served from this site?

**Decision**: Yes, under CC BY 4.0, with attribution on the tab (FR-012).

**Rationale**: Expression Atlas's licence page (https://www.ebi.ac.uk/gxa/licence.html) says: "We are applying the Creative Commons Attribution 4.0 International License for all copyrightable material on our website … anyone is free to copy, reuse, display and distribute the images and information on our database, provided you give us credit by citing: Expression Atlas in 2026 … (Nucleic Acids Research, 10 December 2025)", doi:10.1093/nar/gkaf1238.

EMBL-EBI's terms of use add no restriction beyond the data owners'. E-MTAB-2836's data comes from the Human Protein Atlas (Uhlén et al., _Science_ 2015, doi:10.1126/science.1260419), which is also CC BY 4.0 (https://www.proteinatlas.org/about/licence). No ShareAlike or NonCommercial term was found.

The tab therefore:

- cites the Expression Atlas paper and the experiment accession with a link;
- for human, cites Uhlén et al. 2015;
- names the licence;
- states what was changed: rows reordered and chosen, values as published.

**Alternatives considered**: linking out only, with no data served. That was rejected by the requester's goal.

## R2. Matching a protein to its gene

**Decision**: Reactome's own pairing, ReferenceGeneProduct → `referenceGene` → ReferenceDNASequence with databaseName ENSEMBL, read from the graph at answer time. When none of a product's Ensembl genes is in the experiment, fall back to the product's `geneName`, if that name appears exactly once in the experiment.

**Measured coverage**: of 11,494 human gene products in Homo sapiens pathways (from `UniProt2Reactome.txt`, isoforms folded into their parents, 469 non-human proteins dropped):

| Route                                              | Gene in the experiment | Not matched                                                       |
| -------------------------------------------------- | ---------------------- | ----------------------------------------------------------------- |
| Reactome `referenceGene`                           | 11,375 (98.96%)        | 82 with no Ensembl gene; 37 whose Ensembl gene isn't in the table |
| UniProt ID mapping (`HUMAN_9606_idmapping.dat.gz`) | 11,302 (98.33%)        | finds nothing Reactome misses                                     |
| Reactome + gene-name fallback                      | **11,445 (99.57%)**    | 49                                                                |

SC-002 asks for at least 95%.

**Failures (sampled)**:

- **No Ensembl gene**: mostly immunoglobulin and T-cell receptor segments, pseudogenes and "putative" entries.
- **Gene not in the table**: Ensembl gave the gene a new id after the experiment was built. Reactome gives SOD2 (P04179) only ENSG00000291237, while the table has SOD2 as ENSG00000112096; POLR2A, SHANK3 and CAST are the same. Alternative-haplotype genes (HLA-DRB3/4, KIR, GSTT1) fail too. The name fallback rescues SOD2, POLR2A, IGKC, TRAC and ABO.

**Several genes for one product**: once restricted to genes in the table, 141 products still have more than one. These are duplicated genes (DEFB4A/B), readthrough genes (MSH5 with MSH5-SAPCD1) and unnamed extras. Rule:

1. Keep only the genes in the table.
2. If one of them has the product's `geneName`, use that one alone.
3. Otherwise draw one row per gene, each labelled with its table name.

**Rationale**: it is the largest coverage, and it is the same data the selection itself comes from. It needs no second source to keep in step, and it is CC0. The selection's reference entities answer (`/data/participants/{id}/referenceEntities`) carries no `referenceGene`, so the match is made on the server (R3), from the graph.

**Alternatives considered**: UniProt ID mapping (less coverage, CC BY, changes several times a year); BioMart (a third source, not needed above 95%); matching on the client (it would need a 300 KB+ mapping file sent to every reader, or a second request per selection).

## R3. Serving: an endpoint answering the selection, or a static file

**Decision**: a new, node-only endpoint family in the content service, `expression-endpoints.ts`, answering `GET /ContentService/expression/{id}` for a selection's stable id. The server resolves the selection's genes from the graph (R2), looks them up in the experiment table held in memory, orders them (R6), and answers the heatmap's rows, the genes not shown with reasons, and the experiment's description.

**Rationale**:

- **Size**: the whole human table is 27.6 MB as JSON, 4.1 MB gzipped. Medians alone are 1.4 MB gzipped. A static file would cost every reader who opens the tab at least that much. One gene with all five values is about 454 bytes, so a 100-gene pathway answers about 45 KB, and a 2,500-gene pathway about 1.1 MB before nginx's gzip.
- **Request size**: a GET keyed by the selection's id stays short. A GET carrying 2,500 gene ids would exceed nginx's default 8 KB request line (no `large_client_header_buffers` is set). A POST would not be edge-cacheable.
- **Cacheable**: one answer per selection and release, stored at the edge like the service's other answers (`CACHEABLE` in `cache-label.ts`).
- **Matching needs the graph** (R2), which the content service already holds.
- **Precedent**: `description-endpoints.ts` already serves a node-only URL Java never had (`/ContentService/openapi.json`):
  - `samplesOnly: true` and a spec of its own, since the parity harness has no Java answer to compare;
  - a `parameters.ts` entry with `java: null` and a `why`;
  - nginx `=` locations with slashed twins, and a matching `proxy.conf.js` row.
- **The byte-identical rule** governs ported endpoints. This one has no Java counterpart, so the rule doesn't apply, and "no fallback" is moot: Java never answers it.

**Alternatives considered**:

- **A static asset per species** (precedent: `assets/data/analysis-examples/tissue.tsv`, 2.67 MB, fetched lazily). Rejected for the download size, and because matching would have to happen on the client.
- **POST with gene ids**: not edge-cacheable, and the client has no Ensembl ids.
- **A separate small service**: more deployment for no gain. The content service already has the graph and the routing.

## R4. Where the table lives, and how it is refreshed (FR-013)

**Decision**: the tables are not committed. A refresh script, `tools/content-node/snapshot-expression.ts`, downloads each listed experiment's `-tpms.tsv` and `-configuration.xml` (and its condensed SDRF for sample counts) from EBI's FTP. It writes one compact file per experiment into a data directory, and checks what it wrote before keeping it. The service reads that directory from a read-only mount, `EXPRESSION_FILES`, as it does the release's diagram files (`DIAGRAM_FILES`). A missing directory, or a missing species file, answers 503 "Expression data is not available", never another experiment's data.

**Rationale**: the human table alone is 25 MB of JSON. The repository is public, its largest file today is about 3.3 MB, and it has no LFS. The diagram-files mount is the existing precedent for release data kept out of git and out of the image. Its folder path comes from an uncommitted `.env` variable, so no server path enters the repository.

**The refresh step's checks** (FR-013; constitution I: verify the instrument):

- the gene and tissue counts match the source;
- every tissue label maps to a group in the configuration;
- 20 sampled gene × tissue cells equal the source line byte for byte;
- the file round-trips;
- the script refuses to write on any mismatch.

It runs by hand, when Expression Atlas updates an experiment (E-MTAB-2836 was last updated 2025-01-23). It is a `tools/` TypeScript module with an entry guard, so `tools/load.spec.ts` loads it without running it.

**Tests** use a small fixture table checked into the repository: about 20 genes × the human tissues, cut from the real table by the same script. They never need the full data.

**Alternatives considered**: committing the table (rejected: size, a public repository); baking it into the image (rebuilds the image for a data change, and the image grows by about 25 MB per species); fetching from EBI at start-up (makes start-up depend on a third party, and it fails closed for every reader).

## R5. Compact format

**Decision**: one JSON file per experiment.

- **A header**: accession, title, design, species, source URL, release date, citation and licence.
- **The tissues**: in display order, each with its label and its number of samples.
- **The genes**: an object keyed by versionless Ensembl gene id, holding the table's gene name and, per tissue, the five quantiles as published, or `null` where the table has none.

Loaded once, lazily, on the first request for that species. Measured for human (2026-11-10, T013): the file is 28.6 MB for all 61,860 genes, written in 3.9 s. Genes with no expression anywhere (6,490) are kept too, as "expressed nowhere", so that they aren't reported as "not in the experiment".

Held in memory, the values are packed into one `Float64Array`, five per tissue per gene: 15 MB of heap plus 72 MB of buffer, 87 MB in all, loaded in 2.5 s. As plain objects the same table took 184 MB of heap. Double precision keeps every published value exact; single precision would turn 0.3 into 0.30000001.

**Rationale**: values stay exactly as published (FR-003), and the format reads with the standard library. A binary format would save memory but add a decoder to test. Holding it in memory is affordable: the service runs with no memory limit and keeps its caches for its lifetime. Planning budget: under 150 MB per loaded species, and the packed human table measures 87 MB (constitution II).

**Alternatives considered**: keeping the TSV as is (needs parsing at start-up, and its comma-in-cell quantiles are awkward); medians only (loses the spread FR-004 shows).

## R6. Row order (FR-006)

**Decision**: genes expressed alike sit together, by a deterministic order computed on the server. Each row's vector is log₁₀(median+1) across tissues. Rows are ordered by average-linkage hierarchical clustering on correlation distance, leaves in a stable order, with ties broken by gene name. Above 3,000 rows, which no Homo sapiens pathway is expected to reach (measured in implementation), they fall back to ordering by the tissue of highest expression, then by that value. The reader can switch to alphabetical order on the client.

**Rationale**: it is what readers of expression heatmaps expect (Expression Atlas, GTEx). Computed once per answer, it is cacheable at the edge and testable as a pure function. 2,500 rows means about 3.1 M pairwise distances, well within a request's budget, to be measured.

**Alternatives considered**: ordering on the client (repeated for every reader, and harder to test); ordering by name only (hides the pattern the tab exists to show).

## R7. Drawing the heatmap

**Decision**: a component of our own in the Expression tab. The cells are drawn on a canvas, with an accessible overlay for hover and keyboard focus (FR-004). The gene and tissue labels are HTML. The colour scale is logarithmic, from the site's theme tokens, so it follows light and dark (FR-014). Zero has its own shade, "not expressed", and a gene expressed nowhere is distinct from a missing value. The Expression Atlas widget, its bundles, its stylesheet and the CDN font host in the e2e fixture are removed.

**Rationale**: 2,500 × 29 is about 72,000 cells, too many for SVG elements to stay responsive, and a canvas draws it in one pass. Keyboard access and hover details need real elements, so focus moves over a grid of row/column positions. Theme tokens are the site's existing way of following dark mode.

**Alternatives considered**: a charting library (adds a dependency and its theming); SVG (slow at this size); the Expression Atlas widget (it ignores the genes, and it ignores the site's theme).

## R8. Species and their experiments (FR-010, User Story 5)

**Decision**: the hand-kept list below, in the refresh script's configuration and named in the answer. Every other species answers "not available".

| Species            | Experiment   | Design                                                                        | Notes                                                           |
| ------------------ | ------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Homo sapiens       | E-MTAB-2836  | 29 tissues, 122 individuals, real quantiles                                   | User Story 1                                                    |
| Mus musculus       | E-MTAB-3718  | 6 adult tissues (brain, cerebellum, heart, kidney, liver, testis), 20 samples | Atlas's own reference                                           |
| Rattus norvegicus  | E-GEOD-53960 | the adult stage only: 11 organs × sex                                         | each sex a column of its own; quantiles can't be merged exactly |
| Bos taurus         | E-MTAB-2798  | 9 tissues, 3 samples each                                                     |                                                                 |
| Gallus gallus      | E-MTAB-2797  | 9 tissues                                                                     |                                                                 |
| Sus scrofa         | E-MTAB-5895  | 27 tissues × sex                                                              | juvenile (3–5 months): stated on the tab                        |
| Xenopus tropicalis | E-MTAB-3726  | 5 adult tissues, single sample each                                           | no spread: "1 sample" stated                                    |

**None suitable**:

- Canis familiaris: no baseline experiment.
- Danio rerio: developmental stages only.
- Drosophila melanogaster: strains and neuron types, no adult organs.
- Caenorhabditis elegans: stages.
- Yeasts, Dictyostelium, Plasmodium and M. tuberculosis: no tissues, or no experiments.

Source: Expression Atlas's experiment list (4,562 experiments, 256 baseline RNA-seq), each experiment's configuration, and the first bytes of each `-tpms.tsv`.

**Matching for other species**: R2's coverage was measured for human only. For each added species it is measured again in implementation, and that species joins the list only if it reaches SC-002's 95%.

**Alternatives considered**: taking Atlas's reference per species (fly and zebrafish would then show strains or embryonic stages as if they were tissues); human orthologs (rejected in the spec).

## R9. Testing

- **Unit (vitest)**:
  - matching rules (R2, including multi-gene and name fallback);
  - row order (R6);
  - the refresh script's checks, run on the fixture, including a mutated fixture it must refuse;
  - the answer's shape against its contract type.
- **Service**: `expression-endpoints.spec.ts`, on the fixture table and a stubbed graph. It covers the answer, unknown ids, a species not on the list, a missing data directory (503), and a selection with no genes. It joins `parameters.ts`, the route order and `routes.spec.ts` (nginx and proxy).
- **e2e**: HAR-recorded answers for R-HSA-109606, a complex, BCL2, ATP and a non-human pathway. They check:
  - the rows are the selection's genes, and Atlas's defaults are absent;
  - hover shows the five values;
  - the not-shown list;
  - no request goes to `ebi.ac.uk`;
  - dark mode draws on the theme's background.

  Each new assertion is shown to fail first (constitution III).

- **SC-003**: a check comparing 20 sampled cells of a live answer with the published table. It is part of the refresh step and runnable against beta.

## R10. Anatomograms (FR-015 to FR-017, User Story 6)

**Decision**: Expression Atlas's own figures, from the `@ebi-gene-expression-group/anatomogram` package (2.4.0, Apache-2.0; the figures are CC BY 4.0 under Expression Atlas's licence, which names them). They are served from the site's assets and loaded when the tab opens. Each experiment tissue is matched to an organ by its UBERON id, read by the refresh step from the experiment's condensed sample file into each tissue's entry. Our own component draws the SVG inline and sets each matched organ's fill from the heatmap's scale and the theme's tokens; it does not embed Atlas's widget.

**Measured** (2026-11-10):

- **Coverage:** all 29 of E-MTAB-2836's tissues have an organ in the human figures.
  - In both the male and female figures: 23 tissues.
  - Female figure only: endometrium, fallopian tube, ovary and placenta.
  - Male figure only: prostate gland and testis.
  - Brain figure: cerebral cortex, which is also in both of the others.
- **Sizes:** male 952 KB, female 429 KB and brain 354 KB, before compression. Each figure marks 76 UBERON ids, as plain `fill` styles.
- **Other species:** there are figures for mouse, rat, cow, chicken and frog, which covers the species list in R8 except pig.

**Rationale**: the production tab had the figure. The ids match without a hand-kept table, and the figures are licensed for reuse with attribution.

**Alternatives considered**: drawing figures of our own (much work, no gain); embedding Atlas's anatomogram widget (its colours ignore the theme, and it needs its bundles).
