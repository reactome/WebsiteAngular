import type { DatabaseObject } from '../../model/graph/database-object.model';
import { JSOGDeserializer, type JsogObject } from '../../utils/JSOGDeserializer';

/**
 * What the Molecules tab lists for an entity, from its enhanced answer asked
 * with includeRef: its components, members and candidates, each once -- each
 * resolved, so one the answer had already written elsewhere is listed too
 * (#762) -- or,
 * for an entity with none (a protein, a small molecule), the entity itself, so
 * the tab is never mysteriously blank.
 */
export function moleculesOf(response: JsogObject<DatabaseObject>): DatabaseObject[] {
  const entity = new JSOGDeserializer().deserialize(response);
  const all = [
    ...('hasComponent' in entity ? (entity.hasComponent ?? []) : []),
    ...('hasMember' in entity ? (entity.hasMember ?? []) : []),
    ...('hasCandidate' in entity ? (entity.hasCandidate ?? []) : []),
  ];
  // A complex lists a component once per copy (a TP53 tetramer, four times):
  // each listed once, as the tab always has, by dbId.
  const seen = new Set<number>();
  const components = all.filter((c) => !seen.has(c.dbId) && seen.add(c.dbId));
  return components.length > 0 ? components : [entity];
}
