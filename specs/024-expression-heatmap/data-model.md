# Data Model: An Expression Heatmap of the Selection's Own Genes

## Experiment file (one per listed species, written by the refresh step)

| Field                 | Meaning                                                          | Rule                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accession`           | e.g. `E-MTAB-2836`                                               | as published                                                                                                                                                              |
| `title`               | the experiment's title                                           | as published                                                                                                                                                              |
| `design`              | one line for the tab, e.g. "29 tissues from 122 individuals"     | written in the species list, checked against the configuration's counts                                                                                                   |
| `species`             | e.g. `Homo sapiens`                                              | matches Reactome's species name                                                                                                                                           |
| `source`              | the FTP URL of the table and the experiment's Atlas page         |                                                                                                                                                                           |
| `updated`             | the experiment's last update in Atlas (ISO date)                 | from Atlas's experiment information                                                                                                                                       |
| `fetched`             | when the refresh step ran (ISO date)                             |                                                                                                                                                                           |
| `citation`, `licence` | the attribution shown on the tab (research R1)                   |                                                                                                                                                                           |
| `tissues[]`           | `{ id, label, samples }` in display order                        | `id` is the table's group id (`g1` …); `label` is from the configuration; `samples` is the number of assays in the group                                                  |
| `genes`               | object keyed by versionless Ensembl gene id → `{ name, values }` | `values[i]` is `[min, q1, median, q3, max]` for `tissues[i]`, exactly as published, or `null` where the table has no value. A gene expressed nowhere is kept, with zeros. |

**Validation (refresh step)**:

- the gene count equals the source's data rows;
- the tissue count equals the source's columns and the configuration's groups;
- every quantile tuple is non-decreasing;
- 20 sampled cells equal the source text;
- the file round-trips.

Any failure means nothing is written.

## The selection's genes (computed per answer)

- **Shown gene**: `{ gene (Ensembl id), name, values per tissue, from[] }`. `from` lists the selection's entities that point at the gene: UniProt accession or Ensembl id, plus Reactome stId.
- **Not shown**: `{ entity (accession or id, display name), reason }`, where `reason` is one of:
  - `no-gene`: no Ensembl gene, and no unique name match;
  - `not-in-experiment`: its Ensembl gene(s) are absent from the table, and no unique name match;
  - `not-measured`: present, but the table has no value for it in any tissue. Kept apart from "expressed nowhere", which is drawn as zeros;
  - `other-species`: the entity is another species' (HIV infection holds 9 HIV-1 proteins), never drawn with this experiment's data, not even by a shared gene name (FR-010).

**Matching rules** (research R2), in order:

1. Gene references (ReferenceDNASequence, ENSEMBL) are used directly.
2. A gene product's (or isoform's) `referenceGene` Ensembl ids, kept only if in the table.
3. If several remain and one carries the product's `geneName`, that one alone.
4. Otherwise one row per remaining gene.
5. If none remain, the product's `geneName`, when it names exactly one gene in the table.
6. Each gene appears once, its `from` collecting every entity that matched it.

Chemicals and drugs (ReferenceMolecule, ReferenceTherapeutic) are not genes and are not counted.

## The answer (contract type, `projects/contract/expression.ts`)

`ExpressionAnswer` comes in one of three shapes:

- **`kind: "heatmap"`**:
  - `experiment`: the file's header, without genes;
  - `rows[]`: shown genes in the server's order (research R6), each with `values`;
  - `notShown[]`;
  - `counts`: `{ shown, genes }`, where `genes` counts the selection's distinct gene products and gene references.
- **`kind: "no-genes"`**: the selection has no genes (a chemical, say). `experiment` is still named.
- **`kind: "species-not-available"`**: `species`, with no experiment.

Errors use the service's envelope: 404 for an unknown id, and 503 when the data directory or the species file is missing.

## State

No state is kept per reader. An experiment file is loaded on the first request for its species and kept for the process's lifetime. A refresh replaces the files, and the service is restarted, as for any data update.
