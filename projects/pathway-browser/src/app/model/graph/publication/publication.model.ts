import { DatabaseObject } from '../database-object.model';
import { Person } from '../person.model';

export interface Publication extends DatabaseObject {
  author?: Person[];
  /**
   * One pre-composed string from the public content service, but one entry per
   * author (`["Kerr, JF", "Wyllie, AH"]`) from the curation graph. Normalise
   * before use -- see authorNameEntries/composeAuthorByline in
   * details/common/publication/publication-byline.ts.
   */
  authorName?: string | string[];
  title: string;
}
