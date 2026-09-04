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
- `environments.ts`: `SITE_PROFILES` — one row per deployment, naming both the backend it talks to and the UI variant it presents. See "Deployments" below.
- `features.ts`: Feature flags for toggling functionality.
- `external-links.ts`: External links, including dynamically constructed release notes.

To update configuration values, edit the respective TS files.

### Backend URLs and the CONTENT_SERVICE/ANALYSIS_SERVICE/etc. constants

The single source of truth for backend URLs (`CONTENT_SERVICE`, `ANALYSIS_SERVICE`, `DOWNLOAD`, etc.) is `projects/pathway-browser/src/environments/environment.ts` — imported by both `pathway-browser` and `website-angular` code. Don't duplicate these constants elsewhere; if a page needs a backend URL, import it from here.

### Deployments

One name chooses everything about a deployment: which backend it talks to and
which UI it presents. The list lives in `projects/website-angular/src/config/environments.ts`
as `SITE_PROFILES`, one row per deployment, and the `APP_ENV` define in
`angular.json` picks the row.

| deployment      | backend                                                 | UI      | analytics |
| --------------- | ------------------------------------------------------- | ------- | --------- |
| `production`    | its own origin (falls back to reactome.org off-browser) | main    | public    |
| `beta`          | its own origin (falls back to beta.reactome.org)        | main    | dev       |
| `development`   | its own origin (falls back to dev.reactome.org)         | main    | dev       |
| `curator`       | newcurator.reactome.org, `/GraphContentService`         | curator | none yet  |
| `curator-local` | graph API on `localhost:8686`, the rest from newcurator | curator | none      |

Analytics is a profile field too, and the site reports only when its deployment
names a property — so beta's traffic files under beta's, and the curator site
reports nothing until it has one of its own. Before this, the pathway browser
reported and the site around it did not, so everything outside the browser went
uncounted.

The public deployments resolve `window.location.origin` rather than naming a
host, and that matters: beta.reactome.org reverse-proxies its own
`/ContentService` to the Tomcat on its box, and that Tomcat serves endpoints the
public one does not -- the reaction-diagram exporter among them. A build that
names `reactome.org` instead loads fine and then fails to draw its reaction
diagrams. A site talks to itself; the fallback applies only where there is no
window (SSR, unit tests).

```sh
npm start                                  # public site, dev backend
npm run start:curator                      # curator site
npm run start:curator-local                # curator site, local graph service
npm run build                              # bundle for beta/reactome.org
npm run build:curator                      # bundle for the curator host
```

Adding a deployment -- Plant Reactome, say -- is a row in `SITE_PROFILES` plus
whatever UI genuinely differs. It is not a new environment file, and it should
not be a new boolean.

Two rules the design exists to enforce:

- **No profile may name another deployment's services**, fallbacks included. A
  fallback that reaches a different deployment renders someone else's data
  without saying so. `getProfile()` also throws on a name it does not recognise
  rather than guessing, because guessing is how the curation database came to be
  served from beta.reactome.org.
- **`environment.ts` is the single source of backend URLs** (`CONTENT_SERVICE`,
  `ANALYSIS_SERVICE`, `RENDER_SERVICE`, `DOWNLOAD`, ...). Import them; do not
  rebuild one from `host` at a call site.

`IS_CURATOR` (from `environment.ts`) is how UI branches on the variant today --
`@if (!isCurator)` / `@if (isCurator)`, see `viewport.component.ts`. When a third
variant arrives, switch on the variant itself rather than adding a second
boolean.

#### The curator variant against a local content service

`npm run start:curator-local` serves the curator UI with the graph content API on
`http://localhost:8686`. A locally run content service is a bare Spring Boot app,
so its routes sit at the root (`/data/query/...`) rather than under a
`/GraphContentService` context path -- which is why `contentService` is a
separate field from `host`. Everything it cannot serve is proxied through
`proxy.curator-local.conf.json`, because `newcurator.reactome.org/download` sends
no `Access-Control-Allow-Origin`.

Expect one console error on startup: `data/database/version` 500s on a curation
graph, which has no released version. That is the `versionFallback` in the
profile doing its job, not a misconfiguration.

#### Deploying

beta serves `dist/reactome/browser` straight from this checkout, so **building is
deploying**. `~/rebuild-beta.sh` does it with a dirty-tree guard and a smoke
test; `~/rebuild-beta.sh --check` reports whether what beta serves matches what
is on disk.

## Additional Resources

## LICENSE

[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
