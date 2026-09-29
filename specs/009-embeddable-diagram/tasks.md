---
description: 'Task list for the embeddable Reactome pathway diagram'
---

# Tasks: Embeddable Reactome pathway diagram

**Input**: Design documents from `specs/009-embeddable-diagram/`: plan.md, spec.md, research.md (R1–R9), data-model.md, contracts/, quickstart.md.

**Tests**: Required. Per the constitution (III), every behaviour gets a test that's **shown failing first**, and the task says what it fails against.

**Conventions for every shell step**:

- Run `export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"` first.
- Run e2e with `E2E_PORT=4330`.
- Never pass `--no-verify` on a final commit.
- Push with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=20"`.
- **Each phase is its own PR**: red proof, adversarial review by a subagent, CI green, squash-merge, `npm run build:beta` (plus a compose rebuild where nginx changes), then verify on beta by visible outcome after checking beta's `/health` bundle postdates the merge.

**Paths**:

- `EL` = `projects/reactome-diagram-element/src`
- `PB` = `projects/pathway-browser/src/app`

## Phase 1: Setup

- [ ] T001 Create project `reactome-diagram-element` in `angular.json`, with:
  - builder `@angular-devkit/build-angular:application`;
  - `browser: projects/reactome-diagram-element/src/main.ts`, `index: false`, `polyfills: []`;
  - `outputPath: dist/reactome-diagram`, `outputHashing: "none"`, `namedChunks: false`, `crossOrigin: "anonymous"`;
  - `styles: [projects/reactome-diagram-element/src/theme.scss]`;
  - `assets`: `dist/reactome-cytoscape-style/assets` (loader media), `projects/reactome-diagram-element/src/loader/reactome-diagram.js` and `projects/reactome-diagram-element/demo.html` to the output root;
  - `allowedCommonJsDependencies`: cytoscape, cytoscape-fcose, lodash;
  - configurations `development` (`deployUrl: http://localhost:4340/`), `beta` (`deployUrl: https://beta.reactome.org/embed/diagram/v1/`) and `production` (`deployUrl: https://reactome.org/embed/diagram/v1/`);
  - production budget `initial` warn 1.2 MB, error 1.5 MB.
- [ ] T002 Create `projects/reactome-diagram-element/tsconfig.app.json`, extending the root `tsconfig.json` with `files: [src/main.ts]`. Confirm `npm run check:types`, lint's project service and `knip.json` pick up the new project (add `projects/reactome-diagram-element/src/main.ts` to knip `entry`).
- [ ] T003 [P] Add an embed site profile in `projects/website-angular/src/config/environments.ts`. Its `host` is absolute per configuration: `https://reactome.org` for production, `https://beta.reactome.org` for beta, `http://localhost:4330` for development and e2e; never `origin` (R2). Select it through the build's `define`/`fileReplacements` in T001.

## Phase 2: Foundational (blocks every story)

- [x] T004 **Spike (first task, decides the approach)**: in a throwaway page under `projects/reactome-diagram-element/spike/`, not shipped, mount a cytoscape instance, drawing one Reactome diagram via `reactome-cytoscape-style`, inside an open shadow root. Check with Playwright that:
  - wheel zoom, drag pan, node click select and hover all fire and render;
  - `renderedPosition` hit-testing is correct at a non-zero page scroll offset.

  Record the result in `research.md` R5, replacing "unverified". **If it fails**, stop and revise the plan: the alternative is emulated encapsulation with a prefixed host class. Delete the spike before the Story 1 PR.

- [x] T005 Extract a `PathwayState` abstract class token in `PB/services/pathway-state.ts`. It carries the read and write surface the diagram chain uses: the `pathwayId`, `select`, `flag`, `flagInteractors`, `analysis`, `overlay`, `interactorScore`, `speciesFilter`, … signals, plus `navigateTo`, `settle` and `ensureStId`, taken from research R1's list.
  - `UrlStateService` extends or implements it, and is provided as `{provide: PathwayState, useExisting: UrlStateService}` where the app provides it.
  - Change the diagram chain's `inject(UrlStateService)` to `inject(PathwayState)` **only** where the embed needs it: `diagram.component.ts`, `DataStateService`, `AnalysisService`, `InteractorService`, entity popup.
  - Gate: unit tests, `check:types`, the app build and the full e2e suite all pass unchanged. The site behaves identically.
  - **As built**: no `PathwayState` token. `MemoryState` implements `Pick<UrlStateService, keyof UrlStateService>`, built from the same `createStateValues()` factory, and is provided as `UrlStateService` via `useExisting`. The compiler then holds the two in step without touching the site's injection points.
