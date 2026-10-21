/**
 * The registry (spec 014, research R1 and R3): the families' endpoint lists
 * assembled in the order requests are matched in, and the lookups over it.
 * The server imports this and never a family; start-up work a family owns,
 * the PSICQUIC refresh, reaches the server through here too. Moved
 * unchanged from service.ts.
 */
import type { Endpoint } from './endpoint.ts';
import { citationEndpoints } from './citation-endpoints.ts';
import { contentEndpoints } from './content-endpoints.ts';
import { personEndpoints } from './person-endpoints.ts';
import { schemaEndpoints } from './schema-endpoints.ts';
import { interactorsEndpoints, refreshPsicquicResources } from './interactors-endpoints.ts';
import { exportersEndpoints } from './exporters-endpoints.ts';
import { entitiesEndpoints } from './entities-endpoints.ts';
import { mappingSpeciesEndpoints } from './mapping-species-endpoints.ts';
import { dataQueryEndpoints } from './data-query-endpoints.ts';
import { pathwaysEventsEndpoints } from './pathways-events-endpoints.ts';
import { searchEndpoints } from './search-endpoints.ts';
import { searchDiagramEndpoints } from './search-diagram-endpoints.ts';

export { refreshPsicquicResources };

/**
 * The endpoints implemented so far: each family's in its own order, the
 * families in the order research R3 records.
 *
 * Each entry is the path the Java service uses, so the diff harness and the
 * proxy table can both address them by that one string.
 */
export const endpoints: Endpoint[] = [
  ...dataQueryEndpoints,
  ...pathwaysEventsEndpoints,
  ...contentEndpoints,
  ...personEndpoints,
  ...mappingSpeciesEndpoints,
  ...entitiesEndpoints,
  ...schemaEndpoints,
  ...interactorsEndpoints,
  ...exportersEndpoints,
  ...searchEndpoints,
  ...searchDiagramEndpoints,
  ...citationEndpoints,
];

/**
 * The endpoint a path was expanded from, by its whole template. Matching on
 * the text before the first `{` gave every /schema/{id}/... path to the first
 * of them, /count, so /min was judged by /count's declared differences and
 * failed on a difference it declares itself.
 */
export function endpointFor(path: string): Endpoint | undefined {
  return endpoints.find((e) => endpointPattern(e.path, '(\\?|$)').test(path));
}

/** An endpoint's template as a pattern over a path, `tail` after it. */
function endpointPattern(template, tail) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^${template
      .split(/\{\w+\}/)
      .map(escape)
      .join('[^/?]+')}${tail}`
  );
}

/** The GET endpoint Express would route `path` (no query) to, if any. */
export function getEndpointFor(path) {
  return (
    endpoints
      // GET endpoints declare no method; the only one declared is 'post'.
      .filter((e) => !e.method)
      .find((e) => endpointPattern(e.path, '$').test(path))
  );
}
