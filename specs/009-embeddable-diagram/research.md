# Research: Embeddable Reactome pathway diagram

Every answer here was checked in the code (file:line) or against the live services on 28 Sep 2026.

## R1. What the diagram depends on, and the smallest setup for one diagram

**Decision**: embed `DiagramComponent` (`cr-diagram`, `projects/pathway-browser/src/app/diagram/diagram.component.ts`) inside a new root component. Supply it an in-memory state and a few embed-specific services through DI. Do not write a second renderer.

**Findings**:

- **`UrlStateService` is how the diagram reads and writes its state.**
  - It reads `interactorScore` (:205), `select` (:225, :1596), `analysis` (:234, :1607), `overlay` (:1599) and `flag` (:285).
  - It writes `select` (:889, :967, :1714, :1722, :1804, :1821) and `flag` (:1757, :1767).
  - It calls `navigateTo(stId)` on a double-click of a sub-pathway or interacting pathway (:862, :908), and from the popup's pathways tab (:1798).
  - `UrlStateService` injects `ActivatedRoute`, `Router` and `HttpClient` at construction (:144-146), subscribes to router events, and navigates from two effects (:257, :389). Without `provideRouter` it fails; with it, it would take over the host page's URL.
  - Everything outside it uses only its public signals plus `navigateTo`, `settle` and `ensureStId`. So it can be replaced through DI.
  - Precedent: the website's `DetailUrlState` (`website-angular/…/providers/detail-url-state.provider.ts`, provided at `detail.component.ts:45`). It has no `navigateTo`, so a double-click would throw.
- **Router**: the diagram uses it only for `router.currentNavigation()`, to set `isInitialLoad` (:148). It becomes an optional injection.
- **`EventService` must be fed.** `loadDiagram` waits on `diagramPathway$` (:803). Only the viewport (`viewport.component.ts:326`) and the render page set it, so the embed root sets it from the loaded pathway.
- **`DataStateService`** (flags, `currentPathway`) is keyed on the state's signals and can stay. Its `SpeciesService` injects `ActivatedRoute` (`species.service.ts:19`), so the embed provides a router-free species service. The detail page does the same with `DetailSpeciesService`.
- **`DarkService` would change the host page.** It writes `localStorage['is-dark']` and toggles `dark` on `<body>` (`dark.service.ts:12-29`). The embed provides a fixed or attribute-driven version that changes neither.
- **Harmless as they are**, since they're root signals that default to "off": `DeltaSignalService` (`hasOverlay` false), `DownloadService` (`downloadRequest` null, :259) and `HierarchyHoverService` (`hovered` null, :155).
- **Events**:
  - Selection and hover come out on `reactomeEvents$` (:1583): select, hover, leave.
  - There's no "loaded" signal; `cy` is set in `loadElvDiagram` (:824). The embed adds one: a `diagramLoaded` output on `DiagramComponent`, an additive change.
- **EHLD pathways** (illustrated overviews) are drawn by `cr-ehld`, not `cr-diagram`. The render page switches on `hasEHLD`. The embed does the same, second in order; see R8.

**Alternatives considered**:

- _Building on the `/render` page._ Rejected: it's a headless wrapper around `<cr-diagram>` that reads its settings once from `ActivatedRoute.snapshot` (render :88-126), polls the DOM (:252), writes `window.__renderState` (:326) and appends to `document.body` (:992). It's built for screenshots, not interaction.
- _Reusing `<pathway-browser>` (`elements.ts`)._ Rejected: it wraps the whole application with the Router, Google Analytics and ngrx.

## R2. Service addresses on a partner's page

**Decision**: the embed build uses a profile with an **absolute** Reactome host (like `production`, `environments.ts:157`), fixed per build configuration: dev, beta, production.

**Findings**:

- `host: 'origin'` resolves to `window.location.origin` (`environment.ts:55-58`). On a partner's page, that would point `CONTENT_SERVICE`, `ANALYSIS_SERVICE` (:101) and `DOWNLOAD` (:132) at the partner.
- Diagram files load from `GeneralService.download$`: the S3 base plus the release version, which comes from ContentService (`general.service.ts:32-51`).
- `ICON_BASE` is hard-coded to dev.reactome.org (:81).
- Relative `assets/…` paths (EHLD legend, `ehld.service.ts:46-67`; `analysis.service.ts:565`) would resolve against the partner's page, so they're made absolute through the build's deploy URL.

