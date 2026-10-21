/**
 * The content endpoints (spec 014, research R1, a family): /data/content/*,
 * the contents page's table of contents, DOIs and contributors, with the
 * helpers only they use. Moved unchanged from service.ts.
 */
import type { Endpoint } from './endpoint.ts';
import type { Props } from './objects.ts';
import { read } from './graph.ts';
import type {
  Contributor,
  DoiPathway,
  SimplePerson,
  TocPathway,
  TocSubpathway,
} from '../../projects/website-angular/src/model/content.model.ts';
import type { JsonWritten } from './answers.ts';
import { cached, compact } from './answers.ts';

/**
 * A Person's properties: dbId, displayName and surname always there --
 * measured over all 9,503 people the content endpoints return (content.model's
 * SimplePerson) -- firstname and orcidId often not.
 */
type PersonProps = Props & { dbId: number; displayName: string; surname: string };

/** A pathway in the contents lists: /content/toc and the DOI list. */
type PathwayListRow = {
  stId: string;
  displayName: string;
  doi: string | null;
  species: string | null;
  releaseDate: string | null;
  releaseStatus: string | null;
  reviseDate: string | null;
};

/**
 * Authors, reviewers and editors for a set of pathways, keyed by stId.
 *
 * A pathway's people are its own plus every one of its descendants', in that
 * order and deduplicated -- which is what Java's `COLLECT(DISTINCT own) +
 * COLLECT(DISTINCT descendants)` produces, and the order matters because these
 * come back as JSON arrays and a diff compares them element by element.
 *
 * Authors come from `authored` **or** `revised`. That looks like a mistake and
 * is not: Java reads both into the author list, and parity is the contract.
 *
 * `pattern` is spliced into the query, so it is written here and never taken
 * from a request. Both callers pass a literal.
 */
async function peopleByPathway(pattern, overrides = {}) {
  const roles = {
    authors: { own: ':authored|revised', descendants: ':authored|revised' },
    reviewers: { own: ':reviewed', descendants: ':reviewed' },
    editors: { own: ':edited', descendants: ':edited' },
    ...overrides,
  };
  const out = { authors: new Map(), reviewers: new Map(), editors: new Map() };

  for (const [role, relationship] of Object.entries(roles)) {
    const rows = await read<{ stId: string; own: PersonProps[]; sub: PersonProps[] }>(
      `MATCH ${pattern}
       OPTIONAL MATCH (p)<-[${relationship.own}]-(:InstanceEdit)<-[:author]-(own:Person)
       WITH p, COLLECT(DISTINCT own) AS own
       OPTIONAL MATCH (p)-[:hasEvent*]->(:Event)<-[${relationship.descendants}]-(:InstanceEdit)<-[:author]-(sub:Person)
       RETURN p.stId AS stId, own, COLLECT(DISTINCT sub) AS sub`
    );
    for (const row of rows) {
      const seen = new Map();
      // COLLECT leaves out nulls and gives [] for none.
      for (const person of [...row.own, ...row.sub]) {
        if (!seen.has(person.dbId)) seen.set(person.dbId, person);
      }
      out[role].set(row.stId, [...seen.values()]);
    }
  }
  return out;
}

/**
 * SimplePerson, from each person's properties. A field the person lacks is
 * undefined and JSON leaves it out, as Java's non_empty does: written, it is
 * the site's SimplePerson, which is what the cast says.
 */
function simplePeople(persons: PersonProps[] | undefined): SimplePerson[] {
  return (persons ?? []).map((person) => {
    const written: JsonWritten<SimplePerson> = {
      dbId: person.dbId,
      displayName: person.displayName,
      surname: person.surname,
      firstname: person.firstname,
      orcidId: person.orcidId,
    };
    return written as SimplePerson;
  });
}

