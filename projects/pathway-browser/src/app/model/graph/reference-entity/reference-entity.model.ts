import { DatabaseObject } from '../database-object.model';
import { DatabaseIdentifier } from '../database-identifier.model';
import { PhysicalEntity } from '../physical-entity/physical-entity.model';
import { ReferenceDatabase } from '../reference-database.model';

/**
 * As /data/query/enhanced sends it, which leaves out what an entity has none
 * of: of 15 sampled ReferenceGeneProducts, 13 had no name, one no cross
 * references, three no other identifiers (#344).
 */
export interface ReferenceEntity extends DatabaseObject {
  identifier: string;
  url: string;
  crossReference?: DatabaseIdentifier[];
  databaseName: string;
  moleculeType: string;
  name?: string[];
  otherIdentifier?: string[];
  physicalEntity: PhysicalEntity[];
  referenceDatabase: ReferenceDatabase;
}
