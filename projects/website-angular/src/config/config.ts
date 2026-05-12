export const APP_CONFIG = {
  // app-level version info
  version: {
    releaseNumber: '96',
    releaseDate: '2026-04-01'
  },

  // canonical site base / download base (choose prod by default)
  baseUrl: 'https://reactome.org',
  downloadUrl: 'https://download.reactome.org',

  // Base URL Swagger UI pulls OpenAPI specs from for the embedded
  // ContentService / AnalysisService docs pages. Points at dev so the docs
  // reflect the latest API regardless of which host (reactome.org,
  // dev.reactome.org, release.reactome.org, localhost) is serving this app.
  swaggerSpecBaseUrl: 'https://dev.reactome.org',

  // pathway browser config
  pathwayBrowser: {
    stablePath: '/PathwayBrowser',
    betaPath: '/beta/PathwayBrowser',
    useBeta: false // default; can be toggled per env or flag
  },

  // release notes (can be computed by the app using version.releaseNumber)
  // if you'd like to point at a specific article, set here; otherwise use derived URIs
  releaseNotesPath: '/about/news',

  // default flags (feature flags)
  features: {
    betaPathwayBrowser: false,
    useNewAnalysisService: false
  }
} as const;