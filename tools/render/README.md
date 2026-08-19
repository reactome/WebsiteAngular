# Headless render

Renders a pathway to SVG, PNG or PDF from outside the browser, by driving the
site's own render page.

```bash
node tools/render/render.mjs --pathway R-HSA-73857 --format svg --out out.svg
node tools/render/render.mjs --pathway R-HSA-109606 --format pdf --token <analysis-token>
node tools/render/render.mjs --format svg --out genome-wide.svg     # no pathway
```

| flag        | meaning                                                  |
| ----------- | -------------------------------------------------------- |
| `--pathway` | stable id; omit for the genome-wide view                 |
| `--format`  | `svg`, `png` or `pdf` (default `svg`)                    |
| `--token`   | analysis token, to render with the analysis overlay      |
| `--base`    | site to render against (default `http://localhost:4200`) |
| `--scale`   | PNG scale factor (default 2)                             |
| `--out`     | output path                                              |

## Why this exists

Server-side artefacts are produced today by Java libraries (`diagram-exporter`,
`reaction-exporter`, `event-pdf`) that reimplement the drawing. That is why a
PDF from the content service looks like the old site, and it is a standing
source of divergence — the same class of problem as the `arcTo` stub that
squared off every rounded node in the SVG export for months.

Rendering through the site's own page means there is one renderer. Whatever a
curator sees is what the file contains.

This is deliberately **not a service**: no queue, no cache, no HTTP API. Those
are worth designing once the cost of a render and the fidelity of an analysis
overlay are known, which is what this measures.

## Measured on this host

| what                                  | time     | output               |
| ------------------------------------- | -------- | -------------------- |
| R-HSA-73857 → SVG                     | 4.6–4.9s | 707 KB, 410 elements |
| R-HSA-73857 → PNG (scale 2)           | 5.6s     | 7.1 MB               |
| R-HSA-73857 → PDF                     | 5.6s     | 344 KB               |
| R-HSA-109606 + expression token → SVG | 6.7s     | 806 KB, 431 elements |
| R-HSA-2219528 (illustration) → SVG    | 3.5s     | 246 KB               |

The analysis overlay renders correctly: not-found nodes grey, hits carrying
their expression bars in the palette colours.

## The render page

`/PathwayBrowser/render` and `/PathwayBrowser/render/:pathwayId`, from
`projects/pathway-browser/src/app/render/`. It draws the diagram, illustration
or genome-wide view with no navigation or panels, and announces completion via
`data-render-ready` on its host plus `window.__renderState`. Callers ask the
page for the artefact through `window.__renderExport`, rather than reaching into
cytoscape themselves.

Readiness is a signal, not a delay, because a diagram fetches its layout, its
overlays and its fonts and no fixed wait is both correct and quick. Two things
made that harder than expected and are worth knowing if you touch it:

- The diagram component draws the **legend** as a second cytoscape instance,
  which appears well before the pathway. Any check that accepts "a canvas exists
  inside `cr-diagram`" reports ready while the diagram is still empty.
- The diagram will not load at all until something calls
  `EventService.setDiagramPathway`, which only the viewport used to do. Without
  it the page renders the legend and nothing else.

## Two traps in the genome-wide view

Both cost time, and neither is a bug in Reacfoam.

`SvgExporterService.exportReacfoam` resolves to a **blob URL, not markup** — the
download button hands it straight to an anchor, so nothing in the app ever needed
the string. Treating the return value as SVG yields exactly 63 characters, which
is a URL. The render page fetches the blob and releases it.

Readiness has to wait for FoamTree's **geometry**, not its data. The tree holds
its groups well before relaxation has laid them out, and exporting in that window
produces a valid SVG of zero width. The check reads
`tree.get('geometry', tree.get('dataObject'))` — the same thing the exporter
reads — which is the general lesson: gate on what the consumer needs, not on a
proxy for it.
