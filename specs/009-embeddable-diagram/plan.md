# Implementation Plan: Embeddable Reactome pathway diagram

**Branch**: `embeddable-diagram` | **Date**: 2026-09-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-embeddable-diagram/spec.md`

## Summary

The work is a `<reactome-diagram>` custom element that shows one live pathway diagram on a partner's page, plus the old widget's `Reactome.Diagram` interface on top of it.

- **What it is:** the site's own `DiagramComponent`, wrapped in a new root component with an in-memory state. It has no router, a fixed absolute Reactome host, and a shadow root.
- **How it's built:** as a separate application project. A small hand-written classic loader lets a plain `<script>` tag load it and defines `Reactome.Diagram` synchronously.
- **Checks:** CI builds it on every change. An e2e spec drives it on a host page of another origin, from recordings.
- **Where it runs:** served from `/embed/diagram/v1/` on beta, and later on reactome.org.

Every design point was checked in research: see [research.md](research.md), R1–R9.

## Technical Context

**Language/Version**: TypeScript 5.9, Angular 21.2 (zoneless, signals), Node 24 for builds.

**Primary Dependencies**:

- `@angular/elements` (`createCustomElement`, `createApplication`);
- the existing diagram (`projects/pathway-browser/src/app/diagram`), `reactome-cytoscape-style` and the cytoscape fork;
- Angular Material, only the parts the diagram already uses;
- CDK `OverlayContainer`, subclassed to keep overlays in the shadow root.

**Storage**: None. State is in memory, per element.

**Testing**:

- Playwright e2e with the recording harness, on host pages served from a second local origin;
- vitest for the loader's pure logic (call queue, handler lists, attribute ↔ property);
- a CI build with a size budget.

**Target Platform**: Evergreen browsers on third-party pages.

**Project Type**: A web component library built from an existing Angular workspace, plus a classic JS loader.

**Performance Goals**: the first draw of a typical pathway is no slower than in the Pathway Browser. The download is under a third of the full site (budget 1.5 MB initial; estimate 300–400 KB gzipped, R6).

**Constraints**:

- no changes to the host page's URL, history, title, storage or body (R1, R5);
- works cross-origin without a proxy (R3, measured);
- a classic `<script>` must work (R4);
- the repo is public.

**Scale/Scope**:

- one element (with EHLD support), plus the loader;
- the old interface: 10 methods and 6 handlers;
- about 10 e2e scenarios, plus guards on partner image addresses and links.

## Constitution Check

| Principle                     | How this plan meets it                                                                                                                                                                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Verify the instrument      | The cross-origin e2e spec asserts the host page really is on a different origin from the embed and from the data before it trusts any result. The style-isolation check compares pixels against a control: the same diagram with no hostile host styles. CORS was measured with real `Origin` headers (R3). |
| II. Measure in the thing      | Sizes come from the actual build output (budget in `angular.json`), not estimates. On beta, verification is on the served files and their response headers.                                                                                                                                                 |
| III. Prove a test fails first | Isolation checks are shown failing against a deliberately non-isolated build: emulated encapsulation, and a real `UrlStateService`. Each old-interface check fails before its method is implemented. The CI build check is shown catching a broken build.                                                   |
| IV. No unstable identifiers   | `pathway` accepts a dbId and normalises it to the stable id before loading. Events always carry stable ids.                                                                                                                                                                                                 |
| V. Comments carry the failure | The memory state, `OverlayContainer` and loader comments say what goes wrong without them (a host URL taken over; tooltips unstyled on `body`; `create` missing when the host polls).                                                                                                                       |
| Quality gates                 | Types, lint (with the per-rule ratchet), dead code, format, unit tests, app build **and the new embed build**, e2e, and preflight all run it.                                                                                                                                                               |

**Gate result**: PASS; no violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/009-embeddable-diagram/
├── plan.md, research.md, data-model.md, quickstart.md
├── contracts/
│   ├── reactome-diagram-element.md   # v1 element: attributes, methods, events, guarantees
│   └── legacy-widget-api.md          # Reactome.Diagram compatibility
├── host-page/                        # static partner-style host page(s) used by e2e and by hand
└── tasks.md                          # /speckit-tasks
```

### Source Code

```text
projects/reactome-diagram-element/          # new application project
├── src/
│   ├── main.ts                             # createApplication(providers) + customElements.define
│   ├── diagram-element.component.ts        # root: ShadowDom, attributes → memory state, events out, EHLD vs diagram
│   ├── memory-state.ts                     # in-memory PathwayState (signals + navigateTo), no Router
│   ├── embed-providers.ts                  # memory state, fixed DarkService, router-free SpeciesService, shadow OverlayContainer
│   ├── shadow-overlay-container.ts
│   ├── theme.scss                          # tokens re-emitted on :host / :host(.dark)
│   └── loader/reactome-diagram.js          # classic loader + window.Reactome.Diagram (hand-written, copied as an asset)
├── demo.html                               # copied to the output; the partner-facing demo
└── tsconfig.app.json

projects/pathway-browser/src/app/diagram/diagram.component.ts   # additive: diagramLoaded output; Router optional
projects/pathway-browser/src/app/services/…                     # a PathwayState token extracted from UrlStateService (read surface + navigateTo)
angular.json                                                    # project reactome-diagram-element: index false, no polyfills, outputHashing none, deployUrl per config, budget
projects/website-angular/src/scripts/serve-prod.js              # serve /embed/diagram/v1/ with Access-Control-Allow-Origin: *
deploy/nginx                                                    # pass /embed/ through (image rebuild + nginx -t)
e2e/embed-diagram.spec.ts                                       # cross-origin host page; every scenario in quickstart
.github/workflows/tests.yml, scripts/preflight.sh               # build the embed on every change
docs: ANGULAR_ELEMENTS_SETUP.md → rewritten as the partner embedding guide (FR-013)
```

**Structure decision**:

- **A new application project** in the existing workspace, reusing the pathway-browser code by import, as the `reactome` app already does.
- **`PathwayBrowser` and `WebsiteAngular`** (#339) are resolved in the last phase. `PathwayBrowser`'s role (a standalone pathway-browser build) is superseded by this project and the `reactome` app. The decision to remove or keep it is recorded there with this in place.

## Phases (delivery order, per spec priority)

1. **Story 1, the live diagram on a partner page** (MVP):
   - a spike on cytoscape in a shadow root;
   - the `PathwayState` token and memory state;
   - the element with `pathway`, the embed build, the loader (fonts, styles, module script);
   - isolation, the demo page, CI and preflight build, the e2e cross-origin spec for drawing, interaction, URL, isolation, multiple elements and teardown;
   - serving on beta.
2. **Story 2, highlighting and events**: `select`, `flag`, `analysis-token`, `theme`; the events; EHLD pathways.
3. **Story 3, the old interface**: `Reactome.Diagram` in the loader, one e2e check per method and handler, and AllianceGenome's integration copied as a test page.
4. **Story 4, guards**: exporter image addresses and legacy links, in e2e.
5. **Close-out**:
   - the partner embedding guide (replacing `ANGULAR_ELEMENTS_SETUP.md`'s content);
   - #339's decision on the two old projects;
   - the curator-tool follow-up stays #349.

Each phase is its own PR: red proof, adversarial review, CI, then merge and verify on beta.

## Complexity Tracking

No constitution violations. One deliberate extra piece: the **hand-written classic loader**. The builder can't produce a classic single-file script (R4), and the old widget's hosts need a synchronous global. The alternative, a custom bundling step outside the Angular builder, is what rotted in `reactome-table-wc`.
