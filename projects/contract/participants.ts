// An event's participants (spec 016, T025f): /data/participants/{id}, every
// physical entity taking part in an event, all the way down, each with the
// reference entities behind it. A projection the service builds (graph-core's
// Participant), not a graph class. The Pathway Browser's molecules tab lists it.

/**
 * A reference entity behind a participant. Every field is written, the text
 * "null" where the graph has none, as Java's asString writes it. Measured over
 * 1,308 in 6 recorded answers.
 */
export interface ParticipantReference {
  dbId: number;
  stId: string;
  /** A variant's own identifier where it has one, else the entity's. */
  identifier: string;
  schemaClass: string;
  displayName: string;
  /** The class to draw it with: the participating entity's, or the member's it was reached through. */
  icon: string;
  url: string;
}

/**
 * A physical entity taking part in the event, with its reference entities.
 * A name or a class the graph lacks is left out. Measured over 642: both
 * always there.
 */
export interface Participant {
  peDbId: number;
  displayName?: string;
  schemaClass?: string;
  refEntities: ParticipantReference[];
}