- [x] T006 In `PB/diagram/diagram.component.ts`:
  - inject `Router` with `{optional: true}` and treat its absence as `isInitialLoad = true` (:148);
  - add a `diagramLoaded = output<string>()`, emitted when `cy` is ready after `loadElvDiagram` (:824) with the stable id drawn.

  Additive only. Add an e2e assertion in `e2e/diagram-behaviour.spec.ts` that the site's diagram still loads. Run the suite.

**Checkpoint**: the site is unchanged. Phase 1+2 ship inside the Story 1 PR.

## Phase 3: User Story 1: a live diagram on a partner page (P1, MVP) 🎯

**Goal**: one script and one `<reactome-diagram pathway="…">` on a page of another origin draws a live, interactive diagram, and leaves the host untouched.

**Independent test**: quickstart's "See it on a page of another origin", automated as `e2e/embed-diagram.spec.ts`.

### Tests first (each written and shown failing before its implementation)

- [x] T007 [US1] Create host pages in `specs/009-embeddable-diagram/host-page/`:
  - `index.html`: the classic loader and one `<reactome-diagram pathway="R-HSA-69620">` (look the id up in the local backend and use a real pathway that has a diagram and no EHLD);
  - `two.html`: two elements, different pathways;
  - `hostile.html`: host CSS `* { font-family: serif !important; color: red !important; background: yellow !important; }`, `div { border: 3px solid lime !important }` and `canvas { opacity: .2 !important }`;
  - `twice.html`: the loader included twice.
