# Reactome

REACTOME is an open-source, open access, manually curated and peer-reviewed pathway database.

## Local Development Server

To setup a local environment

```bash
npm install --legacy-peer-deps
npm start
```

### Running it in Docker

```bash
docker compose up
```

The container writes into your working copy — the build cache, the staged
content, TinaCMS's generated client — so it runs as an unprivileged user rather
than root, or those files come back owned by root and your own `ng build` then
fights the container for `.angular/cache`.

That user's ids default to `1000:1000`, which is what a stock Linux install
gives the first account, and Docker Desktop on macOS and Windows maps ownership
for you regardless. If `id -u` says anything else, point the build at your ids
once and rebuild:

```bash
printf 'UID=%s\nGID=%s\n' "$(id -u)" "$(id -g)" > .env
docker compose build && docker compose up -d
```

`.env` is not committed, so each machine sets its own. Changing it needs
`docker compose down -v` as well, because the anonymous `node_modules` volume
keeps whatever ownership it was first created with.

## Usage

Reactome has a wide range of features, to explore more of Reactome or get more information visit [the documentation page](https://reactome.org/documentation) or see the `/documentation` folder in the root directory.

## Workspace libraries

Four libraries live in this repo under `projects/` and build to `dist/`. The apps consume them from there (via the `dist/` entry in each project's `stylePreprocessorOptions.includePaths`, and the `paths` mappings in `tsconfig.json`), **not** from `node_modules` — so they must be built before the app will compile:

| project                    | contents                                                 |
| -------------------------- | -------------------------------------------------------- |
| `reactome-cytoscape-style` | diagram rendering styles + drawing helpers               |
| `ngx-reactome-style`       | shared Angular Material theme (Sass only, no TypeScript) |
| `reactome-table`           | the editable data grid                                   |
| `reactome-gsa-form`        | the ReactomeGSA analysis wizard (NgRx-backed)            |

`npm start` builds them for you. To build them by hand:

```bash
npm run build:libs                    # ngx-reactome-style, reactome-table, reactome-gsa-form
ng build reactome-cytoscape-style     # or `npm run dev:reactome-cytoscape-style` to watch
```

The last three were previously separate npm packages (`reactome-gsa-form`, `reactome-table` and `reactome-table-wc` from `reactome/gsa-frontend`; `ngx-reactome-style` published standalone). They were absorbed here so their Angular/NgRx peer dependencies stay in lockstep with the rest of the workspace instead of pinning it to an older major. They can still be published to npm from this repo — build, then `npm publish dist/<name>`.

## Configuration

The application configuration is centralized in TypeScript files under `projects/website-angular/src/config/`. Key configurations include:

- `config.ts`: App-level settings like version, base URLs, and feature flags.
- `environments.ts`: Per-deploy-environment settings (development, production, local, github, remote) — currently only consumed by `projects/pathway-browser/src/environments/environment.*.ts`, since the deployed `reactome` build resolves its host dynamically from `window.location.origin` instead (see below).
- `features.ts`: Feature flags for toggling functionality.
- `external-links.ts`: External links, including dynamically constructed release notes.

To update configuration values, edit the respective TS files.

### Backend URLs and the CONTENT_SERVICE/ANALYSIS_SERVICE/etc. constants

The single source of truth for backend URLs (`CONTENT_SERVICE`, `ANALYSIS_SERVICE`, `DOWNLOAD`, etc.) is `projects/pathway-browser/src/environments/environment.ts` — imported by both `pathway-browser` and `website-angular` code. Don't duplicate these constants elsewhere; if a page needs a backend URL, import it from here.

### Site variant: main vs. curator

This app builds as one of two variants, controlled by `projects/pathway-browser/src/environments/variant.ts` (`variant.curator.ts` is swapped in via the `curator` Angular build configuration's `fileReplacements`):

- **main** (default) — the public reactome.org/beta.reactome.org site. Host resolves dynamically from `window.location.origin`.
- **curator** — a scaled-down build for `newcurator.reactome.org`, pointing at the curation graph database (`GraphContentService` instead of `ContentService`) rather than the released production graph. Host is fixed to `https://newcurator.reactome.org` regardless of what domain the frontend bundle is served from, since it's always the same backend. Several UI elements (Analyze/Compare/Overlay/Feedback/the old-browser link) are hidden for this variant, and the homepage renders a different, curator-specific layout (`curator-home-shortcuts` instead of `home-shortcuts`).

`environment.ts` exports `IS_CURATOR` (derived from `variant.ts`) for any code that needs to branch on the variant — gate curator-only UI with `@if (!isCurator)` / `@if (isCurator)` (see `viewport.component.ts`/`.html` for the pattern), don't check `SITE_VARIANT` directly outside `environment.ts`.

To build/serve the curator variant locally: `ng build reactome --configuration development,curator` or `ng serve --configuration development,curator`.

#### Curator variant against a local content service

`npm run start:curator-local` serves the curator variant with the graph content API pointed at a content service running on your own machine at `http://localhost:8686` (the `curator-local` build configuration in `angular.json`, which pairs `variant.curator.ts` with `environment.curator-local.ts`). Add `-- --port 4300` if 4200 is taken.

A locally-run content service is a bare Spring Boot app, so its endpoints sit at the root (`/data/query/...`), not under the `/ContentService` or `/GraphContentService` context path the deployed instances are proxied onto — hence the separate `CONTENT_SERVICE` value rather than a different `host`. Everything a local instance can't serve still comes from newcurator, routed through `proxy.curator-local.conf.json` because `newcurator.reactome.org/download` sends no `Access-Control-Allow-Origin`:

- `/download/current/**` (EHLDs, pre-generated diagram JSON) and `/figures/**` → `newcurator.reactome.org`
- `/ContentService/**` → the local service on `:8686`, with the context path stripped, so the ContentService Swagger page documents your local API
- the database-version fallback → `https://reactome.org/ContentService/data/database/version`, since a curation graph has no released version and newcurator serves no `/ContentService`

Expect one console error on startup: `data/database/version` 500s on a curation graph. That's the fallback above kicking in, not a misconfiguration.

## Additional Resources

## LICENSE

[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
