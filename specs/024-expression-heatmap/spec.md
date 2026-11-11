# Feature Specification: An Expression Heatmap of the Selection's Own Genes

**Feature Branch**: `spec/024-expression-heatmap`

**Created**: 2026-11-10

**Status**: Draft

**Input**: The Pathway Browser's Expression tab should draw a heatmap of the selection's own genes (a pathway, reaction, complex, set or protein) across human tissues, made on the fly from Expression Atlas's published baseline experiment E-MTAB-2836 ("RNA-seq of coding RNA from tissue samples of 122 human individuals representing 32 different tissues"). The requester has worked with the downloaded dataset before.

## Background

The Expression tab embeds Expression Atlas's heatmap widget. Expression Atlas now ignores the genes it is asked about. Asked for BCL2, for a pathway's genes, or for nothing, its reference experiment answers the same "Showing 29 of 9,570 genes found" (LINCADL, MIR1302-7, DEFA1B …), on the production site and on beta alike. PR #911 brought beta back to production's behaviour, so neither site shows the selection's genes. The experiment's full table is published (on EBI's FTP, measured 2026-11-10):

- one row per gene, about 61,900 of them, each keyed by its Ensembl gene id and gene name;
- 29 tissue columns, matching the 29 tissue groups the experiment's configuration names;
- each cell holds five values across the tissue's individuals: minimum, lower quartile, median, upper quartile and maximum TPM.

What Reactome holds for a selection (measured on Intrinsic Pathway for Apoptosis, R-HSA-109606):

- its 55 gene products carry UniProt accessions only, with no gene symbol and no Ensembl id;
- its 4 gene references carry Ensembl gene ids, and all 4 are in the table.

A protein therefore has to be matched to its gene before it can be looked up.

For other species, the production site's request names only the pathway (`geneQuery=R-MMU-109606`). Expression Atlas works out the species from it and answers with its reference experiment for that species, still with its default genes:

- mouse: "RNA-seq of 6 tissues from Mus musculus to investigate the evolution of gene expression levels in mammalian organs", 48 of 7,442 genes;
- fly: "RNA-seq of coding RNA from 22 wild-type strains of Drosophila melanogaster … at embryonic time point 10-12 hrs", strains rather than tissues.

The principle of showing the species on screen is kept here. The experiment, though, is chosen for the question this tab asks (where in the body a gene is expressed), not taken from Atlas's choice of reference.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - See where a selection's genes are expressed (Priority: P1)

A researcher opens a pathway (or selects a reaction, complex, set or protein inside it) and opens the Expression tab. They see a heatmap: one row per gene of the selection, one column per tissue, each cell shaded by the gene's median expression in that tissue, with the genes named. They can tell at a glance which of the selection's genes are expressed where, for example that a pathway's caspases are high in spleen and low in brain.

**Why this priority**: this is the tab's purpose, and today it does not deliver it on either site.

**Independent Test**: open R-HSA-109606's Expression tab. The rows are that pathway's genes (BCL2, BAX, CASP9 among them) and none of Atlas's default list (LINCADL, MIR1302-7). BCL2's median in each tissue matches the published table.

**Acceptance Scenarios**:

1. **Given** a human pathway is open with nothing selected, **When** the Expression tab opens, **Then** the heatmap has one row for each of the pathway's genes found in the experiment, one column per tissue, and each cell is shaded by that gene's median TPM in that tissue.
2. **Given** a complex inside the pathway is selected, **When** the Expression tab is open, **Then** the heatmap shows only that complex's genes, and changing the selection redraws it for the new selection.
3. **Given** a single protein is selected (BCL2), **When** the Expression tab is open, **Then** the heatmap has one row, BCL2.
4. **Given** the heatmap is shown, **When** it is compared with the published table, **Then** every shown cell's median equals the table's value for that gene and tissue.

---

### User Story 2 - Read a value and how much it varies (Priority: P2)

Hovering over a cell, or focusing it by keyboard, shows its gene, its tissue, the median TPM, the spread across the tissue's individuals (minimum, quartiles, maximum) and how many individuals the tissue's value comes from.

