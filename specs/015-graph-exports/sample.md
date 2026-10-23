# The sample

The 30 events every export of spec 015 is compared and validated over (SC-002, SC-004; tasks T001). Each was looked up on the beta host (release 97) on 23 Oct 2026, through the node content service's `/data/query/ids`. None is guessed.

"Why" is why each was chosen. Where it states a number, that number was measured (research); otherwise it is the reason for choosing it, which the counts T004 records confirm or correct.

The class and flags are graph-core's: `diag` is `hasDiagram`, `dis` is `isInDisease`, `inf` is `isInferred`. "Layout" says whether today's SBML has one: the event has its own diagram, and that diagram draws a reaction (research R3).

## Top-level pathways

| Stable id     | dbId    | Class           | Name                              | Why                                                                   |
| ------------- | ------- | --------------- | --------------------------------- | --------------------------------------------------------------------- |
| R-HSA-162582  | 162582  | TopLevelPathway | Signal Transduction               | The largest: 2,589 reactions, 4,407 species, 23.5 MB of SBML (SC-006) |
| R-HSA-1640170 | 1640170 | TopLevelPathway | Cell Cycle                        | A large top level                                                     |
| R-HSA-1643685 | 1643685 | TopLevelPathway | Disease                           | The disease top level (dis)                                           |
| R-HSA-5357801 | 5357801 | TopLevelPathway | Programmed Cell Death             | A middle-sized top level                                              |
| R-HSA-1474244 | 1474244 | TopLevelPathway | Extracellular matrix organization | Set-heavy: many entity sets, candidates and members                   |

## Pathways with their own diagram (a layout today)

| Stable id     | dbId    | Class   | Name                                | Why                                                                         |
| ------------- | ------- | ------- | ----------------------------------- | --------------------------------------------------------------------------- |
| R-HSA-69620   | 69620   | Pathway | Cell Cycle Checkpoints              | The layout research's case: 3,686 layout elements, 10 nodes resized by Java |
| R-HSA-109581  | 109581  | Pathway | Apoptosis                           | BioPAX's large case: 3.2 MB, 142 reactions, 60 with EC numbers              |
| R-HSA-109606  | 109606  | Pathway | Intrinsic Pathway for Apoptosis     | A sub-pathway with its own diagram                                          |
| R-HSA-112409  | 112409  | Pathway | RAF-independent MAPK1/3 activation  | Small: 14 events                                                            |
| R-HSA-5683057 | 5683057 | Pathway | MAPK family signaling cascades      | Medium                                                                      |
| R-HSA-1280215 | 1280215 | Pathway | Cytokine Signaling in Immune system | Large, many sets                                                            |
| R-HSA-9006936 | 9006936 | Pathway | Signaling by TGFB family members    | Regulations, positive and negative                                          |
| R-HSA-9839373 | 9839373 | Pathway | Signaling by TGFBR3                 | Recent, small                                                               |

## Pathways without a diagram of their own (no layout today)

| Stable id    | dbId   | Class   | Name                                                | Why                                         |
| ------------ | ------ | ------- | --------------------------------------------------- | ------------------------------------------- |
| R-HSA-69481  | 69481  | Pathway | G2/M Checkpoints                                    | Drawn on its parent's diagram (research R3) |
| R-HSA-176187 | 176187 | Pathway | Activation of ATR in response to replication stress | The same, measured in research R1           |
| R-HSA-180024 | 180024 | Pathway | DARPP-32 events                                     | The same, another branch                    |

## Disease pathways

| Stable id     | dbId    | Class   | Name                                                                             | Why                                                |
| ------------- | ------- | ------- | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| R-HSA-5663202 | 5663202 | Pathway | Diseases of signal transduction by growth factor receptors and second messengers | A large disease pathway (dis)                      |
| R-HSA-2894858 | 2894858 | Pathway | Signaling by NOTCH1 HD+PEST Domain Mutants in Cancer                             | Disease with a diagram (dis)                       |
| R-HSA-6802957 | 6802957 | Pathway | Oncogenic MAPK signaling                                                         | A third disease pathway with its own diagram (dis) |

## Inferred (other species)

| Stable id    | dbId     | Class   | Name                                  | Why                             |
| ------------ | -------- | ------- | ------------------------------------- | ------------------------------- |
| R-MMU-69620  | 10104426 | Pathway | Cell Cycle Checkpoints (Mus musculus) | Inferred (inf), a mouse diagram |
| R-BTA-109581 | 10449731 | Pathway | Apoptosis (Bos taurus)                | Inferred (inf), a cow diagram   |

## Reactions and other events (no layout today)

| Stable id     | dbId    | Class            | Name                                                | Why                                                   |
| ------------- | ------- | ---------------- | --------------------------------------------------- | ----------------------------------------------------- |
| R-HSA-69604   | 69604   | Reaction         | Phosphorylation of CDC25A by CHEK1                  | Two reactants, two products, a catalyst (research R1) |
| R-HSA-69562   | 69562   | Reaction         | Inactivation of Cyclin E:Cdk2 complexes by p27/p21  | Measured in research R3                               |
| R-HSA-109862  | 109862  | Reaction         | MAP2K2 phosphorylates MAPK1                         | BioPAX's small case                                   |
| R-HSA-1248655 | 1248655 | Reaction         | Trans-autophosphorylation of EGFRvIII mutant dimers | A disease reaction (dis)                              |
| R-HSA-201425  | 201425  | BlackBoxEvent    | Ubiquitin-dependent degradation of the Smad complex | A black box, BioPAX's Degradation                     |
| R-HSA-8963913 | 8963913 | BlackBoxEvent    | 1,25(OH)2D translocates from cytosol to nucleus     | A black-box translocation                             |
| R-HSA-9915356 | 9915356 | FailedReaction   | ACAT1 mutants don't synthesize propionyl-CoA        | A failed reaction (dis)                               |
| R-HSA-874079  | 874079  | Polymerisation   | AIM2 oligomerizes                                   | A polymerisation, inferred (inf)                      |
| R-HSA-8952903 | 8952903 | Depolymerisation | ADPRHL2 hydrolyses poly(ADP-ribose)                 | A depolymerisation                                    |

Metabolism (R-HSA-1430728), larger still than Signal Transduction, is left out: a reference for it would be among the heaviest reads possible against the graph, and Signal Transduction already covers the largest case.