- [x] T008 [US1] Add a static server helper to `e2e/support/`. It's a node script, no new dependency. It serves `dist/reactome-diagram/browser` on port 4340 with `Access-Control-Allow-Origin: *` and the host pages on 4341, and is started as extra Playwright `webServer` entries only for `embed-diagram.spec.ts` (or a dedicated project). The spec asserts `new URL(page.url()).origin !== embed origin !== data origin` before anything else (constitution I).
- [x] T009 [US1] Write `e2e/embed-diagram.spec.ts` "draws and responds", on `index.html`. It checks:
  - the element's shadow root contains a cytoscape canvas;
  - the diagram draws (the element's `diagramloaded` event, with the stable id);
  - wheel zoom changes `cy.zoom()`, drag pans, clicking a node selects it.

  It reaches `cy` through a test-only hook on the element (`__cy` in development builds only). Shown failing before T013.

  Also "click after the host page scrolls": scroll the host page after the first interaction, then click a second node. It must select that node. **Red** without T015's document scroll listener: the spike (research R5) reproduced it, where the click selected nothing.

- [x] T010 [P] [US1] Spec "leaves the host alone": capture `location.href`, `history.length`, `document.title`, `scrollY`, `localStorage` keys and `document.body.className`/`style.cssText`, before and after drawing, zooming, selecting and double-clicking a sub-pathway. All must be identical.
  - **Red**: show it failing against a deliberately wrong build that provides the real `UrlStateService` and `DarkService`. Record the failing assertion in the PR.
- [x] T011 [P] [US1] Spec "styles do not cross": screenshot the element on `index.html` and on `hostile.html` and require them pixel-identical. Also check that the host page's own `h1` keeps its colour after the element loads (nothing leaks out).
  - **Red**: against a build with `ViewEncapsulation.Emulated` on the root.
- [x] T012 [P] [US1] Specs:
  - "two diagrams are independent", on `two.html`: selecting in one leaves the other unselected, and each emits its own events.
  - "remove and re-add": remove the element, add it back, and it draws again with no console errors (the harness's Angular-error guard applies).
  - "loaded twice is harmless", on `twice.html`: no `customElements.define` error, one registration.
  - "fails readably": an unknown pathway id shows the not-found message in the box and fires `diagramerror` `{reason:'not-found'}`, and the host page still runs.

### Implementation

- [x] T013 [US1] Write `EL/memory-state.ts`, a `MemoryState` that extends `PathwayState`:
  - it holds signals only;
  - `navigateTo(id)` sets `pathwayId` (and emits nothing to history);
  - `settle()` resolves;
  - `ensureStId` normalises a dbId via ContentService (constitution IV).
  - **As built**: see T005. `navigateTo` sets `pathwayId` and clears `select`.

  Comment: what the real one does on a host page (it takes over the URL).

- [x] T014 [P] [US1] Write `EL/embed-providers.ts` with:
  - `{provide: PathwayState, useClass: MemoryState}`;
  - a fixed `DarkService` subclass that never touches `localStorage` or `body` (R1), reading the `theme` attribute later;
  - a router-free `SpeciesService`, modelled on the website's `DetailSpeciesService`;
  - `AnalysisService`'s style source pointed at the element, not `document.body` (research R5, `analysis.service.ts:242`), via a provider or setter;
  - `EL/shadow-overlay-container.ts` provided as `OverlayContainer`, appending into the element's shadow root.
  - **As built**: the AnalysisService style source was not repointed; it still reads `getComputedStyle(document.body)` on the partner's page. Nothing in Story 1 shows an analysis overlay, so it moves to T029. Also added: `ShadowRootsOnlyStylesHost`, so component styles go only into the elements' shadow roots and never the partner's `<head>` (found in review), and `APP_ID` `reactome-diagram`, so a partner's server-rendered Angular styles aren't adopted.
- [x] T015 [US1] Write `EL/diagram-element.component.ts`, with `ViewEncapsulation.ShadowDom`. It:
  - takes inputs `pathway`, and later `select`, `flag`, `analysisToken`, `theme` (attributes via `createCustomElement` input mapping);
  - provides `embedProviders` at component level (**one injector per element**, which satisfies T012);
  - pushes `pathway` into `MemoryState.pathwayId`;
  - feeds `EventService.setDiagramPathway` from `DataStateService.currentPathway`;
  - renders `<cr-diagram>`, without `cr-interactors`, the panel being shell UI (R6);
  - maps `diagramLoaded` and `reactomeEvents$` select/hover to `CustomEvent`s (`bubbles: true, composed: true`) per `contracts/reactome-diagram-element.md`;
  - shows an in-box message and fires `diagramerror` on load failure;
  - defaults to 800×500 when unsized.
  - listens for `scroll` on `document` (`{capture: true, passive: true}`) and calls `cy.resize()`, at most once per animation frame, removed on destroy. Cytoscape's own ancestor scroll listeners stop at the shadow root (research R5), so without this a click after the page scrolls lands in the wrong place. The comment says so.
- [x] T016 [P] [US1] Write `EL/theme.scss`: the `ngx-reactome-style` theme tokens re-emitted on `:host` and `:host(.dark)`, plus sizing (`:host{display:block;contain:content}`). **Not** the site's global `styles.scss`, which sets `body{overflow:hidden}` (R5).
  - **As built**: in `EL/diagram-element.component.scss`; `ngx-reactome-style`'s theme mixin takes the selectors as parameters, and the diagram controls' styles are a shared `diagram-controls` mixin (site CSS verified byte-identical).
- [x] T017 [US1] Write `EL/main.ts`:
  - `createApplication({providers: [provideZonelessChangeDetection(), provideHttpClient()]})`;
  - register the icon font alias `symbols`;
  - `if (!customElements.get('reactome-diagram')) customElements.define('reactome-diagram', createCustomElement(DiagramElementComponent, {injector}))`.
- [x] T018 [US1] Write `EL/loader/reactome-diagram.js`, hand-written ES2017 with no imports and under 3 KB. It:
  - derives `base` from `document.currentScript.src`;
  - once only, adds `<link>`s for Roboto, Material Symbols Rounded and Material Icons (the URLs from `src/index.html`) and `base+'styles.css'`, then `<script type="module" src=base+'main.js' crossorigin>`;
  - guards against double inclusion with a `window.__reactomeDiagramLoader` flag.
  - **As built**: no `styles.css` (the element's styles are in its shadow root) and no window flag; a second copy recognises the module script the first added (`script[data-reactome-diagram]`). The wrapper element holds its view in its own shadow root and takes a property set before upgrade.

  Its comment carries the failure: a classic tag can't load the builder's chunked module output (R4).

- [x] T019 [US1] Run `npx ng build reactome-diagram-element --configuration production`. Record in the PR:
  - the real size, gzipped, from the output files;
  - that it's under a third of the `reactome` initial bundle (SC-004);
  - that the budget error fires if the budget is set below the actual size (red proof for the budget).
  - **Result**: 1.57 MB raw / 394 KB gzipped, about 37% of the site: SC-004 is **missed**. Budget set at warn 1.65 MB / error 1.8 MB; slimming is #356.
- [x] T020 [US1] Add a CI build to `.github/workflows/tests.yml` (unit job, after `build:libs`): `npx ng build reactome-diagram-element --configuration production`. Add the same build as a step in `scripts/preflight.sh`, in full mode, to a temp output path.
  - **Red**: introduce a type error in `EL/diagram-element.component.ts` on a throwaway commit, and show preflight and CI both fail. Revert.
- [x] T021 [US1] Serve on beta:
  - `projects/website-angular/src/scripts/serve-prod.js` serves `dist/reactome-diagram/browser` at `/embed/diagram/v1/`, with `Access-Control-Allow-Origin: *`, `Cache-Control: no-cache` for `*.js`, and long cache for media;
  - `deploy/nginx` passes `/embed/` to serve-prod;
  - `npm run build:beta` also builds the embed with `--configuration beta`;
  - rebuild with `docker compose build nginx`, then `docker compose run --rm --no-deps --entrypoint nginx nginx -t`, then `docker compose up -d --no-deps nginx`.
  - **As built**: nginx needed no change: `/embed/` already reaches serve-prod through `location /`. The route answers a missing file with a plain 404, not the site's page. Deploy is `~/rebuild-beta.sh` plus a serve-prod restart.
- [x] T022 [US1] Write `projects/reactome-diagram-element/demo.html`: the partner-facing demo, a plain page using the classic loader and one element, with a pathway picker changing the `pathway` attribute. It's copied to the output root.
- [x] T023 [US1] Run the full gates:
  - unit tests, types, lint (per-rule ratchet unchanged), dead code, format, `check:har`;
  - the app build and the embed build;
  - the full e2e suite, plus `embed-diagram.spec.ts` (T009–T012 all green, each red proof recorded).
- [ ] T024 [US1] Open the PR. Run an adversarial review subagent covering:
  - host-page side effects;
  - the per-element injector;
  - overlay escape;
  - fonts;
  - CORS on the served files;
  - chunk URL resolution with `deployUrl`.

  Get CI green, merge, deploy (`npm run build:beta` and the nginx rebuild). **Verify on beta** from a page on another origin (a local host page pointing at `https://beta.reactome.org/embed/diagram/v1/reactome-diagram.js`): it draws, interaction works, and the response headers carry `Access-Control-Allow-Origin: *`. Open `https://beta.reactome.org/embed/diagram/v1/demo.html` too.

**Checkpoint**: MVP. Any partner can embed a live diagram by pathway.

## Phase 4: User Story 2: highlighting and events (P2)

**Goal**: `select`, `flag`, `analysis-token`/`analysis-resource` and `theme` work, and events are emitted, per `contracts/reactome-diagram-element.md`. EHLD pathways draw too.

**Independent test**: the Story 2 acceptance scenarios, in `e2e/embed-diagram.spec.ts`.

### Tests first

- [x] T025 [P] [US2] Spec "flag": `flag="<a gene in the pathway>"` flags the same elements as the Pathway Browser's `?flag=` for that pathway and term. Compare the element's flagged element ids with the site's, same recording. Clearing the attribute unflags and fires `flagcleared`. Red before T029.
- [x] T026 [P] [US2] Spec "select": `select="<an entity stId in the diagram>"` selects it and brings it into view. Clicking another fires `entityselected` with that stable id. Clearing it deselects. Red before T029.
- [x] T027 [P] [US2] Spec "analysis": `analysis-token` set to a token recorded in an existing analysis-results HAR (read only; submit nothing) shows the overlay, as the site does for the same token. Removing it clears the overlay and fires `analysiscleared`. Red before T029.
  - **As built**: token `MjAyNjA5MjUxNDM3NThfMTM=`, an existing local result (read only); the element's overlaid-node count equals the site's for the same token.
- [x] T028 [P] [US2] Specs:
  - "EHLD": a top-level pathway with an illustration draws the illustration in the element, then fires `diagramloaded`.
  - "theme": `theme="dark"` switches colours, checked by pixels differing from light.
  - "dbId": `pathway="<its dbId>"` loads, and the event carries the stable id.

### Implementation

- [x] T029 [US2] In `EL/diagram-element.component.ts`:
  - map the `select`, `flag`, `analysisToken`/`analysisResource` and `theme` inputs to `MemoryState` (and the fixed `DarkService`);
  - add `fit()`, `resetSelection()`, `resetFlag()` and `resetAnalysis()` as element methods;
  - emit `flagcleared`/`analysiscleared` when state clears, from code or from the legend;
  - emit `entityhovered`.
  - Also: point `AnalysisService`'s style source at the element instead of `document.body` (moved from T014).
  - **As built**: the analysis palette reads its tokens from a `STYLE_ROOT` token (the element's host in the embed, `document.body` on the site). `entityselected` reports what is selected ~20ms after a change, so a click from one entity to another is one event, not a null then the new one. Removing `select`, or `resetSelection()`, also clears a selection the reader made -- the diagram leaves the last one drawn when the state is cleared.
- [x] T030 [US2] Draw EHLD pathways: switch on `hasEHLD` as the render page does, rendering `cr-ehld`. Make `ehld.service.ts`'s relative `assets/…` paths (:46-67) absolute via the deploy URL.
  - **As built**: `cr-ehld` inside a small `reactome-illustration` wrapper under `@defer`, a 92 KB lazy chunk; the wrapper gives it a stand-in SVG exporter, since the real one brings Reacfoam, a root service reading the address. The kind (diagram/illustration) holds through a pathway switch until the next answer. Legend arrows come from an `EHLD_LEGEND_BASE` token, beside main.js in the embed; the images are copied into the build.
- [ ] T031 [US2] Run the gates and the full e2e suite. Open the PR, with review focused on state-clearing paths, event shapes against the contract, and EHLD asset URLs. CI green, merge, deploy. Verify on beta with the demo page's flag, select and theme controls. Add those controls to `demo.html` in T029.

## Phase 5: User Story 3: the old `Reactome.Diagram` interface (P2)

**Goal**: `window.Reactome.Diagram.create(...)` and every documented method and handler work, per `contracts/legacy-widget-api.md`.

**Independent test**: AllianceGenome's integration, copied, works unchanged except for the script address. Each method and handler has its own check.

### Tests first

- [ ] T032 [US3] Create `specs/009-embeddable-diagram/host-page/alliance.html`: AllianceGenome's `pathwayWidget` pattern reproduced in plain JS.
  - Poll `typeof Reactome` once a second, up to 15 times.
  - Call `Reactome.Diagram.create({placeHolder: 'reactomePathwayHolder', width: 1130, height: 600})`, then `.loadDiagram(stId)`.
  - Switch pathway from a dropdown.
- [ ] T033 [US3] Write `e2e/embed-legacy-api.spec.ts`, one test per method and per handler from the contract table. Each is **written and run red before its implementation**, and the PR lists each red result. Also:
  - "create before ready": calls made synchronously after `create` are queued and applied;
  - "polling host": `alliance.html` finds `Reactome` on its first poll after the loader runs, and draws at 1130×600.

### Implementation

- [ ] T034 [US3] In `EL/loader/reactome-diagram.js`, define `window.Reactome.Diagram` synchronously:
  - `create(opts)` appends a sized `<reactome-diagram>` to `document.getElementById(opts.placeHolder)` and returns an object;
  - the object queues calls until `customElements.whenDefined('reactome-diagram')`;
  - its methods map to the element per the contract;
  - `onX(fn)` adds listeners for the mapped events, unwrapping `detail` to the old argument shapes;
  - `proxyPrefix` is accepted and ignored.

  Keep the queue and mapping in small pure functions, unit-tested in `projects/reactome-diagram-element/src/loader/legacy-api.spec.mjs`. vitest's include covers `projects/**`.

- [ ] T035 [US3] Implement `highlightItem`/`resetHighlight` as a new element method pair, `highlight(id)`/`resetHighlight()`, which makes the entity stand out as a hover does without selecting it, via the diagram's hover path. Add it to the element contract.
- [ ] T036 [US3] Run the gates and both embed specs. Open the PR, with review focused on queue ordering, handler argument shapes against the old docs, and the synchronous global. CI green, merge, deploy. Verify on beta with `alliance.html` pointing at beta's script (served locally, so from another origin).

## Phase 6: User Story 4: partner image addresses and links (P3)

**Goal**: the image addresses and old-form links partners use keep working, guarded by tests.

- [ ] T037 [US4] Look up a real **reaction** stId and a real **pathway** stId in the local backend. R-HSA-109582 is a pathway, and the reaction exporter returned 400 for it. Record them.
- [ ] T038 [US4] Write `e2e/partner-links.spec.ts`. Against the e2e server:
  - `/ContentService/exporter/reaction/{reaction}.svg` and `.png`, and `/ContentService/exporter/diagram/{pathway}.svg`, `.png` and `.jpg`, each return that image type. Check magic bytes, not status alone (constitution I). Where the render service is needed, reuse `renderServiceAvailable()` so it runs live in preflight and skips in CI, and add the skips to `e2e/expected-skips.json` with reasons.
  - `/PathwayBrowser/#/{pathway}` opens that pathway. Reuse `legacy-links.spec` patterns.

  Show each failing against a wrong id first.

- [ ] T039 [US4] Run the gates. Open the PR, review, CI green, merge.

## Phase 7: Close-out

- [ ] T040 Write the partner embedding guide, replacing the content of `ANGULAR_ELEMENTS_SETUP.md`, or as `docs/embedding-the-diagram.md` linked from it. It covers:
  - both script forms;
  - the element's attributes, methods and events (from the contract);
  - the old-interface migration: change one URL;
  - the strict-security allow-list: script-src, style-src, font-src and connect-src hosts;
  - sizing, theme and limitations (view-only).

  Keep it public-safe. Link it from `demo.html`.

- [ ] T041 Decide #339 with this in place. `PathwayBrowser` is superseded by `reactome-diagram-element` plus the `reactome` app. Remove it, or make it build and add it to CI; record which, and why, on #339. Decide `WebsiteAngular` the same way.
- [ ] T042 Update #322's or a new tracking issue, `RELEASE-TESTING.md` (a section on testing the embed on DEV before a release), and memory: where the embed is served, and the per-element-injector design.
- [ ] T043 Production: `npm run build` does not build the embed (only `build:beta` does), so a production deployment serves no `/embed/diagram/v1/` until its build runs `npm run build:embed`. And the production build's `deployUrl` and `embed-production` profile name reactome.org outright, so a production build tested on DEV before a release would load its chunks and data from PROD. Settle both with the release process before the first production release that carries the embed.
- [ ] T044 A partner page running zone.js (an Angular app of its own, or anything that loads zone.js) patches the element's listeners too, so our events would trigger the partner's change detection. Suspected in review, not verified: check with a host page that loads zone.js, and if so, run the element's listeners outside the partner's zone.
- [ ] T045 The diagram fits itself to its labels as soon as it is drawn, so one drawn before the web fonts arrive (a first visit, a slow font host) is framed differently from one drawn after -- measurably: 40,000 pixels of a 900 x 520 diagram. Cosmetic, and the site does the same. Consider fitting again once `document.fonts.ready` resolves, if the reader has not moved the view in between.

## Dependencies & Execution Order

- **Order**: Setup (T001–T003) → Foundational (T004 spike **gates everything**; T005–T006) → US1 (T007–T024) → US2 (T025–T031) → US3 (T032–T036) → US4 (T037–T039) → close-out (T040–T045).
- **US4 is independent** of the element and could go any time after Setup. It's kept last per the plan's order.
- **Within a story**: tests (red), then implementation, then the gates, then the PR.

## Parallel opportunities

- **Setup**: T003 alongside T001–T002.
- **US1**: T010, T011 and T012 in parallel, once T008–T009 exist. T014 and T016 in parallel with each other.
- **US2**: T025–T028 in parallel.
- **US3**: T033's per-method tests are independent of each other.

## Implementation strategy

- **MVP**: Phase 1 + 2 + US1. After it merges, a partner can embed a live diagram by pathway.
- **Increments**: each later phase is a separate PR, verified on beta.
- **The spike (T004)** is the one open risk. If cytoscape misbehaves in a shadow root, the plan falls back to emulated encapsulation with a scoped host class before any other work.
