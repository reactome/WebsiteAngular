import {DatabaseObject} from "../database-object.model";
import {Person} from "../person.model";

export interface Publication extends DatabaseObject {
  author: Person[];
  // Free-text author names, curated when the authors have no Person instances.
  // Takes precedence over author when populated.
  authorName?: string[] | string;
  title: string;
}