## R3. Cross-origin access to Reactome's services

**Decision**: nothing to change for the data. The embed's own files are served with `Access-Control-Allow-Origin: *`, which module scripts need.

**Measured**: read-only GETs with `Origin: https://www.alliancegenome.org`, 28 Sep:

| Endpoint                                                                        | Status                                                                  | ACAO |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---- |
| reactome.org ContentService `data/database/version`, `data/query/…/displayName` | 200                                                                     | `*`  |
| reactome.org AnalysisService (species comparison, GET)                          | 200                                                                     | `*`  |
| download.reactome.org `97/diagram/R-HSA-109581.json`                            | 200                                                                     | `*`  |
| reactome.org `download/current/diagram/…json`                                   | 200                                                                     | `*`  |
| reactome.org ContentService `exporter/reaction/{id}.svg`                        | answers with `*` (400 for a pathway id; the guard uses a real reaction) |
| beta ContentService, beta AnalysisService                                       | 200                                                                     | `*`  |

AnalysisService analyses by identifier list are `text/plain` POSTs. Those are "simple" requests, so no preflight is needed. The embed only reads existing analyses by token, so it submits nothing.

(Checking the species-comparison GET did run one small comparison on production's AnalysisService; nothing else submitted anything.)

## R4. A bundle a classic `<script>` can load from another origin

**Decision**:

1. A new application project, `reactome-diagram-element`, builds a module bundle: `index: false`, `polyfills: []`, `outputHashing: "none"`, `crossOrigin: "anonymous"`, and a per-environment `deployUrl`.
2. A small **hand-written classic loader**, `reactome-diagram.js`, not built by Angular:
   - works out its own base from `document.currentScript.src`;
   - adds the fonts and the stylesheet to the page head;
   - adds `<script type="module" src="{base}main.js">`;
   - defines `window.Reactome.Diagram` **synchronously**.

**Findings**:

- The application builder can't turn chunking off: `splitting: true` is fixed (`@angular/build/…/application-code-bundle.js:454`). The diagram tree has a lazy import (`lottie.service.ts:43`), so `main.js` imports chunks and has to be loaded as a module.
- Chunk URLs resolve against `import.meta.url`, i.e. Reactome's origin, not the host page. That works cross-origin as long as the files send CORS headers.
- `url()`s in the emitted global stylesheet resolve relative to the stylesheet itself. Inline component styles resolve against the host document, which is why `deployUrl` is needed. Known case: `url(loader.gif)` in `reactome-cytoscape-style/src/assets/index.scss:3`.
- `deployUrl` is supported and not deprecated. Its schema description names Angular Elements as the use case.
- The old widget's hosts poll `typeof Reactome` and then call `Reactome.Diagram.create` right away (AllianceGenome's `pathwayWidget.jsx`). So the loader defines `create` synchronously. It returns an object that queues method calls until `customElements.whenDefined('reactome-diagram')` resolves.
- Template: `reactome-table-wc` already registers a custom element, but it ships an unrelated hand-concatenated file (`web-component-demo/reactome-table-wc.js`, from a concat step not in this repo). The embed uses `createApplication()`, as `elements.ts` does, and a real, reproducible build.

**Alternatives considered**:

- _Requiring partners to use `<script type="module">`._ Kept as a direct option, but it can't serve old-widget hosts.
- _A single unsplit file via a custom esbuild step._ Rejected: it's outside the supported builder, and that kind of step is exactly what rotted in `reactome-table-wc`.

## R5. Style isolation

**Decision**: the embed's root component uses `ViewEncapsulation.ShadowDom`. The theme tokens are re-emitted on `:host` (and `:host(.dark)`). Material's overlays are redirected into the shadow root by a custom `OverlayContainer`. The loader puts the fonts in the page head.

**Findings**:

