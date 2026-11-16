import type { Affiliation, Person as GraphPerson, Publication } from '../../../contract/graph.ts';

export type { SimpleEvent } from '../../../contract/person.ts';

/**
 * A person, as /data/person/{id} writes it: the graph's Person in the plain
 * form, where an object the answer has written already is its dbId.
 */
export type Person = GraphPerson<number>;
/** One of a person's affiliations, as that answer writes it. */
export type PersonAffiliation = Affiliation<number>;
/** One of a person's publications, as that answer writes it. */
export type PersonPublication = Publication<number>;