export const contentEndpoints: Endpoint[] = [
  {
    path: '/ContentService/data/content/toc',
    /**
     * The one difference from Java, declared so the harness reports it as
     * intended rather than as a fault -- and so that its disappearance would be
     * reported too.
     */
    differs: [/subpathways\[\d+\]\.doi: extra/],
    /**
     * The contents page: every top-level pathway, its people, and its children.
     *
     * Java runs one query and pays for it. Its `RETURN` is preceded by
     *
     *     UNWIND allAuthors AS totalAtrs
     *     UNWIND allReviewers AS totalRvwd
     *     UNWIND allEditors AS totalEdtd
     *
     * which is a cartesian product of three lists before the COLLECT(DISTINCT)
     * that puts them back: a pathway with 1 author, 10 reviewers and 1 editor
     * produces ten rows to build three lists. It also means a pathway with no
     * authors at all produces **no rows**, because `UNWIND []` yields none --
     * so it would disappear from the contents page entirely. The sibling DOI
     * query guards that exact case with `CASE allAuthors WHEN [] THEN [null]`;
     * this one does not. Measured against the current graph: 34 top-level
     * pathways, 34 returned, 0 with no authors, so it does not bite today. It
     * is a trap waiting for the first pathway curated without one.
     *
     * Here the roles are gathered separately and assembled in JS, which keeps
     * the empty case an empty list rather than a vanished pathway.
     *
     * One more thing the port surfaced and deliberately does not fix: the
     * `hasEvent` relationship carries a curated `order` -- for Autophagy,
     * Macroautophagy 0, Chaperone Mediated Autophagy 1, Late endosomal
     * microautophagy 2 -- and neither implementation reads it. Both emit
     * children in internal node id order, so the contents page has never shown
     * them in the sequence a curator chose. Parity first: that is a change to
     * announce rather than to smuggle in with a port.
     */
    handler: cached('content/toc', async () => {
      const pathways = await read<PathwayListRow & { children: Props[] }>(
        `MATCH (p:TopLevelPathway {isInferred: false})
         OPTIONAL MATCH (p)-[:hasEvent]->(child:Pathway)
         // By internal id, because that is the order Java emits: its planner
         // expands in id order and nothing sorts afterwards. Measured on
         // Autophagy -- ids 1, 4985, 16885 -- against Java's own output.
         // See the note above this query about the curated order nobody uses.
         WITH p, child ORDER BY id(child)
         WITH p, COLLECT(child) AS children
         OPTIONAL MATCH (p)<-[:revised]-(re:InstanceEdit)
         RETURN p.stId AS stId, p.displayName AS displayName, p.doi AS doi,
                p.speciesName AS species, p.releaseDate AS releaseDate,
                p.releaseStatus AS releaseStatus, MAX(re.dateTime) AS reviseDate,
                children
         ORDER BY toLower(p.displayName)`
      );

      const people = await peopleByPathway('(p:TopLevelPathway {isInferred: false})', {
        authors: { own: ':authored|revised', descendants: ':authored|revised' },
      });

      const body = pathways.map((row) =>
        compact<TocPathway>({
          stId: row.stId,
          displayName: row.displayName,
          doi: row.doi,
          species: row.species,
          releaseDate: row.releaseDate,
          reviseDate: row.reviseDate,
          releaseStatus: row.releaseStatus,
          authors: simplePeople(people.authors.get(row.stId)),
          reviewers: simplePeople(people.reviewers.get(row.stId)),
          editors: simplePeople(people.editors.get(row.stId)),
          subpathways: row.children.map((child) =>
            compact<TocSubpathway>({
              stId: child.stId,
              displayName: child.displayName,
              // Java passes `null` here -- `new TocSubpathway(stId, displayName,
              // null, speciesName)` in ContentPageManager -- and Jackson drops it,
              // which is why 41 of the 44 DOIs this page should show never reached
              // a browser. The query already returns the child as a full Pathway
              // node, so the value was in hand the whole time.
              //
              // A deliberate difference from Java, not a parity failure. The diff
              // harness is told to expect it.
              doi: child.doi,
              speciesName: child.speciesName,
            })
          ),
        })
      );
      return { status: 200, body, type: 'application/json' };
    }),
  },
  {
    path: '/ContentService/data/content/doi',
    /**
     * Every pathway that carries a DOI, with the same people as the contents
     * page and no children.
     *
     * The Java query is the one that gets the empty case right, via
     * `CASE allAuthors WHEN [] THEN [null] ELSE allAuthors END` -- which keeps
     * the row but puts a literal null in the list, and `toSimplePerson(null)`
     * returns null, so a pathway with no authors would serialise `[null]`
     * rather than `[]`. No pathway in the current graph does, so nothing has
     * ever seen it. An empty list is what this returns.
     */
    handler: cached('content/doi', async () => {
      const pathways = await read<PathwayListRow>(
        `MATCH (p:Pathway) WHERE p.doi IS NOT NULL
         OPTIONAL MATCH (p)<-[:revised]-(re:InstanceEdit)
         RETURN p.stId AS stId, p.displayName AS displayName, p.doi AS doi,
                p.speciesName AS species, p.releaseDate AS releaseDate,
                p.releaseStatus AS releaseStatus, MAX(re.dateTime) AS reviseDate
         ORDER BY toLower(p.displayName)`
      );

      const people = await peopleByPathway('(p:Pathway) WHERE p.doi IS NOT NULL', {
        // Not a copy of the contents query. Java's DOI query reads
        // `authored|revised` for the pathway itself and **`authored` alone**
        // for its descendants; the contents query reads both at both levels.
        // The diff caught it: this endpoint listed three authors where Java
        // listed two.
        authors: { own: ':authored|revised', descendants: ':authored' },
      });

      const body = pathways.map((row) =>
        compact<DoiPathway>({
          stId: row.stId,
          displayName: row.displayName,
          doi: row.doi,
          species: row.species,
          releaseDate: row.releaseDate,
          reviseDate: row.reviseDate,
          releaseStatus: row.releaseStatus,
          authors: simplePeople(people.authors.get(row.stId)),
          reviewers: simplePeople(people.reviewers.get(row.stId)),
          editors: simplePeople(people.editors.get(row.stId)),
        })
      );
      return { status: 200, body, type: 'application/json' };
    }),
  },
  {
    path: '/ContentService/data/content/contributors',
    /**
     * Everyone who has authored or reviewed an event, and how much.
     *
     * The query is derived from the endpoint's answers rather than from Java's
     * source: graph-core's snapshot jar in the local repository does not carry
     * the class that holds it. So the semantics were pinned by measurement --
     * `Pathway` and `ReactionLikeEvent` reached through the person's
     * InstanceEdits -- and checked against a contributor with large numbers
     * before a line was written:
     *
     *     computed   154 authored pathways, 922 reactions, 375 reviewed, 2104
     *     java says  154                    922           375            2104
     *
     * 999 people, which is every person who authored or reviewed an Event. It
     * looked like a cap at first -- 1,028 people have an InstanceEdit -- and it
     * is not: the other 29 have edits that are not authorship or review of an
     * event. Worth checking rather than assuming, because a silent cap on a
     * contributors page would be an unpleasant thing to ship.
     */
    handler: cached('content/contributors', async () => {
      const rows = await read<{
        person: PersonProps;
        authoredPathways: number;
        authoredReactions: number;
        reviewedPathways: number;
        reviewedReactions: number;
      }>(
        `MATCH (person:Person)-[:author]->(:InstanceEdit)-[:authored|reviewed]->(:Event)
         WITH DISTINCT person
         OPTIONAL MATCH (person)-[:author]->(:InstanceEdit)-[:authored]->(ap:Pathway)
         WITH person, count(DISTINCT ap) AS authoredPathways
         OPTIONAL MATCH (person)-[:author]->(:InstanceEdit)-[:authored]->(ar:ReactionLikeEvent)
         WITH person, authoredPathways, count(DISTINCT ar) AS authoredReactions
         OPTIONAL MATCH (person)-[:author]->(:InstanceEdit)-[:reviewed]->(rp:Pathway)
         WITH person, authoredPathways, authoredReactions, count(DISTINCT rp) AS reviewedPathways
         OPTIONAL MATCH (person)-[:author]->(:InstanceEdit)-[:reviewed]->(rr:ReactionLikeEvent)
         RETURN properties(person) AS person, authoredPathways, authoredReactions,
                reviewedPathways, count(DISTINCT rr) AS reviewedReactions`
      );

      const body = rows.map((row) =>
        compact<Contributor>({
          person: simplePeople([row.person])[0],
          // Counts, not lists: `non_empty` has no notion of an empty number, so
          // a zero is serialised rather than omitted.
          authoredPathways: row.authoredPathways,
          reviewedPathways: row.reviewedPathways,
          authoredReactions: row.authoredReactions,
          reviewedReactions: row.reviewedReactions,
        })
      );
      return { status: 200, body, type: 'application/json' };
    }),
    /**
     * Order is the one thing here that is not reproduced, and nothing reads it.
     *
     * Java's order is not by name, dbId, any of the four counts, their total, or
     * a Java HashMap's iteration order -- all five checked against the live
     * response, none matched -- so it is whatever its aggregation happened to
     * emit. The contributors page sorts client-side before rendering
     * (`contributors.component.ts`, `sortKey: SortKey = 'displayName'`), so no
     * reader ever sees the order this endpoint returns.
     *
     * `unordered` tells the diff to sort both sides by dbId before comparing, so
     * all 999 entries are still checked field by field -- 999 of 999 identical --
     * and only the ordering is declared. Declaring it the other way, as a
     * pattern matching element-level differences, would have hidden a wrong
     * count just as happily as a shuffled list.
     */
    unordered: (entry) => (entry as { person: { dbId: number } }).person.dbId,
    differs: [/^\/ContentService\/data\/content\/contributors: order differs from java's$/],
  },
];