- Angular's shadow-DOM renderer puts every descendant component's styles into the shadow root, so Material's component CSS works.
- CSS custom properties inherit into a shadow root. The site's theme sets them on `:root` and `body.dark` (`ngx-reactome-style/src/assets/_index.scss:8`).
- The cytoscape style library reads its colours with `getComputedStyle(container)` (`reactome-cytoscape-style/src/lib/style.ts:36`), so tokens on `:host` reach it.
- `AnalysisService.style = new Style(document.body)` (:242) reads the host page's body. It falls back to defaults silently (`properties.ts:123+`). The embed gives it the element instead.
- The site's global `styles.scss` sets `body { height:100%; overflow:hidden }` (:39). It **must not** ship in the embed.
- Overlays: the diagram tree uses `matTooltip` (22 uses) and, through interactors, `MatDialog`. CDK appends overlays to `document.body` (`_overlay-module-chunk.mjs:51`), outside the shadow root, so they'd render unstyled and leak. A custom `OverlayContainer` fixes this by appending into the shadow root.
- `@font-face` inside a shadow root is ignored. Roboto, Material Symbols Rounded and Material Icons (`src/index.html:10-16`) therefore have to be registered in the document; the loader adds the `<link>`s.
- **Unverified, spiked first:** cytoscape's pointer handling inside a shadow root (task order, first task of Story 1).
- Page-level listeners the diagram registers are harmless: `window:pointermove`/`pointerup` (:698-704) and `document:keydown.escape` (entity popup :530). `window.open` from the entity popup is expected, since it's a link out.

## R6. Size

Unminified sizes from `node_modules`:

| Dependency                      | Size   |
| ------------------------------- | ------ |
| cytoscape (the fork), esm.min   | 459 KB |
| layout-base + cose-base + fcose | 324 KB |
| chroma                          | 52 KB  |
| vectorious                      | 32 KB  |
| cytoscape-layers                | 32 KB  |

Plus Angular core and the parts of Material the diagram uses, and the style library.

**Estimate**: 1.0–1.3 MB minified, 300–400 KB gzipped. **Budget**: 1.5 MB initial, and less than a third of the full site (SC-004), checked in the build.

The interactors panel pulls in forms, tabs, radio, list, a file-input package and GSA types. The embed leaves the interactors _panel_ out (it's a browser-shell control), which keeps those out of the bundle; interactors drawn _on_ the diagram stay.

## R7. CI, and testing on a page of another origin

**Decision**:

- **CI**: the unit job gains `ng build reactome-diagram-element` with the budget. Preflight runs the same build, so it can't stop building unnoticed (#339).
- **e2e**: a new Playwright spec serves a static host page from a **second local origin**, which loads the built embed from a third origin.
- Backend requests match the harness's `BACKEND` pattern whatever their origin, so they're replayed from recordings like every other test's (`e2e/support/backend.ts`).
- The spec checks, by visible outcome:
  - drawing, zoom/pan/select;
  - that the host's `location.href`, `history.length` and `scrollY` are unchanged;
  - that a hostile host style rule (`* { color: red !important; }` style) doesn't change the diagram's pixels;
  - two diagrams on one page;
  - removing the element and adding it back;
  - loading the script twice.

## R8. Order

1. **Story 1**: the element, drawing and interaction, isolation, the build, CI, the demo page. A spike on cytoscape in a shadow root comes first.
2. **Story 2**: select/flag/analysis attributes and properties, and the events. EHLD pathways here too, because partners' pathway ids include illustrated top-level pathways.
3. **Story 3**: the classic loader's `Reactome.Diagram` layer, one check per documented method and event, and a copy of AllianceGenome's integration.
4. **Story 4**: guards on exporter image addresses (a real reaction id and pathway id, each format) and on legacy `/PathwayBrowser/#/{stId}` links.

## R9. Where it's served

**Decision**:

- **Beta**: `https://beta.reactome.org/embed/diagram/v1/`. `serve-prod.js` serves the built directory statically, with `Access-Control-Allow-Origin: *`, a short cache on `reactome-diagram.js` and `main.js`, and a long cache on hashed media. nginx passes the path through; it's checked with an image rebuild and `nginx -t`.
- **reactome.org**: the same path, deployed by the release process. **The old widget's address is not replaced by this feature** (spec assumption). A demo page lives at `/embed/diagram/v1/demo.html`.
- The `v1` path segment lets the element's contract change later without breaking partners pinned to it.
