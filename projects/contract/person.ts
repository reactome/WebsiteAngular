// A person's events (spec 016, T024): the pathways and reactions a person
// authored or reviewed, as /data/person/{id}/{authored,reviewed}{Pathways,Reactions}
// write them. The person page lists them.

/**
 * One event and the edit that ties it to the person, measured over the
 * recorded answers (8 distinct requests, 14 events): the edit's date and
 * author and the event's labels are in every one; one had a DOI. Java lists
 * an event once per edit; the service lists it once, at its latest edit (a
 * difference it declares).
 */
export interface SimpleEvent {
  dbId: number;
  stId: string;
  displayName: string;
  speciesName?: string;
  schemaClass?: string;
  /** The edit's date, as the graph holds it. */
  dateTime: string;
  /** The edit's author, the person asked about, by dbId. */
  authorDbId: number;
  doi?: string;
  labels: string[];
}