**Why this priority**: a shade alone can't say whether a tissue's value is consistent or driven by one sample, and researchers check the numbers before citing them.

**Independent Test**: hover over BCL2 × spleen. The five values and the number of individuals shown equal the table's and the experiment's.

**Acceptance Scenarios**:

1. **Given** the heatmap is shown, **When** the reader hovers over or focuses a cell, **Then** the gene, tissue, median, minimum, quartiles, maximum and number of individuals are shown.
2. **Given** the heatmap is shown, **When** the reader looks at the legend, **Then** it states the unit (TPM), the scale and the shade for "not expressed".

---

### User Story 3 - Know what is missing, and why (Priority: P2)

Below the heatmap the tab says how many of the selection's genes are shown. It names those not in the experiment and those that could not be matched to a gene. A selection with no genes (a chemical, say) says so plainly, as it does today.

**Why this priority**: a heatmap that silently drops genes reads as complete. Researchers need to know whether a missing gene is unexpressed or simply not measured.

**Independent Test**: on R-HSA-109606 the tab says "N of M genes shown" and lists any not shown, each with its reason. Selecting ATP shows "no genes with expression data" and no heatmap.

**Acceptance Scenarios**:

1. **Given** some of the selection's genes are not in the experiment, **When** the heatmap is shown, **Then** the tab says how many are shown out of how many and names the others, with the reason for each.
2. **Given** the selection has no genes, **When** the Expression tab is open, **Then** the tab says it has no genes with expression data and draws nothing.

---

### User Story 4 - Take the numbers away (Priority: P3)

A researcher downloads the selection's expression table (genes × tissues, with the five values per cell, and a note naming the experiment and its release) to use in their own analysis.

**Why this priority**: useful, and cheap once the data is on hand, but the heatmap alone already meets the need.

**Independent Test**: download from R-HSA-109606's tab. The file has one row per shown gene and the same values as the heatmap, and it names E-MTAB-2836.

**Acceptance Scenarios**:

1. **Given** the heatmap is shown, **When** the reader downloads it, **Then** the file holds exactly the shown genes and tissues, with the five values per cell, and names the experiment and where it came from.

---

### User Story 5 - Other species, from their own tissues (Priority: P3)

A researcher on a mouse pathway sees the same kind of heatmap, made from a mouse tissue experiment: that experiment's own tissues, named, with the experiment and its design stated (six tissues, say, where human has 29). A species with no suitable tissue experiment says so. It gets no heatmap of something else, such as strains at one embryonic stage, and no heatmap of human data.

**Why this priority**: most readers open human pathways, and the human heatmap stands on its own. Each further species needs its own experiment chosen and checked.

**Independent Test**: open R-MMU-109606's Expression tab. The rows are that pathway's mouse genes and the columns are the chosen mouse experiment's tissues, and the tab names the experiment. Open a pathway of a species not on the list: the tab says expression is not available for that species.

**Acceptance Scenarios**:

1. **Given** a pathway of a species on the list is open, **When** the Expression tab opens, **Then** the heatmap is drawn from that species' listed experiment, its tissues are named, and the tab names the experiment and states its design.
2. **Given** a pathway of a species not on the list is open, **When** the Expression tab opens, **Then** the tab says expression is not available for that species, names no experiment and draws nothing.

---

### User Story 6 - See it on a body (Priority: P2)

Beside the heatmap, an outline of a human body (male, female, or the brain) shows the tissues as organs, as the production site's Expression Atlas widget did. Pointing at a gene shades each organ by that gene's median in its tissue, on the heatmap's scale. Pointing at a tissue column, or at an organ, picks out that organ and that column together.

**Why this priority**: readers find "spleen and lymph node" faster on a body than in a column of 29 labels, and the production tab had the figure, so its absence reads as a loss.

**Independent Test**: point at BCL2's row on R-HSA-109606. The organs are shaded by BCL2's medians: spleen and lymph node darker than liver. Point at the spleen: the spleen column is picked out. Switch to the female figure: endometrium, ovary, fallopian tube and placenta are drawn; prostate and testis are not.

**Acceptance Scenarios**:

