import { DatabaseObject } from '../database-object.model';
import { Person } from '../person.model';

export interface Publication extends DatabaseObject {
  author?: Person[];
  /**
   * One pre-composed string from the public content service, but one entry per
   * author (`["Kerr, JF", "Wyllie, AH"]`) from the curation graph. Only used
   * when `author` is absent.
   */
  authorName?: string | string[];
  title: string;
}
