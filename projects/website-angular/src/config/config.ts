export const APP_CONFIG = {
  // app-level version info
  version: {
    // No releaseNumber here on purpose: the release comes from the database via
    // /ContentService/data/database/version. A constant in the bundle is stale
    // from the first release after a deploy, and it looks exactly as
    // authoritative as the real answer.
    releaseDate: '2026-04-01',
  },

  // canonical download base (separate from environment.host because static
  // assets like .tar.gz dumps live on a CDN, not the application host).
  downloadUrl: 'https://download.reactome.org',

  // SSR / non-browser fallback for the Swagger spec source and the
  // ContentService search API. In the browser both consumers prefer
  // window.location.origin so requests stay same-origin (avoids the
  // CORS / SSO 302 trap on cross-host AnalysisService). This value
  // only matters during server-side rendering and for any laptop dev
  // workflow that doesn't run a local tomcat on :8080.
  swaggerSpecBaseUrl: 'https://newcurator.reactome.org',
  contentServiceBaseUrl: 'https://newcurator.reactome.org/ContentService',

  // pathway browser config
  pathwayBrowser: {
    stablePath: '/PathwayBrowser',
    betaPath: '/beta/PathwayBrowser',
    useBeta: false, // default; can be toggled per env or flag
  },

  // release notes (can be computed by the app using version.releaseNumber)
  // if you'd like to point at a specific article, set here; otherwise use derived URIs
  releaseNotesPath: '/about/news',

  // default flags (feature flags)
  features: {
    betaPathwayBrowser: false,
    useNewAnalysisService: false,
  },
} as const;