1. **Given** a heatmap is shown, **When** the reader points at or focuses a gene, **Then** each of the experiment's tissues is shaded on the figure by that gene's median, on the heatmap's scale, and the other organs are left unshaded.
2. **Given** a figure is shown, **When** the reader points at an organ that is one of the experiment's tissues, **Then** its tissue column is picked out on the heatmap, and its name is shown.
3. **Given** the dark theme, **When** the figure is shown, **Then** its outline and unshaded organs use the theme's colours.

---

### Edge Cases

- **Large selections**: Signal Transduction has thousands of genes. The heatmap shows them all without freezing the page, ordered, with the gene names readable when zoomed or scrolled. See FR-006.
- **Non-human species**: only the species on the list get a heatmap, each from its own experiment, and the others say so. Human data is never shown for another species' genes. See FR-010.
- **One gene, several rows**: a protein whose gene has more than one Ensembl id, or several proteins (isoforms) of one gene, appears once, as its gene.
- **Unmatched genes**: a gene product with no matching gene, or a gene the experiment does not include, is listed as not shown, with its reason (FR-007), and is never drawn as zero.
- **Unavailable data**: the expression data can't be loaded. The tab says so and draws nothing. It never falls back to Atlas's default heatmap.
- **Narrow panel**: the details panel can be dragged narrow. The tissue columns stay readable, or scroll, and are never squashed into unreadable slivers.
- **Tissues with no organ in a figure**: prostate and testis are in the male figure only, and endometrium, ovary, fallopian tube and placenta in the female one only. A tissue the figure shown lacks is not drawn on it, and the heatmap still has its column.
- **Species without a figure**: the heatmap is drawn without one (FR-015).
- **Selection changes**: a new selection replaces the heatmap. The last selection's heatmap never stays under the new selection's name (as #911 fixed for the widget).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The Expression tab MUST draw a heatmap of the selection's own genes across the experiment's tissues: one row per gene, one column per tissue, each cell shaded by the gene's median TPM in that tissue. It MUST NOT show Expression Atlas's default heatmap or its widget.
- **FR-002**: The genes MUST be the selection's genes and gene products. Proteins and isoforms are matched to their genes, and gene references are used directly. Chemicals and drugs are left out. Each gene appears once, however many of the selection's entities point at it.
- **FR-003**: Every value shown MUST equal the published table's value for that gene and tissue. Nothing is interpolated, imputed or rescaled, except for the shading scale itself.
- **FR-004**: Each cell MUST show its gene, tissue, median, minimum, quartiles, maximum and number of individuals on hover and on keyboard focus.
- **FR-005**: A legend MUST state the unit (TPM), the scale, and the shade for "not expressed" (zero). Values span about 0 to several thousand TPM, so the scale is logarithmic.
- **FR-006**: Rows MUST be ordered so that genes expressed alike sit together, and the reader MUST be able to sort them by name instead. A selection of thousands of genes MUST draw without blocking the page.
- **FR-007**: The tab MUST say how many of the selection's genes are shown out of how many, and name each one not shown with its reason: not in the experiment, or no gene matched.
- **FR-008**: A selection with no genes MUST say so and draw nothing. Expression data that can't be loaded MUST be said, and nothing drawn.
- **FR-009**: The reader MUST be able to download the shown table: genes × tissues, with the five values per cell, naming the experiment, its source and the release of the data.
- **FR-010**: The heatmap MUST use an experiment of the species on screen. Homo sapiens uses E-MTAB-2836. Other species MUST each use the tissue experiment named for them in a short, hand-kept list, chosen because it measures tissues; Expression Atlas's choice of reference is not enough on its own. The tab MUST state the experiment's design (its tissues and how many). A species not on the list MUST say that expression is not available for it, and draw nothing. Human data MUST never be shown for another species' genes. (Decided with the requester, 2026-11-10: the production site's principle of using the species on screen, with the experiments chosen deliberately.)
- **FR-011**: The experiment's data MUST be served by this site and loaded only when the Expression tab is opened. No request goes to a third party when the tab is used, and nothing is loaded for readers who never open the tab.
- **FR-012**: The tab MUST name its source: the experiment (its accession, such as E-MTAB-2836, and its title), with a link to it on Expression Atlas, and the data's release date.
- **FR-013**: The data MUST be refreshable from the published table by a documented step, and the step MUST check what it produces: the gene and tissue counts, and a sample of genes compared with the published values.
- **FR-014**: The heatmap, its legend, its labels and its hover details MUST follow the site's light and dark themes. Its shades MUST stay distinguishable in both, and "not expressed" MUST read as such in both. (Expression Atlas's widget keeps its own background in dark mode, as the requester saw on beta, 2026-11-10.)
- **FR-015**: Beside the heatmap, the tab MUST show the species' anatomogram (for human: male, female and brain, chosen by the reader), each of the experiment's tissues matched to its organ by its anatomy id (UBERON). With a gene pointed at or focused, each matched organ MUST be shaded by that gene's median on the heatmap's scale. A species with no figure shows the heatmap alone.
- **FR-016**: Pointing at a matched organ MUST pick out its tissue column on the heatmap, and pointing at a tissue column MUST pick out its organ.
- **FR-017**: The figures MUST be served by this site, loaded only when the tab is opened, and attributed as Expression Atlas's licence asks. They MUST follow the light and dark themes, as FR-014 asks of the heatmap.

