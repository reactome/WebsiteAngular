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

## The service

`tools/render/service.mjs` serves the same renders over HTTP.

```bash
node tools/render/service.mjs
curl -o out.svg 'http://127.0.0.1:4310/render/R-HSA-73857.svg'
curl -o out.pdf 'http://127.0.0.1:4310/render/R-HSA-109606.pdf?token=<analysis-token>'
curl -o gw.svg  'http://127.0.0.1:4310/render/genome-wide.svg'
curl -s http://127.0.0.1:4310/health
```

| variable             | default               |                                                                     |
| -------------------- | --------------------- | ------------------------------------------------------------------- |
| `RENDER_PORT`        | 4310                  |                                                                     |
| `RENDER_HOST`        | 127.0.0.1             | set `0.0.0.0` only behind something that decides who may cause work |
| `RENDER_BASE`        | http://localhost:4200 | site to render against                                              |
| `RENDER_CACHE`       | `.render-cache`       |                                                                     |
| `RENDER_CACHE_KEY`   | `v1`                  | change to invalidate everything, e.g. per release                   |
| `RENDER_CONCURRENCY` | 2                     | simultaneous renders                                                |
| `RENDER_QUEUE`       | 8                     | pending renders before 503                                          |
| `RENDER_TIMEOUT`     | 45000                 | ms before a render is abandoned                                     |

### Measured behaviour

|                                        |                                           |
| -------------------------------------- | ----------------------------------------- |
| cache miss                             | 4.2–6.9s                                  |
| cache hit                              | **0.007–0.01s**, byte-identical           |
| four concurrent requests, same pathway | one render, all four served               |
| fourteen concurrent, distinct pathways | ten served, four `503` with `Retry-After` |
| unknown id                             | `404` in **0.06s**                        |
| unknown format                         | `400`, listing the formats                |

### Why it is shaped this way

**Loopback by default.** A render costs seconds, so an anonymous request must
never be able to commission one. Crawling the old
`/ContentService/exporter/*` document endpoints exhausted Tomcat's heap and took
the origin down; the network is the strongest way to decide who may cause work,
so it is the default and exposure is a deliberate act.

**The cache is the point, not an optimisation.** 5s against 7ms is the whole
argument. A diagram with no analysis token is identical for a release, so nearly
every request should be a file read. Tokens are part of the cache key rather
than a reason to skip caching — a report generator asks for the same analysis
repeatedly.

**Identical concurrent requests coalesce.** Several workers asking for the same
pathway pay for it once.

**It refuses rather than queues without limit.** Beyond two active and eight
waiting it answers 503 with `Retry-After`. A saturated renderer that says no
recovers; one holding a thousand jobs does not. Rejections are counted
separately from failures, so a busy period does not bury real errors.

**Unknown ids are rejected before a browser is involved.** Ids come from URLs,
so typos are normal rather than exceptional, and a render page asked for one
that does not resolve simply never becomes ready. One backend request costs
60ms; letting it reach the renderer costs a browser and a timeout.

### Failures are fast

An id that does not resolve, or one that is not an event at all, reports the
backend's own error in about 6s rather than costing a full timeout. That took
three attempts to get right, and the cause was not what it looked like: the wait
was gated on the pathway having finished loading, and for an id whose fetch never
settles that gate never opens — so the page neither drew nor reported, and the
caller waited two minutes to learn nothing. The wait now starts regardless and
polls, and reading a failed resource throws, which surfaces the real error.

The service also refuses unknown ids before a browser is involved, so the two
guards are independent: the page is correct on its own, and the service is cheap
on its own.
