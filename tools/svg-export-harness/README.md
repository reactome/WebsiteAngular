# SVG export harness

Renders Reactome's legend pathway three ways — live cytoscape canvas, `cy.png()`
and `cy.svg()` — side by side, so the SVG export can be compared against what
users actually see.

`cy.svg()` is not in cytoscape.js yet. It comes from
[reactome/cytoscape.js](https://github.com/reactome/cytoscape.js), a fork this
project depends on by git URL (see `overrides.cytoscape` in package.json). The
source of that work lives on the fork's `svg-export` branch and is what will be
offered upstream; `svg-export-dist` is the same thing plus a built `dist/`,
which is what npm installs.

This harness lives here rather than in the fork because it needs
`reactome-cytoscape-style`, and a Reactome dependency has no business in a pull
request to cytoscape. The fork keeps a Reactome-free equivalent at
`debug/svg-export/`.

## Running it

```bash
npm run build:libs                       # reactome-cytoscape-style into dist/
npx esbuild tools/svg-export-harness/harness.mjs --bundle --format=esm \
  --outfile=tools/svg-export-harness/harness.bundle.js \
  --alias:reactome-cytoscape-style=./dist/reactome-cytoscape-style
npx http-server tools/svg-export-harness -p 3334 -s -c -1
```

Then open <http://127.0.0.1:3334/index.html>. The page reports how many nodes
and edges rendered and whether anything threw.

`harness.bundle.js` is generated and gitignored — it is 1.4 MB, and rebuilding
it is one command.

## Why it earns its keep

The export reuses cytoscape's own drawing code by presenting an SVG-recording
object where a canvas context is expected, so anything that renders in the
diagram should render in the export. Nothing guarantees that, which is what this
compares. It has already caught one real bug: `arcTo` was a stub emitting
straight lines, which squared off the corner of every `round-rectangle` node
while `cy.png()` showed them correctly.
