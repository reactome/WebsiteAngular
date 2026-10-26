/**
 * The person endpoints (spec 014, research R1, a family): /data/person/*,
 * PersonController's -- a person by dbId or ORCID, their publications, and
 * the pathways and reactions they authored or reviewed -- with the helpers
 * only they use. Moved unchanged from service.ts.
 */
import type { Endpoint } from './endpoint.ts';
import { asciiDigits, javaNumeric } from './java-text.ts';
import { read } from './graph.ts';
import {
  findByIdParameters,
  findByIdQuery,
  mapNodes,
  mapResult,
  rootLabelsQuery,
  writeDomain,
} from './domain.ts';
import type { MappedRow } from './domain.ts';
import { pathId, rawSegment, writerFor } from './spring.ts';
import { compact, notFound } from './answers.ts';
import type { GraphNode } from './graph.ts';
import { attributeAnswer } from './objects.ts';
import type { SimpleEvent } from '../../projects/website-angular/src/model/person.model.ts';

/**
 * How graph-core's PersonService reads a person's id, as a match on `n`:
 * a dbId when StringUtils.isNumeric says so (any script's digits), else an
 * ORCID by its pattern (ASCII digits), else -- for publications only -- an
 * e-mail address by its pattern. Undefined for anything else, which Java
 * answers as no person. The id is not trimmed: Java does not trim it here.
 *
 * A dbId is matched under DatabaseObject, where it is indexed, and the label
 * asserted after; an ORCID is indexed on Person (see the person lists).
 */
export function personWhere(id: string, { email = false } = {}) {
  // Pattern.matches: the whole id; `.` stops at Java's line terminators.
  if (email && /^[^\n\r\u0085\u2028\u2029]+@[^\n\r\u0085\u2028\u2029]+\.[a-z]+$/.test(id))
    return { anchor: 'n:Person', where: 'n.eMailAddress = $id', params: { id } };
  if (javaNumeric(id))
    return {
      anchor: 'n:DatabaseObject',
      where: 'n.dbId = toInteger($id) AND n:Person',
      params: { id: asciiDigits(id) },
    };
  if (/^\d{4}-\d{4}-\d{4}-\d{3}[0-9X]$/.test(id))
    return { anchor: 'n:Person', where: 'n.orcidId = $id', params: { id } };
  return undefined;
}

/**
 * A person as PersonService.findPerson loads them, by dbId or ORCID: the
 * node and what it points to but InstanceEdits (see /person/{id}).
 * Undefined when there is none.
 */
async function findPerson(id: string) {
  const person = personWhere(id);
  if (!person) return undefined;
  const options = { anchor: person.anchor, ordered: false, without: 'InstanceEdit' };
  const [found] = await read<{ labels: string[] }>(
    rootLabelsQuery(person.where, options),
    person.params
  );
  if (!found) return undefined;
  const [row] = await read<MappedRow>(findByIdQuery(person.where, options), {
    ...person.params,
    ...findByIdParameters(found.labels),
  });
  return row ? mapResult(row) : undefined;
}