### Key Entities

- **Experiment**: one per listed species (E-MTAB-2836 for Homo sapiens). Its title, its design, its tissues (each with its name and number of individuals), its source and its release date.
- **Gene expression**: one gene (Ensembl gene id, gene name) × one tissue. Five values: minimum, lower quartile, median, upper quartile and maximum TPM.
- **Selection's genes**: the genes drawn for the current selection, each traced back to the selection's entities that point at it, plus the selection's entities not shown and why.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For any human pathway, the heatmap's rows are that pathway's genes. None of Expression Atlas's default genes appears unless it belongs to the selection. Checked on at least three pathways of different sizes.
- **SC-002**: At least 95% of the gene products in Homo sapiens pathways are matched to a gene that the experiment includes. The rest are listed as not shown, with a reason.
- **SC-003**: Every value on show matches the published table. Checked on a sample of at least 20 gene × tissue cells.
- **SC-004**: The heatmap for a pathway of 100 genes appears within 2 seconds of opening the tab on a typical connection. One of 2,500 genes appears within 5 seconds, without freezing the page.
- **SC-005**: Opening any page that doesn't show the Expression tab loads none of the expression data.
- **SC-006**: A researcher can name the experiment, the unit and a cell's spread from the tab alone, without leaving the site.

## Assumptions

- **One experiment per species**: E-MTAB-2836 for human, the baseline reference that Expression Atlas itself chooses for this heatmap. Choosing among several experiments for one species (GTEx, the Human Protein Atlas …) is out of scope.
- **Which species**: which species have a suitable tissue experiment, and which one, is found out in planning. It is not assumed here. Human ships first (User Story 1). Further species follow as User Story 5, one at a time.
- **Median in the cell**: the median TPM is the cell's value, and the spread is shown on hover, as Expression Atlas does.
- **Matching proteins to genes**: proteins are matched to genes through Reactome's own gene references where it holds them, and otherwise through a published UniProt-to-Ensembl mapping, chosen in planning. SC-002 measures how well it works.
- **Static between releases**: the experiment's table changes rarely. It is refreshed by the documented step (FR-013), not fetched live.
- **Replacing the widget**: the embedded Expression Atlas widget and its bundles are removed from the tab, along with the CDN font they asked for. The link to Expression Atlas (FR-012) remains.
- **Anatomograms**: Expression Atlas's own figures (the `@ebi-gene-expression-group/anatomogram` package, Apache-2.0; the figures CC BY 4.0 under Expression Atlas's licence). All 29 of E-MTAB-2836's tissues have an organ in the human figures, matched by the UBERON ids in the experiment's sample file (measured 2026-11-10).
- **Licence**: Expression Atlas data is assumed to be reusable with attribution (FR-012). The exact terms are to be confirmed from EBI's published terms in planning, before any data is served.
