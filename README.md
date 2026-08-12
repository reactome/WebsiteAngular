# Reactome

REACTOME is an open-source, open access, manually curated and peer-reviewed pathway database.

## Local Development Server
To setup a local environment

```bash
npm install --legacy-peer-deps
npm start
```

## Usage
Reactome has a wide range of features, to explore more of Reactome or get more information visit [the documentation page](https://reactome.org/documentation) or see the ````/documentation```` folder in the root directory.

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

## Additional Resources

## LICENSE
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
