# CLAUDE.md

This file provides context for Claude Code when working on this project.

## Project Overview

This is the Reactome website frontend - an Angular 19 application for the Reactome biological pathway database. Content is managed via TinaCMS with MDX files. It will be deployed as static files (Apache or S3/CloudFront).

## Commands

```bash
npm start              # Dev server with TinaCMS at http://localhost:4200
npm run build          # Production build (local TinaCMS, no cloud)
npm run build:prod     # Production build (TinaCMS cloud)
npm test               # Run unit tests with Karma
npm run generate:indices  # Regenerate article index JSON files
```

## Architecture

### Component Pattern
- Uses Angular 19 **standalone components** (no NgModules)
- Components are self-contained with their own imports
- Lazy-loaded routes in `app.routes.ts`

### Directory Structure
- `src/app/home-page/` - Home page with section sub-components
- `src/app/article/` - Article display (article-page, article components)
- `src/app/page/` - Generic page component
- `src/app/page-layout/` - Layout wrapper with sidebar support
- `src/app/sidebar/` - Sidebar navigation
- `src/app/breadcrumb/` - Breadcrumb navigation
- `src/app/reactome-components/` - Reusable UI components (button, carousel, tile)
- `src/app/navigation-bar/` - Main navigation (mobile responsive)
- `src/config/nav-options.json` - Navigation menu structure
- `src/types/` - TypeScript interfaces

### Content Structure (TinaCMS)
- `content/about/` - About pages (MDX)
- `content/about/news/` - News articles (MDX)
- `content/about/team/` - Team members (JSON)
- `content/content/` - General content pages (MDX)
- `content/content/reactome-research-spotlight/` - Research spotlights (MDX)
- `content/documentation/` - Documentation pages (MDX)
- `content/community/` - Community pages (MDX)

### Naming Conventions
- Components: kebab-case folders matching component name
- Each component folder contains: `.component.ts`, `.component.html`, `.component.scss`, `.component.spec.ts`
- Content files: kebab-case `.mdx` or `.json` files

## TinaCMS

- Config: `tina/config.ts` defines collections and schema
- Admin UI: `http://localhost:4200/admin/` (during dev)
- Collections: about, news, team, content, reactome_research_spotlights, documentation, community
- Environment variables: `TINA_CLIENT_ID`, `TINA_TOKEN`, `TINA_BRANCH`

## Scripts

- `scripts/generate-index.ts` - Parses MDX frontmatter and generates `index.json` files for news and research spotlights. Runs automatically on `npm start` and `npm run build`.

## Styling

- **SCSS** for all component styles
- **Angular Material** components with custom Reactome theme
- **ngx-reactome-style** package provides base theme/colors
- Global styles in `src/styles.scss`
- Mobile-first responsive design

## Configuration

- Navigation menu: `src/config/nav-options.json`
- TinaCMS schema: `tina/config.ts`
- Angular build: `angular.json`

## Testing

- Unit tests use Karma + Jasmine
- Test files are co-located with components (`.spec.ts`)
- Run `npm test` to execute tests in Chrome

## Key Files

- `src/app/app.routes.ts` - All route definitions
- `src/app/app.config.ts` - App-wide providers and configuration
- `tina/config.ts` - TinaCMS collections and schema
- `src/config/nav-options.json` - Navigation structure
- `scripts/generate-index.ts` - Article index generator
