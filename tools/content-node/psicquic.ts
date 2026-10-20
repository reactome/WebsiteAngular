/**
 * PSICQUIC: the services interactor overlays can be drawn from.
 *
 * The list is the HUPO-PSI registry's, read as content-service reads it: the
 * registry client (psicquic-registry-client 1.4.0) asks
 * `{registry}registry?action=STATUS&format=xml` and unmarshals each
 * <service> with JAXB; interactor-core (1.1.5) keeps four of its fields and
 * sorts by name. content-service re-reads it every five minutes and answers
 * from the last reading, or with a 500 when that reading failed.
 */

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** An element's text as JAXB gives it: CDATA kept as it is, entities decoded. */
function xmlText(raw) {
  return raw
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part) =>
      part.startsWith('<![CDATA[')
        ? part.slice(9, -3)
        : part.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, entity) => {
            if (entity[0] !== '#') return XML_ENTITIES[entity] ?? whole;
            const code =
              entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
            return String.fromCodePoint(code);
          })
    )
    .join('');
}

/**
 * A child element's text, or null when the service has none: an empty
 * element is "", as JAXB reads it.
 */
function child(service: string, name: string): string | null {
  const found = service.match(
    new RegExp(`<${name}(?:\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</${name}\\s*>)`)
  );
  return found ? xmlText(found[1] ?? '') : null;
}

/**
 * The document as an XML parser hands it on: line ends normalised to \n
 * everywhere (before parsing, CDATA included), and comments gone outside
 * CDATA sections.
 */
function xmlDocument(xml) {
  return xml
    .replace(/\r\n?/g, '\n')
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part) => (part.startsWith('<![CDATA[') ? part : part.replace(/<!--[\s\S]*?-->/g, '')))
    .join('');
}

/**
 * The registry's services, in its order: name, SOAP and REST URLs, and
 * whether it is up (xs:boolean -- "true" or "1"; anything else, or none, is
 * the primitive's false). Throws on anything that is not a registry.
 */
export function registryServices(text: string): RegistryService[] {
  const xml = xmlDocument(text);
  // All of one: a reading cut short is JAXB's failure to unmarshal.
  if (!/<registry[\s>][\s\S]*<\/registry\s*>\s*$/.test(xml))
    throw new Error('not a PSICQUIC registry, or not all of one');
  // An empty <service/> too: a service with no name, a failed reading.
  return [...xml.matchAll(/<service(?:\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/service\s*>)/g)].map(
    ([, service = '']) => {
      const active = child(service, 'active')?.trim();
      return {
        name: child(service, 'name'),
        soapUrl: child(service, 'soapUrl'),
        restUrl: child(service, 'restUrl'),
        active: active === 'true' || active === '1',
      };
    }
  );
}

/**
 * interactor-core's PsicquicResource list: sorted by
 * name.toLowerCase().compareTo(other.name.toLowerCase()) -- UTF-16 units, as
 * JavaScript's `<` compares -- and stable, as Collections.sort is. A service
 * with no name is Java's NullPointerException in that sort: a failed reading.
 */
/** A registry service, as registryServices reads it. */
export interface RegistryService {
  name: string | null;
  soapUrl: string | null;
  restUrl: string | null;
  active: boolean;
}

export function psicquicResources(services: RegistryService[]) {
  const keyed = services.map((service) => {
    const { name } = service;
    if (name === null) throw new Error('a PSICQUIC service with no name');
    return { service: { ...service, name }, key: name.toLowerCase() };
  });
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return keyed.map(({ service }) => service);
}
