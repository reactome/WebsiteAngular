/**
 * Every setting the content service reads but the graph's own (NEO4J_*,
 * GRAPH_POOL_SIZE and CONTENT_NODE_ENV_FILE, which graph.ts reads where it
 * uses them): one name each, its default, and where it may come from.
 *
 * Each is read when asked, as it was where it is used: the service reads its
 * address, the render service and the deep-query share once at start, Solr's
 * concurrency at the first Solr call (kept for the life of the process), and
 * the rest per request -- the specs change the environment between cases.
 * The ones read through envSetting may also come from the credentials file
 * (graph.ts); the rest are the environment's alone.
 */
import { envSetting } from './graph.ts';

export const settings = {
  /** The port to listen on: CONTENT_NODE_PORT, a number, or 4400. */
  port: (): number => Number(process.env['CONTENT_NODE_PORT']) || 4400,
  /** The address to listen on: loopback unless CONTENT_NODE_HOST says otherwise. */
  host: (): string => process.env['CONTENT_NODE_HOST'] || '127.0.0.1',
  /** DEEP_QUERY_LIMIT as given; deepLimit (server.ts) bounds it. */
  deepQueryLimit: (): string | undefined => process.env['DEEP_QUERY_LIMIT'],
  /** Where the render service listens: loopback only, never public. */
  renderService: (): string => process.env['RENDER_SERVICE_URL'] || 'http://127.0.0.1:4310',

  /** The Solr core's URL, without credentials (solr.ts refuses one with them). */
  solrUrl: (): string => envSetting('SOLR_URL'),
  solrUser: (): string => envSetting('SOLR_USER'),
  solrPassword: (): string => envSetting('SOLR_PASSWORD'),
  /** SOLR_CONCURRENCY as given, or 2; solr.ts bounds it to 1-16. */
  solrConcurrency: (): string => envSetting('SOLR_CONCURRENCY', '2'),

  /** The report app; none set, no report is sent. */
  reportUrl: (): string => envSetting('REPORT_URL'),
  /** Java's report.user and report.password default to "default". */
  reportUser: (): string => envSetting('REPORT_USER', 'default'),
  reportPassword: (): string => envSetting('REPORT_PASSWORD', 'default'),

  /** Europe PMC's search, for citations of PubMed ids. */
  europePmcUrl: (): string =>
    envSetting('EUROPE_PMC_URL', 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'),
  /** The PSICQUIC registry, read at start and every five minutes. */
  psicquicRegistryUrl: (): string =>
    envSetting(
      'PSICQUIC_REGISTRY_URL',
      'http://www.ebi.ac.uk/Tools/webservices/psicquic/registry/'
    ),
};
