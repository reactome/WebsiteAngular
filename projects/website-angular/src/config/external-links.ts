import { APP_CONFIG } from './config';
import { environment } from '../../../pathway-browser/src/environments/environment';

export const EXTERNAL_LINKS = {
  twitter: { label: 'Twitter', link: 'https://twitter.com/Reactome' },
  facebook: { label: 'Facebook', link: 'https://www.facebook.com/reactome' },
  youtube: { label: 'Youtube', link: 'https://www.youtube.com/@Reactome' },
  github: { label: 'GitHub', link: 'https://github.com/reactome' },
  bluesky: { label: 'Bluesky', link: 'https://bsky.app/profile/reactome.org' },
  linkedin: { label: 'LinkedIn', link: 'https://ca.linkedin.com/company/reactome-group' },
  elixir: { label: 'elixir', link: 'https://elixir-europe.org/platforms/data/core-data-resources' },
  gcdr: {
    label: 'GCDR',
    link: 'https://globalbiodata.org/scientific-activities/global-core-biodata-resources/',
  },
  coretrustseal: { label: 'CoreTrustSeal', link: 'https://www.coretrustseal.org/' },
  ebi: { label: 'EBI', link: 'http://www.ebi.ac.uk/' },
  nyu: { label: 'NYU', link: 'https://med.nyu.edu/' },
  ohsu: { label: 'OHSU', link: 'http://www.ohsu.edu/' },
  oicr: { label: 'OICR', link: 'https://oicr.on.ca/' },
  releaseNotes: {
    label: 'Release Notes',
    link: `${environment.host}${APP_CONFIG.releaseNotesPath}`,
  },
  feedback: { label: 'Feedback', link: 'https://forms.gle/TPBxaWnnVLLZj66p8' },
  // Deliberately absolute and not derived from `environment.host`: the whole
  // point of a status page is to be reachable when the site it reports on is
  // not, so it must not be built from the host that might be down.
  status: { label: 'Service status', link: 'https://status.reactome.org' },
} as const;
