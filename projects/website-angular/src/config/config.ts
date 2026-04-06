export const APP_CONFIG = {
  // app-level version info
  version: {
    label: 'V95',
    releaseNumber: '95',
    releaseDate: '2025-12-09'
  },

  // canonical site base / download base (choose prod by default)
  baseUrl: 'https://reactome.org',
  downloadUrl: 'https://download.reactome.org',

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