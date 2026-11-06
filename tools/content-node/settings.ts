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
  /**
   * Where the SBML service listens (spec 015, deploy/java-library), read per
   * request; none set, SBML answers 503 rather than another implementation.
   */
  sbmlService: (): string => process.env['SBML_SERVICE'] || '',

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

  /**
   * The help-desk form's mail (POST /contact, contact.ts): the SMTP server,
   * its port (587, or 465 for TLS from the first byte), whether it asks for a
   * login, the login, and where messages go and whom the reader's copy is
   * from. Java's mail.host, mail.port, mail.enable.auth, mail.username,
   * mail.password, cnf.mail.support.address and cnf.mail.support.name. Without
   * the server, the address or (asked for) the login, the form answers 503.
   */
  contactSmtpHost: (): string => envSetting('CONTACT_SMTP_HOST'),
  contactSmtpPort: (): string => envSetting('CONTACT_SMTP_PORT', '587'),
  contactSmtpAuth: (): string => envSetting('CONTACT_SMTP_AUTH', 'false'),
  contactSmtpUser: (): string => envSetting('CONTACT_SMTP_USER'),
  contactSmtpPassword: (): string => envSetting('CONTACT_SMTP_PASSWORD'),
  contactSupportAddress: (): string => envSetting('CONTACT_SUPPORT_ADDRESS'),
  contactSupportName: (): string => envSetting('CONTACT_SUPPORT_NAME'),

  /**
   * Cloudflare Turnstile's secret, under the names the site's own gate reads
   * (projects/website-angular/src/scripts/human-gate.js): one secret, one
   * convention. None, and nothing that needs it can pass.
   */
  turnstileSecret: (): string =>
    envSetting('CLOUDFLARE_SECRET_KEY') || envSetting('TURNSTILE_SECRET'),
  /** Turnstile's siteverify, replaced only in tests. */
  turnstileVerifyUrl: (): string =>
    envSetting('TURNSTILE_VERIFY_URL', 'https://challenges.cloudflare.com/turnstile/v0/siteverify'),

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
