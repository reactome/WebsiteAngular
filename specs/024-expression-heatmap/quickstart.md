# Quickstart: validating the expression heatmap

## Prerequisites

- A worktree with dependencies installed (`npm ci`), and the libraries built (`npm run build:libs`).
- About 100 MB free for the human experiment file (the full table is 23 MB to download, and the written file about 25 MB).

## 1. Refresh the data (FR-013)

```bash
node tools/content-node/snapshot-expression.ts --species "Homo sapiens" --out <data dir>
```

Expected:

- the script reports 61,860 genes and 29 tissues, and that 20 sampled cells match the source;
- it writes `E-MTAB-2836.json`;
- run on a corrupted copy of the source, it refuses to write.

## 2. The service answers

Run the content service with `EXPRESSION_FILES=<data dir>`, then:

```bash
curl -s localhost:<port>/ContentService/expression/R-HSA-109606 | jq '.kind, .counts, (.rows | map(.name) | index("BCL2"))'
curl -s localhost:<port>/ContentService/expression/chebi:30616 | jq .kind          # "no-genes"
curl -s localhost:<port>/ContentService/expression/R-DME-109606 | jq .kind         # "species-not-available"
```

Expected:

- `heatmap`, with `counts.shown` at least 95% of `counts.genes`;
- BCL2 present, and none of Atlas's default genes (LINCADL, MIR1302-7) unless they belong to the pathway;
- with `EXPRESSION_FILES` unset: 503.

## 3. The values match the published table (SC-003)

The refresh step's comparison command samples 20 cells from an answer and compares them with the source table: zero differences.

## 4. The tab

Open `/PathwayBrowser/R-HSA-109606?tab=expression` (dev server or beta):

- the rows are the pathway's genes, with columns for the 29 tissues;
- hovering over or focusing BCL2 × spleen shows its five values and sample count;
- the "N of M genes shown" line lists those not shown, with reasons;
- the Network panel shows no request to `ebi.ac.uk`;
- in dark mode, the heatmap and legend are on the theme's background and the shades remain distinct;
- select ATP: "no genes with expression data", with no heatmap;
- the download holds the shown table, with the five values per cell and the experiment named.

## 5. The gates

`npm test`, `npm run e2e` (with `E2E_PORT` set in a worktree), `deploy/nginx/test-config.sh`, and `scripts/preflight.sh`: all clear.
