import type { DatabaseObject } from '../../model/graph/database-object.model';
import { JSOGDeserializer, type JsogObject } from '../../utils/JSOGDeserializer';

/**
 * What the Molecules tab lists for an entity, from its enhanced answer asked
 * with includeRef: its components, members and candidates -- each resolved,
 * so one the answer had already written elsewhere is listed too (#762) -- or,
 * for an entity with none (a protein, a small molecule), the entity itself, so
 * the tab is never mysteriously blank.
 */
export function moleculesOf(response: JsogObject<DatabaseObject>): DatabaseObject[] {
  const entity = new JSOGDeserializer().deserialize(response);
  const components = [
    ...('hasComponent' in entity ? (entity.hasComponent ?? []) : []),
    ...('hasMember' in entity ? (entity.hasMember ?? []) : []),
    ...('hasCandidate' in entity ? (entity.hasCandidate ?? []) : []),
  ];
  return components.length > 0 ? components : [entity];
}
