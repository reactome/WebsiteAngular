# Reactome Website

The official frontend website for [Reactome](https://reactome.org) - a free, open-source, curated database of biological pathways. This Angular application provides the primary web interface for accessing Reactome's pathway data, analysis tools, and documentation.

## Tech Stack

- **Angular 19** with standalone components
- **Angular Material** for UI components
- **TinaCMS** for content management
- **TypeScript 5.7**
- **SCSS** for styling

## Prerequisites

- Node.js 18.x or higher
- npm 9.x or higher

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd WebsiteAngular
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Development

Start the development server (includes TinaCMS):
```bash
npm start
```

- Angular app: `http://localhost:4200/`
- TinaCMS admin: `http://localhost:4200/admin/`

The app will automatically reload when you modify source files.

## Project Structure

```
src/
├── app/
│   ├── home-page/              # Home page and sub-components
│   │   ├── home-api-data/      # API data showcase
│   │   ├── home-help/          # Help section
│   │   ├── home-latest-news/   # News carousel
│   │   ├── home-shortcuts/     # Quick links
│   │   ├── home-spotlight/     # Research spotlight
│   │   ├── home-stats/         # Statistics display
│   │   └── home-why-reactome/  # Feature highlights
│   ├── article/                # Article display components
│   ├── page/                   # Generic page component
│   ├── page-layout/            # Page layout wrapper
│   ├── sidebar/                # Sidebar navigation
│   ├── breadcrumb/             # Breadcrumb navigation
│   ├── navigation-bar/         # Responsive top navigation
│   ├── search-bar/             # Search functionality
│   ├── reactome-components/    # Reusable UI components
│   │   ├── button/
│   │   ├── carousel/
│   │   └── tile/
│   ├── app.routes.ts           # Route definitions
│   └── app.config.ts           # App configuration
├── config/
│   └── nav-options.json        # Navigation menu structure
├── types/                      # TypeScript interfaces
├── assets/                     # Static assets (icons, logos)
└── styles.scss                 # Global styles

content/                        # TinaCMS content (MDX/JSON)
├── about/                      # About pages
│   └── news/                   # News articles
├── content/                    # Content pages
│   └── reactome-research-spotlight/
├── documentation/              # Documentation pages
└── community/                  # Community pages

tina/
├── config.ts                   # TinaCMS schema and collections
└── tina-lock.json

scripts/
└── generate-index.ts           # Generates article index JSON files
```

## Content Management

Content is managed via TinaCMS with MDX files stored in the `content/` directory.

### Collections

| Collection | Path | Format | Description |
|------------|------|--------|-------------|
| About | `content/about/` | MDX | About pages (funding, license, etc.) |
| News | `content/about/news/` | MDX | News articles and announcements |
| Team | `content/about/team/` | JSON | Team member profiles |
| Content | `content/content/` | MDX | General content pages |
| Research Spotlights | `content/content/reactome-research-spotlight/` | MDX | Research highlights |
| Documentation | `content/documentation/` | MDX | User documentation |
| Community | `content/community/` | MDX | Community pages |

### Editing Content

1. Run `npm start` to launch the dev server with TinaCMS
2. Navigate to `http://localhost:4200/admin/`
3. Edit content through the visual editor

## Configuration

### Navigation Menu

The navigation structure is configured in `src/config/nav-options.json`. Each menu item supports:
- Dropdown menus with nested links
- External URLs
- Icons and descriptions

### TinaCMS

TinaCMS configuration is in `tina/config.ts`. Environment variables:
- `TINA_CLIENT_ID` - TinaCMS client ID (for cloud sync)
- `TINA_TOKEN` - TinaCMS token (for cloud sync)
- `TINA_BRANCH` - Git branch for content

## Testing

Run unit tests:
```bash
npm test
```

## Building

### Local/Development Build
```bash
npm run build
```
Builds with local TinaCMS (no cloud connection required).

### Production Build
```bash
npm run build:prod
```
Builds with TinaCMS cloud integration.

Build artifacts are output to the `dist/` directory.

## Contributing

1. Create a feature branch from `main`
2. Make your changes
3. Ensure tests pass with `npm test`
4. Submit a pull request

## License

See [LICENSE](LICENSE) for details.