export const personEndpoints: Endpoint[] = [
  {
    path: '/ContentService/data/person/{id}',
    // A curator with affiliations, an ORCID cross-reference and publications.
    sample: '1169272',
    // The 404 body names the service that answered; see /pathways/top/{id}.
    differs: [/^\/ContentService\/data\/person\/[^/]+: \.url: /],
    /**
     * A person, by dbId or ORCID, with their affiliations, cross-references and
     * publications: graph-core's findPersonByDbId / findPersonByOrcidId,
     * written by the domain serialiser (domain.ts) in Java's views.
     *
     * Java matches `(n:Person{dbId:$dbId})`, which no index serves: 1.1s on
     * every request. The same person by its indexed DatabaseObject dbId is the
     * same node, expanded the same way -- Java's answer by dbId and by ORCID
     * are byte for byte the same -- in milliseconds.
     */
    handler: async (request) => {
      const id = pathId(rawSegment(request, 4));
      const person = await findPerson(id);
      if (!person) return notFound(request, `No person found for id: ${id}`);
      return {
        status: 200,
        serialised: writeDomain(person, ...writerFor(request)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/person/{id}/publications',
    sample: '1169272',
    /**
     * The publications a person is an author of: graph-core's
     * getPublicationsOfPerson, by dbId, ORCID or e-mail address, each
     * publication alone (no relationships), written by the domain serialiser.
     *
     * Java's own order is not one order: by dbId it scans from the
     * publications' side and lists them reversed against its answer by ORCID
     * (person 1169272: 9023676 first by dbId, 9861032 first by ORCID).
     * Here both come in the ORCID order -- the person's own, from the indexed
     * person -- so `unordered` compares the sets.
     *
     * An id that is none of the three is Java's bare empty 200; this answers
     * `[]`, as the person's four event lists do (see them, below).
     */
    unordered: (entry) => {
      const item = entry as number | { dbId: number };
      return typeof item === 'number' ? item : item.dbId;
    },
    differs: [
      /^\/ContentService\/data\/person\/[^/]+\/publications: order differs from java's$/,
      // An unreadable id: `[]` here, Java's empty 200 (see above).
      /^\/ContentService\/data\/person\/[^/]+\/publications: (content-type "application\/json"|body "\[\]"), java says ""$/,
    ],
    handler: async (request) => {
      const id = pathId(rawSegment(request, 4));
      const person = personWhere(id, { email: true });
      if (!person) return { status: 200, serialised: '[]', type: 'application/json' };
      const rows = await read<{ pub: GraphNode }>(
        `MATCH (${person.anchor}) WHERE ${person.where}
         MATCH (n)-[:author]-(pub:Publication)
         RETURN {id: id(pub), labels: labels(pub), props: properties(pub)} AS pub`,
        person.params
      );
      return {
        status: 200,
        serialised: writeDomain(mapNodes(rows.map((row) => row.pub)), ...writerFor(request)),
        type: 'application/json',
      };
    },
  },
  ...['authored', 'reviewed'].flatMap((role) =>
    [
      ['Pathways', 'Pathway'],
      ['Reactions', 'ReactionLikeEvent'],
    ].map(([suffix, label]): Endpoint => ({
      path: `/ContentService/data/person/{id}/${role}${suffix}`,
      // A curator with enough of everything to be worth comparing: 450 authored
      // pathways, 3,309 authored reactions, one reviewed pathway, no reviewed
      // reactions -- so all four endpoints have something to say.
      sample: '1169272',
      /**
       * What a person authored or reviewed, for the person page's four lists.
       *
       * The id is either the numeric dbId or an ORCID, because the page is
       * reached both ways: `/content/detail/person/<orcid>` is the link the
       * contributors table builds, and a dbId is the fallback for the 661 people
       * who have no ORCID recorded.
       *
       * `dateTime` is the InstanceEdit's, not the event's, and `authorDbId` is
       * the person's -- both read from the live response rather than assumed.
       * `labels` is the node's Neo4j labels, which is why it varies by subclass.
       * Sorted by dateTime descending, which is Java's order and the one the
       * page renders.
       */
      handler: async (request) => {
        // The raw segment, as every handler reads its id (see pathId).
        const id = pathId(rawSegment(request, 4));
        // Matched on one property, chosen before the query runs, and **under the
        // label the index is on**.
        //
        // Two measured mistakes, both mine. The first version was
        // `WHERE person.dbId = toInteger($numeric) OR person.orcidId = $id` --
        // one query for both kinds of id, which read nicely and cost a full scan
        // of all 176,891 Person nodes, because a disjunction across two
        // properties can use neither index.
        //
        // The second survived that fix. `dbId` is indexed on **DatabaseObject**,
        // and Neo4j treats `Person` as an unrelated label, so matching
        // `(person:Person)` could not use it and scanned anyway. Matching
        // DatabaseObject and asserting the label afterwards uses the index:
        //
        //     MATCH (p:Person)         WHERE p.dbId = …   1057ms
        //     MATCH (n:DatabaseObject) WHERE n.dbId = …      2ms
        //     the whole authored query, before             995ms
        //     the whole authored query, after               48ms
        //
        // `orcidId` needs no such care: it is indexed on Person itself.
        const numeric = /^\d+$/.test(id);
        const anchor = numeric ? 'person:DatabaseObject' : 'person:Person';
        const match = numeric
          ? 'person.dbId = toInteger($id) AND person:Person'
          : 'person.orcidId = $id';
        const rows = await read<{
          dbId: number;
          stId: string | null;
          displayName: string | null;
          speciesName: string | null;
          schemaClass: string;
          dateTime: string | null;
          authorDbId: number;
          doi: string | null;
          labels: string[];
        }>(
          `MATCH (${anchor})-[:author]->(edit:InstanceEdit)-[:${role}]->(event:${label})
           WHERE ${match}
           RETURN event.dbId AS dbId, event.stId AS stId, event.displayName AS displayName,
                  event.speciesName AS speciesName, event.schemaClass AS schemaClass,
                  edit.dateTime AS dateTime, person.dbId AS authorDbId, event.doi AS doi,
                  labels(event) AS labels
           // dbId breaks ties, because dateTime alone does not order them and
           // the plan decides. Two events edited in the same second came back
           // in one order while this query scanned and another once it used the
           // index -- the same rows, reordered by a change that was meant to be
           // purely about speed. Java has no tiebreaker either, so its order
           // within a tie is equally incidental; ours is at least reproducible.
           ORDER BY edit.dateTime DESC, event.dbId`,
          { id }
        );

        // Java returns one row per authorship edit, so an event edited twice by
        // the same person appears twice: R-HSA-6803801 comes back for
        // Orlic-Milacic at both 2015-10-14 and 2013-07-15, making the person
        // page show 3,310 authored reactions where /content/contributors counts
        // 3,309 and listing that reaction twice. The page is asking "what did
        // they author", not "when did they edit it", so the event belongs once.
        //
        // The first occurrence wins, which in Java's own descending order is the
        // most recent edit. That removes exactly one row and moves nothing else,
        // so the list is Java's with the duplicate dropped rather than a
        // different list.
        // An id that is neither numeric nor an ORCID matches nothing, and this
        // answers `[]` where Java answers a **bare empty 200** -- no body, no
        // content-type. A deliberate difference rather than a miss: any client
        // calling `.json()` on an empty body throws, and every client must
        // already handle `[]`, because that is what a person with no reviewed
        // reactions legitimately gets. Returning the same shape for "none" and
        // "none, and your id was nonsense" cannot break a caller that works.
        const seen = new Set();
        const body: unknown[] = [];
        for (const row of rows) {
          if (seen.has(row.dbId)) continue;
          seen.add(row.dbId);
          body.push(
            compact<SimpleEvent>({
              dbId: row.dbId,
              stId: row.stId,
              displayName: row.displayName,
              speciesName: row.speciesName,
              schemaClass: row.schemaClass,
              dateTime: row.dateTime,
              authorDbId: row.authorDbId,
              doi: row.doi,
              labels: row.labels,
            })
          );
        }
        return { status: 200, body, type: 'application/json' };
      },
      /**
       * The declared difference, stated as the rule rather than its symptoms.
       *
       * Java returns the same event once per authorship edit; this returns it
       * once. Saying so as a `differs` pattern would have meant swallowing the
       * *consequences*: dropping one row from a 3,310-element list shifts every
       * row after it, so the comparison reports two thousand differences for one
       * intended change, and a pattern wide enough to cover them would hide a
       * genuinely wrong row just as well. The harness applies this to Java's
       * answer and then compares exactly.
       */
      normalise: (javaBody) => {
        // An answer that is not the list (an error object, say) is compared as
        // it is, and the comparison reports it.
        if (!Array.isArray(javaBody)) return javaBody;
        const rows = javaBody as { dbId?: number; dateTime?: string | null }[];
        const seen = new Set();
        return (
          rows
            .filter((row) => !seen.has(row.dbId) && seen.add(row.dbId))
            // Ties broken the same way on both sides. Thousands of events share
            // a dateTime -- a batch edit gives them all one timestamp -- and
            // neither service orders within a tie, so the order is whatever the
            // query plan produced. It is not stable even for one service:
            // changing this query from a scan to an index lookup, a change
            // meant to be purely about speed, reordered 2,866 of 3,309 rows.
            //
            // Sorting both sides identically still checks the thing that
            // matters, which is that the dateTime sequence agrees. Comparing
            // the raw orders would only ever have compared two accidents.
            .sort((a, b) => {
              // Total and null-safe. The obvious form -- `a < b ? 1 : -1` --
              // returns -1 both ways when either side is null, which is an
              // inconsistent comparator, and V8 may then order such rows however
              // it likes on each side. Every InstanceEdit has a dateTime today,
              // all 160,392 of them, so it cannot bite; that was also true of
              // the unordered comparator's duplicate keys earlier the same day,
              // and the reasoning for fixing it then applies here.
              const left = a.dateTime ?? '';
              const right = b.dateTime ?? '';
              if (left !== right) return left < right ? 1 : -1;
              return (a.dbId ?? 0) - (b.dbId ?? 0);
            })
        );
      },
      differs: [
        /: java normalised by the endpoint's own rule before comparing$/,
        // An id that matches nothing: `[]` here, Java's bare empty 200 (see the
        // handler's note), as /publications declares too.
        /^\/ContentService\/data\/person\/[^/]+\/(authored|reviewed)(Pathways|Reactions): (content-type "application\/json"|body "\[\]"), java says ""$/,
      ],
    }))
  ),
  {
    // After /person/{id}/publications and the four lists: Express takes them in order.
    path: '/ContentService/data/person/{id}/{attribute}',
    sample: '1169272',
    samplePath: { attribute: 'publications' },
    differs: [/^\/ContentService\/data\/person\/[^/]+\/[^/]+: \.url: /],
    /**
     * One attribute of a person, as text: PersonController.findPerson(id,
     * attributeName) -- the person as PersonService.findPerson loads them
     * (findPerson), then the getter and its text as for
     * /data/query/{id}/{attributeName}. No person is Java's 404 naming the
     * id; no getter, or one returning nothing, its 404 naming the attribute.
     */
    handler: async (request) => {
      const id = pathId(rawSegment(request, 4));
      const attribute = pathId(rawSegment(request, 5));
      const person = await findPerson(id);
      if (!person) return notFound(request, `No person found for id: ${id}`);
      return attributeAnswer(request, person, attribute);
    },
  },
];
