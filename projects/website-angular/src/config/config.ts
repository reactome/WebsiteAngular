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

  // No cross-host fallback belongs here. Both of these named
  // newcurator.reactome.org for the case where window was undefined:
  // contentServiceBaseUrl was read by nothing at all, and swaggerSpecBaseUrl sat
  // behind a branch that could not be reached, because the component returns
  // early off-browser. Anything put back here would be a host to fall back to
  // silently, and a site answering with another deployment's data is worse than
  // one that fails -- the reader cannot tell they are looking at the wrong
  // database. Services resolve same-origin instead.

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
