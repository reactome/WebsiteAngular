/**
 * The content service, in node.
 *
 * A gradual replacement for the Java ContentService's read surface. It exposes
 * the same paths under the same shapes, one endpoint at a time, and every one is
 * proven against the Java implementation by `diff.mjs` before it is switched on
 * in `proxy.conf.js`.
 *
 * Deliberately not a rewrite in one go, and deliberately not the exporters:
 * SBML, SBGN and the PDF document come from Java libraries that carry those
 * specifications, and reimplementing them is a research project rather than a
 * port. Diagram figures already come from our own renderer.
 *
 *   NEO4J_USER=... NEO4J_PASSWORD=... npm run content:node
 *
 * Nothing points at it until a path is listed in proxy.conf.js, so running it
 * cannot affect the site.
 */
import express from 'express';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, URLSearchParams } from 'node:url';
import neo4j from 'neo4j-driver';
import { read, configured, close } from './graph.mjs';
import { solr, solrConfigured } from './solr.mjs';
import {
  enhancedQuery,
  findByIdParameters,
  findByIdQuery,
  inDepthQuery,
  isA,
  javaDouble,
  JsonMap,
  mapNodes,
  oldEnhancedQuery,
  mapResult,
  rootLabelsQuery,
  summaryEntity,
  VIEW,
  writeDomain,
} from './domain.mjs';
import {
  attributeTable,
  isSchemaClass,
  isSpeciesClass,
  referralsTable,
  schemaClassOf,
  schemaModelTree,
} from './schema.mjs';

const PORT = Number(process.env.CONTENT_NODE_PORT) || 4400;
const HOST = process.env.CONTENT_NODE_HOST || '127.0.0.1';

/**
 * The endpoints implemented so far, in the order they were ported.
 *
 * Each entry is the path the Java service uses, so the diff harness and the
 * proxy table can both address them by that one string.
 */
export const endpoints = [
  {
    path: '/ContentService/data/database/version',
    // The release the database holds. One row, one value: the smallest possible
    // first port, chosen to prove the plumbing rather than the mapping -- and it
    // still caught a wrong guess. The property is `releaseNumber`; `version` does
    // not exist on DBInfo and returned null, which the diff reported against
    // Java's 97 before anything could be switched on.
    /**
     * Cached, like every other list here, and for a sharper reason: measured
     * against Java, this answered in 286ms where Java took 1.1ms, because Java
     * holds the value and this went to the graph on every request. The site
     * asks for the release on every page load -- it is what keys the bucket
     * paths for diagrams, figures and icons -- so that was the most-called
     * endpoint of the set and the slowest.
     *
     * Safe for the same reason Java's is: the release number changes when the
     * database is replaced, and that restarts the service.
     *
     * Not fixable with an index on this instance, and the reason is worth
     * knowing before porting anything else: there is no token index here, so
     * `MATCH (n:DBInfo)` plans as `AllNodesScan + Filter` and reads all
     * 2,958,129 nodes to find one. ~700ms, and the same for any label-only
     * match -- which is why Java's `/data/species/main` takes 682ms too. See
     * the note on `read` in graph.mjs.
     *
     * Caching is the fix available from this side. The service warms every
     * `cached` handler at startup, so the scan is paid once, off the request
     * path, and never by a reader.
     */
    handler: cached('database/version', async () => {
      const [row] = await read('MATCH (n:DBInfo) RETURN n.releaseNumber AS version LIMIT 1');
      if (!row) return { status: 404, body: 'no DBInfo node' };
      return { status: 200, body: String(row.version), type: 'text/plain;charset=UTF-8' };
    }),
  },
  {
    path: '/ContentService/data/database/name',
    handler: cached('database/name', async () => {
      const [row] = await read('MATCH (n:DBInfo) RETURN n.name AS name LIMIT 1');
      if (!row) return { status: 404, body: 'no DBInfo node' };
      return { status: 200, body: String(row.name), type: 'text/plain;charset=UTF-8' };
    }),
  },
  {
    path: '/ContentService/data/pathways/top/{id}',
    // Compared by default. Without a sample this endpoint expanded to nothing
    // and sat in the table unexamined for weeks.
    sample: '9606',
    /**
     * The 404 body names the service that answered, so two services on
     * different ports must disagree about it -- the field is doing its job.
     * Behind nginx they agree, because `proxy_set_header Host $host` gives both
     * the same external name. Declared narrowly: only `.url`, and only here.
     */
    differs: [/^\/ContentService\/data\/pathways\/top\/\d+: \.url: /],
    /**
     * The top-level pathways for a species, which is the pathway browser's first
     * request and the release checklist's "29 clicks".
     *
     * Three details the shape depends on, each learned from the Java response
     * rather than assumed:
     *  - fields whose property is absent are *omitted*, not null (doi and
     *    releaseStatus are on a minority of pathways, lastUpdatedDate on 28 of
     *    29). Jackson drops nulls, so emitting them would differ on every item.
     *  - `className` repeats `schemaClass`; the graph stores only the latter.
     *  - `species` is an array of one object, and it carries a different field
     *    set from the pathway: no stId, no dates.
     */
    handler: async (request) => {
      // As Spring binds it: a ';' matrix parameter dropped from the segment as
      // sent, then decoded (pathId) -- so 9606;x is 9606.
      const taxId = pathId(rawSegment(request, 5));
      // content-service decodes the species once more (URLDecoder), so
      // 'Homo+sapiens' finds human; a malformed escape is Java's 500. The 404
      // message below names the species before that decoding, as Java's does.
      let decoded;
      try {
        decoded = javaUrlDecode(taxId);
      } catch (failure) {
        return javaError(request, 500, 'INTERNAL_SERVER_ERROR', failure.message);
      }
      const { where, params } = topSpeciesMatch(decoded);
      const rows = await read(
        `MATCH (p:TopLevelPathway)-[:species]->(s:Species)
         WHERE ${where}
         RETURN properties(p) AS pathway, properties(s) AS species
         // toLower, as /content/toc already does. Neo4j orders by code point,
         // so uppercase sorts before lowercase and "DNA Repair" landed before
         // "Developmental Biology"; Java's collation is case-insensitive.
         ORDER BY toLower(p.displayName)`,
        params
      );
      // Java answers 404, not an empty list, when a species has no top-level
      // pathways -- checked for both an unknown id and taxId 1, which exists.
      if (!rows.length) {
        return notFound(request, `No TopLevelPathways were found for species: ${taxId}`);
      }

      // Scoped to this response: the back-reference is only meaningful within
      // the document it appears in.
      const seenSpecies = new Set();
      const full = (species) => {
        seenSpecies.add(species.dbId);
        return {
          ...only(species, ['dbId', 'displayName', 'name', 'taxId', 'abbreviation']),
          className: species.schemaClass,
          schemaClass: species.schemaClass,
        };
      };

      const body = rows.map(({ pathway, species }) =>
        // Jackson writes a repeated object once and then refers back to it by
        // dbId -- the default of the service-wide `includeRef` parameter, which
        // only changes the *form* of the back-reference to JSOG `{@ref}`. So
        // all 29 human pathways share one Species and only the first carries it.
        //
        // Not a nicety: emitting the object 29 times is a different response
        // shape, and a caller written against Java's would read `species[0]` as
        // a number on all but the first item. Nothing caught this because the
        // diff expands `{id}` only when given `--ids`, so this endpoint had
        // never once been compared.
        topPathwayJson(pathway, seenSpecies.has(species.dbId) ? species.dbId : full(species))
      );
      return { status: 200, body, type: 'application/json' };
    },
  },
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
      const pathways = await read(
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
        compact({
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
          subpathways: (row.children ?? []).map((child) =>
            compact({
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
      const pathways = await read(
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
        compact({
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
      const rows = await read(
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
        compact({
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
    unordered: (entry) => entry.person.dbId,
    differs: [/^\/ContentService\/data\/content\/contributors: order differs from java's$/],
  },
  {
    path: '/ContentService/data/person/{id}',
    // A curator with affiliations, an ORCID cross-reference and publications.
    sample: '1169272',
    // The 404 body names the service that answered; see /pathways/top/{id}.
    differs: [/^\/ContentService\/data\/person\/[^/]+: \.url: /],
    /**
     * A person, by dbId or ORCID, with their affiliations, cross-references and
     * publications: graph-core's findPersonByDbId / findPersonByOrcidId,
     * written by the domain serialiser (domain.mjs) in Java's views.
     *
     * Java matches `(n:Person{dbId:$dbId})`, which no index serves: 1.1s on
     * every request. The same person by its indexed DatabaseObject dbId is the
     * same node, expanded the same way -- Java's answer by dbId and by ORCID
     * are byte for byte the same -- in milliseconds.
     */
    handler: async (request) => {
      const id = pathId(rawSegment(request, 4));
      const person = personWhere(id);
      if (!person) return notFound(request, `No person found for id: ${id}`);
      const options = { anchor: person.anchor, ordered: false, without: 'InstanceEdit' };
      const [found] = await read(rootLabelsQuery(person.where, options), person.params);
      if (!found) return notFound(request, `No person found for id: ${id}`);
      const [row] = await read(findByIdQuery(person.where, options), {
        ...person.params,
        ...findByIdParameters(found.labels),
      });
      return {
        status: 200,
        serialised: writeDomain(mapResult(row), ...writerFor(request)),
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
    unordered: (entry) => (typeof entry === 'number' ? entry : entry.dbId),
    differs: [
      /^\/ContentService\/data\/person\/[^/]+\/publications: order differs from java's$/,
      // An unreadable id: `[]` here, Java's empty 200 (see above).
      /^\/ContentService\/data\/person\/[^/]+\/publications: (content-type "application\/json"|body "\[\]"), java says ""$/,
    ],
    handler: async (request) => {
      const id = pathId(rawSegment(request, 4));
      const person = personWhere(id, { email: true });
      if (!person) return { status: 200, serialised: '[]', type: 'application/json' };
      const rows = await read(
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
    ].map(([suffix, label]) => ({
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
        // The raw segment, as every handler reads its id: Express's decoded
        // params lose the matrix-parameter difference (see pathId).
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
        const rows = await read(
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
        const body = [];
        for (const row of rows) {
          if (seen.has(row.dbId)) continue;
          seen.add(row.dbId);
          body.push(
            compact({
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
        const seen = new Set();
        return (
          javaBody
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
  ...[
    {
      suffix: 'main',
      /**
       * A species Reactome has curated pathways for, which is the list every
       * species selector on the site offers.
       *
       * "Main" is not a property on the node -- all 96 Species carry exactly the
       * same six -- it is a relationship: 16 of them are the target of at least
       * one TopLevelPathway's `species`, and 16 is what Java returns. Checked
       * against the graph rather than inferred from the count matching, because
       * two numbers agreeing is not a rule.
       */
      match: '(s:Species)<-[:species]-(:TopLevelPathway)',
    },
    { suffix: 'all', match: '(s:Species)' },
  ].map(({ suffix, match }) => ({
    path: `/ContentService/data/species/${suffix}`,
    /**
     * The species lists, which differ in their order as well as their contents.
     *
     * `main` puts Homo sapiens first and sorts the rest by name; `all` is plain
     * alphabetical, human included, in its place. Both verified against the live
     * responses -- and the difference is the reason they are written as two rows
     * of one generator rather than one handler taking a flag, because a shared
     * sort would have quietly given `all` a pinned human or `main` an unpinned
     * one, and the page would still have rendered.
     *
     * Reactome pins human because it is the reference species everything else is
     * inferred from, so a selector that buries it between Gallus and Mus is
     * asking every reader to hunt for the common case.
     */
    handler: cached(`species/${suffix}`, async () => {
      const rows = await read(
        `MATCH ${match}
         WITH DISTINCT s
         RETURN properties(s) AS species
         ORDER BY CASE WHEN s.displayName = 'Homo sapiens' THEN 0 ELSE 1 END, s.displayName`
      );
      const body = rows.map(({ species }) => ({
        ...only(species, ['dbId', 'displayName', 'name', 'taxId', 'abbreviation']),
        className: species.schemaClass,
        schemaClass: species.schemaClass,
      }));
      // `all` is alphabetical throughout, so the pin the query applies for
      // `main` is undone here rather than by a second query. One ORDER BY that
      // both share, and one line saying which of them does not want it.
      if (suffix === 'all') body.sort((a, b) => (a.displayName < b.displayName ? -1 : 1));
      return { status: 200, body, type: 'application/json' };
    }),
  })),
  {
    path: '/ContentService/data/query/enhanced/v2/{id}',
    sample:
      'R-HSA-70486?fetchIncomingRelationships=true&summariseReferenceEntity=true&includeDisease=true&includeRef=true&view=nested-aggregated',
    differs: [/^\/ContentService\/data\/query\/enhanced\/v2\/[^/]+[^:]*: \.url: /],
    /**
     * An object with everything around it, for the Pathway Browser's details
     * panel and the website's detail pages -- the site's busiest content
     * call. graph-core's findEnhancedObjectById (enhancedQuery), written by
     * the domain serialiser in the request's view; a reference entity, when
     * asked to summarise, as the content service's SummaryEntity
     * (summaryEntity).
     *
     * As QueryObjectController: three primitive booleans with defaults
     * (fetchIncomingRelationships true, summariseReferenceEntity false,
     * includeDisease true); incoming relationships only when asked for and
     * needsIncoming agrees; an object found only with its disease data,
     * asked for without, looked up again with it.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 6));
      const flags = {};
      for (const [name, fallback] of [
        ['fetchIncomingRelationships', true],
        ['summariseReferenceEntity', false],
        ['includeDisease', true],
      ]) {
        const parsed = springPrimitiveBoolean(queryValues(request, name), fallback);
        if (parsed.error) return javaError(request, 400, 'BAD_REQUEST', parsed.error);
        flags[name] = parsed.value;
      }
      const id = inDepthId(raw);
      const missing = () => notFound(request, `Id: ${raw} has not been found in the System`);
      if (!id) return missing();
      const options = {
        idType: id.idType,
        summarise: flags.summariseReferenceEntity,
        includeDisease: flags.includeDisease,
        outgoingOnly: !(flags.fetchIncomingRelationships && (await needsIncoming(raw))),
      };
      let [row] = await read(enhancedQuery(options), { id: id.id });
      if (!row && !options.includeDisease)
        [row] = await read(enhancedQuery({ ...options, includeDisease: true }), { id: id.id });
      if (!row) return missing();
      const found = mapResult(row);
      const object =
        flags.summariseReferenceEntity && isA(found.schemaClass, 'ReferenceEntity')
          ? summaryEntity(found)
          : found;
      return {
        status: 200,
        serialised: writeDomain(object, ...writerFor(request)),
        type: 'application/json',
      };
    },
  },
  {
    // Before /query/{id}/stId and /normalPathway, as Spring ranks its literal
    // `enhanced` above their {id}: /query/enhanced/stId is this, with id stId.
    path: '/ContentService/data/query/enhanced/{id}',
    sample: 'R-HSA-70486',
    differs: [/^\/ContentService\/data\/query\/enhanced\/[^/]+: \.url: /],
    /**
     * An object with its neighbours and some of theirs: graph-core's
     * findOldEnhancedObjectById (oldEnhancedQuery), written by the domain
     * serialiser in the request's view. The entity popup, the website's
     * content pages and the IDG panel read it.
     *
     * Its relationships go both ways unless QueryObjectController's
     * needsIncomingRelationship says not (needsIncoming). The id is read as
     * getIdentifier reads it (inDepthId).
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 5));
      const id = inDepthId(raw);
      const missing = () => notFound(request, `Id: ${raw} has not been found in the System`);
      if (!id) return missing();
      const outgoingOnly = !(await needsIncoming(raw));
      const [row] = await read(oldEnhancedQuery({ idType: id.idType, outgoingOnly }), {
        id: id.id,
      });
      if (!row) return missing();
      return {
        status: 200,
        serialised: writeDomain(mapResult(row), ...writerFor(request)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/query/{id}/stId',
    // A reaction by dbId, so the comparison covers the lookup the site makes.
    sample: '70486',
    // The 404 body names the service that answered; see /pathways/top/{id}.
    differs: [/^\/ContentService\/data\/query\/[^/]+\/stId: \.url: /],
    /**
     * An object's stable id, asked for as text.
     *
     * The site calls this whenever it meets a dbId -- an old link, a legacy
     * fragment, a URL parameter -- to swap it for the stable id: 13 bytes, where
     * fetching the object to read one field is 12KB. Java serves it from the
     * general `/data/query/{id}/{attributeName}`; only this attribute is ported,
     * so the route is exact.
     *
     * The id is resolved as Java resolves it (see resolveId): a stable id, a
     * pre-2016 REACT_ id or a dbId, with any version suffix ignored. An object
     * that has no stable id -- a Species, a ReferenceEntity -- is Java's 404 with
     * its own message, not an empty 200.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const { where, params } = resolveId(raw);
      const rows = await read(
        `MATCH (n:DatabaseObject) WHERE ${where}
         RETURN n.stId AS stId, n.schemaClass AS schemaClass LIMIT 1`,
        params
      );
      const [row] = rows;
      if (!row) return notFound(request, `Id: ${raw} has not been found in the System`);
      if (row.stId === null || row.stId === undefined)
        return notFound(
          request,
          `Attribute: 'stId' has not been found for object: ${String(row.schemaClass)}`
        );
      return { status: 200, body: String(row.stId), type: 'text/plain;charset=UTF-8' };
    },
  },
  {
    path: '/ContentService/data/query/{id}',
    // A reaction: inputs with stoichiometry, a catalyst, preceding events.
    sample: 'R-HSA-70486',
    differs: [
      // The 404 body names the service that answered; see /pathways/top/{id}.
      /^\/ContentService\/data\/query\/[^/]+: \.url: /,
      // JSOG numbers objects in the order it meets them, and in the nested
      // views Java meets some properties in an order it does not keep from one
      // start to the next (domain.mjs, writeDomain): R-HSA-5672965's inputs
      // and outputs swap. The references still agree within each answer.
      /^[^:]*(?=[^:]*includeRef=true)(?=[^:]*view=nested)[^:]*: \S*\.@(id|ref): /,
    ],
    /**
     * One object with everything it points to: graph-core's
     * findById(id, OUTGOING), written as Java's Jackson writes it (domain.mjs
     * does both). The Pathway Browser's details panel and the website's detail
     * pages read it for every object they show.
     *
     * Java's message converter reads two parameters on every response it
     * writes: `view` picks the StoichiometryView (nested, nested-aggregated,
     * or flatten for anything else) and `includeRef=true` swaps dbId
     * references for JSOG's @id/@ref. Both are read here as the servlet reads
     * them -- the first value, `true` in any case.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const { where, params } = resolveId(raw);
      const [found] = await read(rootLabelsQuery(where), params);
      if (!found) return notFound(request, `Id: ${raw} has not been found in the System`);
      const [row] = await read(findByIdQuery(where), {
        ...params,
        ...findByIdParameters(found.labels),
      });
      if (!row) return notFound(request, `Id: ${raw} has not been found in the System`);
      return {
        status: 200,
        serialised: writeDomain(mapResult(row), ...writerFor(request)),
        type: 'application/json',
      };
    },
  },
  ...[
    {
      kind: 'entity',
      label: 'PhysicalEntity',
      follow: 'hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker',
      // A complex of a complex, so there is more than one level to follow.
      sample: 'R-HSA-109796?includeRef=true&view=nested-aggregated',
    },
    {
      kind: 'event',
      label: 'Event',
      follow: 'hasEvent',
      sample: 'R-HSA-69620?includeRef=true&view=nested-aggregated',
    },
  ].map(({ kind, label, follow, sample }) => ({
    path: `/ContentService/data/${kind}/{id}/in-depth`,
    // A whole tree below an object: may run for the full read timeout.
    deep: true,
    sample,
    differs: [
      // The 404 body names the service that answered; see /pathways/top/{id}.
      new RegExp(`^/ContentService/data/${kind}/[^/]+/in-depth[^:]*: \\.url: `),
      // An `attributes` that is not relationship type names: Java writes it
      // into its query and answers Neo4j's syntax error; node refuses it before
      // any query, with a message of its own.
      new RegExp(`^/ContentService/data/${kind}/[^/]+/in-depth[^:]*: \\.messages\\[0\\]: `),
    ],
    /**
     * An entity or an event and everything below it -- the Pathway Browser's
     * object tree and details panel read them -- as graph-core's
     * getPhysicalEntityInDepth / getEventInDepth: every path from it along
     * its structure (`follow`) up to `maxDepth` steps, each node with
     * its `attributes` relationships, written by the domain serialiser in the
     * view the request asks for (the site asks nested-aggregated with JSOG).
     *
     * As Java: `maxDepth` (default 1) of 0 means 1 and below 0 means no limit;
     * `attributes` (default species,compartment) is split on commas, trailing
     * empties dropped, and an empty list means species. An id is read as
     * graph-core's getIdentifier reads it (inDepthId). With no path below it
     * there is no answer at all: an entity
     * is Java's empty 200, an event its 404.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const depth = springIntWithDefault(queryValues(request, 'maxDepth'), 1);
      if (depth.error) return javaError(request, 400, 'BAD_REQUEST', depth.error);
      const attributes = inDepthAttributes(queryValues(request, 'attributes'));
      if (attributes.error)
        return javaError(request, 500, 'INTERNAL_SERVER_ERROR', attributes.error);
      const id = inDepthId(raw);
      const none =
        kind === 'entity'
          ? { status: 200, body: undefined }
          : notFound(request, `No event found for given identifier: ${raw}`);
      if (!id) return none;
      const maxDepth = depth.value === 0 ? 1 : depth.value < 0 ? 2147483647 : depth.value;
      const [row] = await read(
        inDepthQuery({ label, follow, idType: id.idType, maxDepth, attributes: attributes.value }),
        { id: id.id }
      );
      if (!row) return none;
      return {
        status: 200,
        serialised: writeDomain(mapResult(row), ...writerFor(request)),
        type: 'application/json',
      };
    },
  })),
  {
    path: '/ContentService/data/query/{id}/normalPathway',
    // A disease pathway, by stable id; the diff harness is given more forms.
    sample: 'R-HSA-6802957',
    // The 404 body names the service that answered; see /pathways/top/{id}.
    differs: [/^\/ContentService\/data\/query\/[^/]+\/normalPathway: \.url: /],
    /**
     * The normal pathway a disease pathway is drawn on, as one line of text.
     *
     * The Pathway Browser asks for this when a disease pathway has no diagram
     * of its own, then loads the normal pathway's diagram in its place. Java
     * serves it from the general `/data/query/{id}/{attributeName}`, as it does
     * stId: the object's getter, written by ControllerUtils.toTSV (see
     * databaseObjectTsv). Only Pathway and its subclasses have the getter, so
     * for anything else -- and for a pathway without one -- it is Java's 404
     * naming the object's class.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const { where, params } = resolveId(raw);
      const rows = await read(
        `MATCH (n:DatabaseObject) WHERE ${where}
         OPTIONAL MATCH (n:Pathway)-[:normalPathway]->(m:DatabaseObject)
         RETURN labels(n) AS labels, m.dbId AS dbId, m.stId AS stId,
                m.displayName AS displayName, labels(m) AS targetLabels LIMIT 1`,
        params
      );
      const [row] = rows;
      if (!row) return notFound(request, `Id: ${raw} has not been found in the System`);
      if (row.dbId === null || row.dbId === undefined)
        return notFound(
          request,
          `Attribute: 'normalPathway' has not been found for object: ${schemaClassOf(row.labels)}`
        );
      return {
        status: 200,
        body: databaseObjectTsv({
          dbId: row.dbId,
          stId: row.stId,
          displayName: row.displayName,
          schemaClass: schemaClassOf(row.targetLabels),
        }),
        type: 'text/plain;charset=UTF-8',
      };
    },
  },
  {
    path: '/ContentService/data/event/{id}/ancestors',
    // A reaction reached by two routes, so the comparison covers more than one path.
    sample: 'R-HSA-5672965',
    // The 404 body names the service that answered; see /pathways/top/{id}.
    differs: [/^\/ContentService\/data\/event\/[^/]+\/ancestors: \.url: /],
    /**
     * Every route from an event up to a top-level pathway, each as a list that
     * starts at the event itself. A top-level pathway is its own single route.
     *
     * The Pathway Browser asks for this on every pathway it opens, to place it
     * in the hierarchy and to find a diagram for a pathway that has none.
     *
     * Java's query, kept: one match for "is a top-level pathway", one for the
     * paths up, joined by UNION, which also drops repeated routes. The id is
     * resolved first on the indexed DatabaseObject properties (see resolveId)
     * rather than as `:Event{stId}`, and the labels checked after.
     *
     * The fields are graph-core's EventProjection, in the order Jackson writes
     * it: field-backed properties in declaration order, then `inferred` and
     * `inDisease`, whose getters do not match their `is...` fields. Absent
     * values are omitted, except the ones the projection defaults: false for
     * the flags, 0 for the diagram size.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const { where, params } = resolveId(raw);
      const rows = await read(
        `MATCH (n:DatabaseObject) WHERE ${where}
         WITH n LIMIT 1
         MATCH (n:TopLevelPathway)
         RETURN [n] AS nodes
         UNION
         MATCH (n:DatabaseObject) WHERE ${where}
         WITH n LIMIT 1
         MATCH route = (n:Event)<-[:hasEvent*]-(:TopLevelPathway)
         RETURN nodes(route) AS nodes`,
        params
      );
      if (rows.length === 0) return notFound(request, `No ancestors found for given event: ${raw}`);
      return {
        status: 200,
        body: rows.map((row) => row.nodes.map(eventProjection)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/pathways/low/entity/{id}',
    // A protein in ten lower-level pathways: every row of the answer is mapped.
    sample: 'R-HSA-199420',
    // The 404 body names the service that answered; see /pathways/top/{id}.
    differs: [/^\/ContentService\/data\/pathways\/low\/entity\/[^/]+: \.url: /],
    /**
     * The lower-level pathways an entity or event takes part in, optionally in
     * one species. The Pathway Browser asks for it from the entity popup and
     * the participating-pathways list ("where else does this appear?").
     *
     * Java's three queries, kept as graph-core writes them
     * (PathwayRepository.getPathwaysFor*): pathways that reach the object
     * through any participant relationship, pathways that contain it as a
     * reaction, and the object itself if it is a pathway, joined by UNION.
     * Kept as written rather than tidied, because the row order of the answer
     * is the order those queries produce.
     *
     * The id is read as everywhere else (resolveId, pathId). A pre-2016 REACT_
     * id is first swapped for its stable id, as graph-core's getIdentifier does,
     * so the query is the stable-id one Java runs.
     *
     * `species` is read as graph-core's SpeciesService reads it (speciesFilter).
     * A species that is not found filters nothing, as in Java; the 404 message
     * repeats the parameter as given, and says "null" when there is none.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 6));
      // By the servlet's rules (queryValues), not Express's query parser, which
      // reads brackets in a name as structure; repeated, Spring joins them.
      const given = queryValues(request, 'species');
      const species = given.length ? given.join(',') : undefined;
      const missing = () =>
        notFound(request, `No result for ${raw} in ${species === undefined ? 'null' : species}`);

      let { where, params } = resolveId(raw);
      if (where === 'false') return missing();
      if (where.startsWith('n.oldStId')) {
        const [found] = await read(
          'MATCH (n:DatabaseObject) WHERE n.oldStId = $id RETURN n.stId AS stId LIMIT 1',
          params
        );
        // Not found: Java keeps the REACT_ id and looks for it as a stable id,
        // which finds nothing.
        params = { id: found?.stId ?? params.id };
        where = 'n.stId = $id';
      }
      const object = where.startsWith('n.dbId') ? '{dbId: toInteger($id)}' : '{stId: $id}';

      const taxId = await speciesTaxId(speciesFilter(species));
      const inSpecies = taxId === undefined ? '' : '-[:species]->(:Species{taxId:$taxId})';
      const rows = await read(
        `MATCH (:DatabaseObject${object})<-[:regulatedBy|regulator|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|hasMember|hasCandidate|hasComponent|repeatedUnit|input|output|proteinMarker|RNAMarker*]-()<-[:hasEvent]-(p:Pathway)${inSpecies}
         RETURN DISTINCT p
         UNION
         MATCH (:ReactionLikeEvent${object})<-[:hasEvent]-(p:Pathway)${inSpecies}
         RETURN DISTINCT p
         UNION
         MATCH (p:Pathway${object})${inSpecies}
         RETURN DISTINCT p`,
        { ...params, ...(taxId === undefined ? {} : { taxId }) }
      );
      if (rows.length === 0) return missing();
      return { status: 200, body: rows.map((row) => pathwayJson(row.p)), type: 'application/json' };
    },
  },
  {
    path: '/ContentService/data/participants/{id}/referenceEntities',
    // A reaction with 141 reference entities of four classes.
    sample: 'R-HSA-5672965',
    /**
     * The reference entities -- the proteins, genes, chemicals and drugs --
     * behind every participant of an event, all the way down. The Pathway
     * Browser's molecule list and the IDG page ask for it.
     *
     * Java's one query (graph-core ReferenceEntityRepository
     * .getParticipatingReferenceEntities), kept as written so the rows come in
     * Java's order. The id is read as everywhere else; a REACT_ id is swapped
     * for its stable id first, as getIdentifier does.
     *
     * Not a 404 when nothing is found, which is Java's contract and not ours to
     * change: an unknown id is `[]`, and an id that is neither a stable id nor
     * a dbId is a 200 with no body at all (the controller returns null).
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      let { where, params } = resolveId(raw);
      if (where === 'false') return { status: 200, body: undefined };
      if (where.startsWith('n.oldStId')) {
        const [found] = await read(
          'MATCH (n:DatabaseObject) WHERE n.oldStId = $id RETURN n.stId AS stId LIMIT 1',
          params
        );
        params = { id: found?.stId ?? params.id };
        where = 'n.stId = $id';
      }
      const object = where.startsWith('n.dbId') ? '{dbId: toInteger($id)}' : '{stId: $id}';
      const rows = await read(
        `MATCH (n:DatabaseObject${object})-[:hasEvent|input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator|hasComponent|hasMember|hasCandidate|repeatedUnit|referenceEntity|proteinMarker|RNAMarker*]->(m:ReferenceEntity)
         RETURN DISTINCT m, labels(m) AS labels`,
        params
      );
      return {
        status: 200,
        body: rows.map((row) => referenceEntityJson(row.m, row.labels)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/participants/{id}',
    // A reaction with five participants of four classes.
    sample: 'R-HSA-5672965',
    /**
     * Every physical entity taking part in an event, all the way down, each
     * with the reference entities behind it. The Pathway Browser's molecule
     * list asks for it.
     *
     * Java's two queries (graph-core ParticipantRepository.getParticipants),
     * one per kind of id, kept as written -- they differ: the dbId one also
     * follows RNAMarker and proteinMarker from the event. The id is read as
     * everywhere else; a REACT_ id is swapped for its stable id first.
     *
     * Java's contract, as for /referenceEntities: an unknown id is [], an id
     * that is neither a stable id nor a dbId a 200 with no body.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      let { where, params } = resolveId(raw);
      if (where === 'false') return { status: 200, body: undefined };
      if (where.startsWith('n.oldStId')) {
        const [found] = await read(
          'MATCH (n:DatabaseObject) WHERE n.oldStId = $id RETURN n.stId AS stId LIMIT 1',
          params
        );
        params = { id: found?.stId ?? params.id };
        where = 'n.stId = $id';
      }
      const byDbId = where.startsWith('n.dbId');
      const object = byDbId ? '{dbId: toInteger($id)}' : '{stId: $id}';
      const from = participantsFrom(byDbId);
      const rows = await read(
        `MATCH (n:DatabaseObject${object})-[:${from}*]->(m:PhysicalEntity)
         OPTIONAL MATCH (m)-[:referenceEntity]->(re1:ReferenceEntity)
         OPTIONAL MATCH (m)-[:hasMember|hasComponent|hasCandidate|repeatedUnit|proteinMarker|RNAMarker*]->(pe:PhysicalEntity)-[:referenceEntity]->(re2:ReferenceEntity)
         WITH DISTINCT m,
              CASE WHEN re1 IS NULL THEN re2 ELSE re1 END AS re,
              CASE WHEN pe IS NULL THEN m.schemaClass ELSE pe.schemaClass END AS icon
         WHERE NOT re IS NULL
         RETURN m.dbId AS peDbId,
                m.displayName AS displayName,
                m.schemaClass AS schemaClass,
                COLLECT(DISTINCT({
                       dbId: re.dbId,
                       stId: re.stId,
                       displayName: re.displayName,
                       identifier: CASE WHEN re.variantIdentifier IS NOT NULL THEN re.variantIdentifier ELSE re.identifier END,
                       url: re.url,
                       schemaClass: re.schemaClass,
                       icon: icon
                })) AS refEntities`,
        params
      );
      return { status: 200, body: rows.map(participantJson), type: 'application/json' };
    },
  },
  {
    path: '/ContentService/data/entity/{id}/otherForms',
    // PTEN: 120 other forms, all proteins.
    sample: 'R-HSA-199420',
    // The 404 body names the service that answered; see /pathways/top/{id}.
    differs: [/^\/ContentService\/data\/entity\/[^/]+\/otherForms: \.url: /],
    /**
     * The other physical entities made from the same reference entity -- the
     * same protein modified, in another compartment, or another species' form.
     * The details panel and the entity popup show them.
     *
     * Java's query (graph-core PhysicalEntityRepository.getOtherFormsOf), kept
     * as written. The id is read as everywhere else; a REACT_ id is swapped for
     * its stable id first. Nothing found -- an unknown id, one with no other
     * forms, one that is not an entity -- is Java's 404.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const missing = () => notFound(request, `Id: ${raw} has not been found in the System`);
      let { where, params } = resolveId(raw);
      if (where === 'false') return missing();
      if (where.startsWith('n.oldStId')) {
        const [found] = await read(
          'MATCH (n:DatabaseObject) WHERE n.oldStId = $id RETURN n.stId AS stId LIMIT 1',
          params
        );
        params = { id: found?.stId ?? params.id };
        where = 'n.stId = $id';
      }
      const object = where.startsWith('n.dbId') ? '{dbId: toInteger($id)}' : '{stId: $id}';
      const rows = await read(
        `MATCH (n:PhysicalEntity${object})-[:referenceEntity]->(m:ReferenceEntity)<-[:referenceEntity]-(k)
         WHERE NOT n=k RETURN k`,
        params
      );
      if (rows.length === 0) return missing();
      return {
        status: 200,
        body: rows.map((row) => physicalEntityJson(row.k)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/detail/{id}/locationsInPWB',
    // Every route up to a diagram: seconds for a common small molecule.
    deep: true,
    // PTEN: 18 trees, reached through reactions, sets and complexes.
    sample: 'R-HSA-199420',
    // The error bodies name the service that answered; see /pathways/top/{id}.
    differs: [/^\/ContentService\/data\/detail\/[^/]+\/locationsInPWB(\?\S*)?: \.url: /],
    /**
     * Every place in the Pathway Browser an object appears: one tree per
     * top-level pathway, down to the object itself, each node with the address
     * that opens it there. The details page's "Locations in the Pathway
     * Browser" tree asks for it.
     *
     * graph-core's HierarchyService and HierarchyRepository, and the
     * controller's PathwayBrowserLocationsUtils, kept line for line
     * (parseHierarchy, locationsInPathwayBrowser): the query's paths are read
     * in the order Neo4j returns them and the answer depends on that order, so
     * the four queries match and expand as Java's do (locationsQuery). The id
     * is read as everywhere
     * else; a REACT_ id is swapped for its stable id first, as getIdentifier
     * does.
     *
     * Not cached: the answer is per id, and Java holds nothing either. Most
     * answer in tens of milliseconds; a common small molecule takes seconds in
     * both.
     *
     * `directParticipants` (default false) follows only the relationships that
     * put an entity directly in a reaction; `omitNonDisplayableItems` (default
     * true) leaves catalyses and regulations out of the tree. Both are read as
     * Spring reads a Boolean, and a value it cannot read is its 400. Asking for
     * the non-displayable items is Java's 500 for most entities -- every node
     * without a stable id becomes one node, which makes cycles -- and here too.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      // In the controller's parameter order: the first that cannot be read is
      // the one Java names.
      const direct = springBoolean(queryValues(request, 'directParticipants'));
      if (direct.error) return javaError(request, 400, 'BAD_REQUEST', direct.error);
      const omit = springBoolean(queryValues(request, 'omitNonDisplayableItems'));
      if (omit.error) return javaError(request, 400, 'BAD_REQUEST', omit.error);

      const missing = () =>
        javaError(request, 404, 'NOT_FOUND', `Reverse sub graph found for id: ${raw}`);
      let { where, params } = resolveId(raw);
      if (where === 'false') return missing();
      if (where.startsWith('n.oldStId')) {
        const [found] = await read(
          'MATCH (n:DatabaseObject) WHERE n.oldStId = $id RETURN n.stId AS stId LIMIT 1',
          params
        );
        params = { id: found?.stId ?? params.id };
        where = 'n.stId = $id';
      }
      const byDbId = where.startsWith('n.dbId');
      // Long.parseLong past a long's range is Java's 500, naming the digits as
      // given; neo4j.int would wrap round instead and find some other object.
      if (byDbId && BigInt(params.id) > 9223372036854775807n) {
        const digits = javaTrim(raw).split('.')[0];
        return javaError(request, 500, 'INTERNAL_SERVER_ERROR', `For input string: "${digits}"`);
      }
      const rows = await read(
        locationsQuery(byDbId, direct.value ?? false),
        byDbId ? { dbId: neo4j.int(params.id) } : { stId: params.id }
      );
      const [row] = rows;
      if (!row) return missing();

      try {
        // One row per path; no path at all is one row with none, which Java's
        // collect drops.
        const paths = rows.map((each) => each.steps).filter((steps) => steps !== null);
        const root = parseHierarchy(row.db, paths, omit.value ?? true);
        const trees = locationsInPathwayBrowser(root);
        if (trees.length === 0) {
          return javaError(
            request,
            404,
            'NOT_FOUND',
            `No Locations in the PathwayBrowser could have been found for id: ${raw}`
          );
        }
        return { status: 200, body: trees.map(pathwayBrowserJson), type: 'application/json' };
      } catch (failure) {
        // The two ways graph-core fails on this graph, answered as Java answers
        // them: a cycle overflows the stack, which Spring reports by name, and
        // a null it dereferences is the generic message.
        if (failure instanceof RangeError) {
          return javaError(
            request,
            500,
            'INTERNAL_SERVER_ERROR',
            'Handler dispatch failed; nested exception is java.lang.StackOverflowError'
          );
        }
        if (failure instanceof JavaNullPointer) {
          return javaError(
            request,
            500,
            'INTERNAL_SERVER_ERROR',
            'Something unexpected happened and the error has been reported.'
          );
        }
        throw failure;
      }
    },
  },
  {
    path: '/ContentService/data/schema/{id}/count',
    // The id is the class name; Java calls it {className}.
    sample: 'Pathway',
    // The error bodies name the service that answered; see /pathways/top/{id}.
    differs: [/^\/ContentService\/data\/schema\/[^/]+\/count: \.url: /],
    /**
     * How many objects of a schema class there are, optionally in one species.
     * The schema browser asks for it beside every class it lists.
     *
     * Two of Java's answers come from reflection over graph-core's classes --
     * whether the name is a class at all, and whether it has a species -- and
     * are answered here from schema.mjs, which says how it was derived and how
     * to keep it current. A name that is not a class is Java's 500, case
     * included: `pathway` is not `Pathway`.
     *
     * Without a species this is Spring Data's count of the class's label, which
     * Neo4j answers from its count store: a few milliseconds, where Java takes
     * about a second for any class. With one, graph-core's query, the species
     * read as SchemaService reads it -- digits are a taxId, anything else a
     * displayName exactly as given -- and not as SpeciesService reads it
     * elsewhere: no dbId, no normalising the name. None found, a class without
     * a species, or an empty `species=` are all Java's 404.
     */
    handler: async (request) => {
      const className = pathId(rawSegment(request, 4));
      const given = queryValues(request, 'species');
      if (!isSchemaClass(className)) return classNotFound(request);
      if (given.length === 0) {
        const [row] = await read(schemaCountQuery(className));
        return { status: 200, body: String(row?.n ?? 0), type: 'application/json' };
      }
      // A String parameter given more than once is Spring's comma-joined value.
      const species = given.join(',');
      const none = () =>
        javaError(request, 404, 'NOT_FOUND', `No entries have been found for species: ${species}`);
      if (!isSpeciesClass(className)) return none();
      const by = javaNumeric(species) ? 'taxId' : 'speciesName';
      const [row] = await read(schemaCountQuery(className, by), { [by]: species });
      if (!row?.n) return none();
      return { status: 200, body: String(row.n), type: 'application/json' };
    },
  },
  {
    path: '/ContentService/data/schema/{id}/min',
    sample: 'Pathway',
    differs: [/^\/ContentService\/data\/schema\/[^/]+\/min: \.url: /],
    /**
     * One page of a schema class's objects, each as dbId, stId, name and
     * class: the schema browser's list of instances.
     *
     * graph-core's query, kept as written: the rows are ordered by name alone,
     * and the order of rows that share one -- thousands do in DatabaseObject --
     * is the plan's, so the same text is what keeps every page Java's.
     *
     * `page` and `offset` are required Integers, read as Spring reads them
     * (springInteger), page first: a missing or unreadable one is Java's 400
     * before the class is looked at. Then as the controller and graph-core do
     * it: offset capped at 20000, skip (page - 1) * offset in int arithmetic,
     * and a negative skip or limit passed to Neo4j, whose refusal is Java's
     * 500. A class Java does not have is its 500; a species for a class
     * without one, or no rows, its 404.
     */
    handler: async (request) => {
      const className = pathId(rawSegment(request, 4));
      // In the controller's parameter order: species is a String and cannot fail.
      const given = queryValues(request, 'species');
      const page = springInteger(queryValues(request, 'page'), 'page');
      if (page.error) return javaError(request, 400, 'BAD_REQUEST', page.error);
      const offset = springInteger(queryValues(request, 'offset'), 'offset');
      if (offset.error) return javaError(request, 400, 'BAD_REQUEST', offset.error);

      if (!isSchemaClass(className)) return classNotFound(request);
      const none = () =>
        javaError(request, 404, 'NOT_FOUND', `No entries found for class: ${className}`);
      const species = given.length ? given.join(',') : undefined;
      let by;
      if (species !== undefined) {
        if (!isSpeciesClass(className)) return none();
        by = javaNumeric(species) ? 'taxId' : 'speciesName';
      }
      const { skip, limit } = schemaWindow(page.value, offset.value);
      let rows;
      try {
        rows = await read(schemaMinQuery(className, by), {
          ...(by && { [by]: species }),
          skip: neo4j.int(skip),
          limit: neo4j.int(limit),
        });
      } catch (failure) {
        const message = neo4jFailureMessage(failure);
        if (message === undefined) throw failure;
        return javaError(request, 500, 'INTERNAL_SERVER_ERROR', message);
      }
      if (rows.length === 0) return none();
      return { status: 200, body: javaJson(rows.map(simpleObjectJson)), type: 'application/json' };
    },
  },
  {
    path: '/ContentService/data/schema/model',
    /**
     * Every class with nodes in the graph, as a tree from DatabaseObject down,
     * each with how many nodes it and its subclasses hold: the schema
     * browser's class tree.
     *
     * DatabaseObjectUtils.getGraphModelTree over SchemaRepository's label
     * counts. The counts are the graph's and are read here; what Java gets by
     * reflection -- which class a set of labels names, and each class's
     * superclass -- comes from schema.mjs (schemaModelTree, which says how the
     * tree is built). schema.spec.mjs rebuilds the tree Java answered when the
     * snapshot was taken, from its own counts, byte for byte.
     *
     * Cached for the life of the process, as Java caches it (`cacheSchema`,
     * once per deployment): the counts change only when the database is
     * replaced, which restarts this -- see cached(). The query reads every
     * DatabaseObject, a few seconds, so it is paid at startup, not by a reader.
     */
    handler: cached('schema model', async () => {
      const rows = await read(schemaModelQuery);
      const tree = schemaModelTree(rows);
      // Java's answer to an empty graph is an empty 200 that it does not cache;
      // a graph without a DatabaseObject is not one this serves.
      if (tree === undefined) throw new Error('schema model: the graph has no DatabaseObject');
      return { status: 200, body: tree, type: 'application/json' };
    }),
  },
  {
    path: '/ContentService/data/schema/{id}/attributes',
    sample: 'Pathway',
    differs: [/^\/ContentService\/data\/schema\/[^/]+\/attributes: \.url: /],
    /**
     * A class's attributes, its own and inherited, each with its cardinality,
     * value types and the class declaring it: the schema browser's class page.
     *
     * DatabaseObjectUtils.getAttributeTable is reflection over graph-core's
     * classes and reads no database, so this is Java's answer captured once
     * (schema-snapshot.json, by snapshot-schema.mjs) and composed as Java
     * composes it (schema.mjs, attributeTable). A name Class.forName does not
     * find is Java's 500, as for /count.
     */
    handler: async (request) => {
      const table = attributeTable(pathId(rawSegment(request, 4)));
      if (table === undefined) return classNotFound(request);
      return { status: 200, body: javaJson(table), type: 'application/json' };
    },
  },
  {
    path: '/ContentService/data/schema/{id}/referrals',
    sample: 'Pathway',
    differs: [/^\/ContentService\/data\/schema\/[^/]+\/referrals: \.url: /],
    /**
     * The attributes of other classes that can point at this one: the schema
     * browser's "referrals". DatabaseObjectUtils.getReferrals, reflection
     * again, so captured like /attributes (schema.mjs, referralsTable).
     */
    handler: async (request) => {
      const table = referralsTable(pathId(rawSegment(request, 4)));
      if (table === undefined) return classNotFound(request);
      return { status: 200, body: javaJson(table), type: 'application/json' };
    },
  },
  {
    path: '/ContentService/data/orthology/{id}/species/{speciesId}',
    // A human pathway, in mouse; the diff harness is given more forms.
    sample: 'R-HSA-69620',
    samplePath: { speciesId: '48892' },
    // The error bodies name the service that answered; see /pathways/top/{id}.
    // '.' is not found here; Java's is a 500 (see resolveId).
    differs: [/^\/ContentService\/data\/orthology\/[^/]+\/species\/[^/]+: \.url: /],
    /**
     * An event's or entity's counterpart in another species: graph-core's
     * OrthologyService.getOrthology, the first object it finds, alone (no
     * relationships), written by the domain serialiser in Java's views. The
     * Pathway Browser asks when the species is changed with an event open.
     *
     * Java's answers: an id that is neither a stable id nor a dbId is a 404
     * naming it and the species; an id with no counterpart there is a 500 with
     * no message -- the controller takes the first of an empty list.
     */
    handler: async (request) => {
      const species = springPathLong(pathId(rawSegment(request, 6)), 'speciesId');
      if (species.error)
        return javaError(request, species.status, REASON[species.status], species.error);
      const raw = pathId(rawSegment(request, 4));
      const refused = longPastRange([raw]);
      if (refused) return javaError(request, 500, 'INTERNAL_SERVER_ERROR', refused);
      const found = await orthologyOf(raw, species.value);
      if (found === null)
        return notFound(request, `No orthology found for '${raw}' in species '${species.value}'`);
      if (found === undefined) return javaError(request, 500, 'INTERNAL_SERVER_ERROR', null);
      return {
        status: 200,
        serialised: writeDomain(mapNodes([found])[0], ...writerFor(request)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/orthologies/ids/species/{speciesId}',
    method: 'post',
    samplePath: { speciesId: '48892' },
    // Two ids for one pathway, one with none and one that is no id.
    sampleBody: 'R-HSA-69620,R-HSA-69608;69620\nREACT_1538\txyz,R-ALL-29358',
    differs: [/^\/ContentService\/data\/orthologies\/ids\/species\/[^/]+: \.url: /],
    /**
     * OrthologyController.getOrthologies: the ids in a text/plain body, split
     * on , ; newline and tab and trimmed; past twenty, the first twenty in a
     * HashSet. Each id's first counterpart, as the GET above finds it, keyed
     * by the id as sent, in a HashMap -- written in that HashMap's order
     * (JavaHashMap), each value its own object. Ids with none are left out;
     * none at all is a 404. The Pathway Browser sends every id in its URL when
     * the species changes.
     *
     * Spring checks the content type first, then the species, then that there
     * is a body. A dbId past a long anywhere in the list is Java's 500 for the
     * whole request, as is '.' -- which here is an id with no counterpart, as
     * the GET reads it.
     */
    handler: async (request) => {
      const contentType = request.get?.('content-type');
      const problem = plainTextProblem(contentType);
      if (problem) return javaError(request, 415, 'UNSUPPORTED_MEDIA_TYPE', problem);
      const species = springPathLong(pathId(rawSegment(request, 6)), 'speciesId');
      if (species.error)
        return javaError(request, species.status, REASON[species.status], species.error);
      if (request.tooLarge)
        return javaError(request, 413, 'PAYLOAD_TOO_LARGE', 'More than 10MB of ids');
      if (!Buffer.isBuffer(request.body) || request.body.length === 0)
        return javaError(
          request,
          422,
          'UNPROCESSABLE_ENTITY',
          'Required request body is missing: public java.util.Map<java.lang.Object, org.reactome.server.graph.domain.model.DatabaseObject> org.reactome.server.service.controller.graph.OrthologyController.getOrthologies(java.lang.Long,java.lang.String)'
        );
      const ids = orthologyIds(plainText(request.body, contentType));
      const refused = longPastRange(ids);
      if (refused) return javaError(request, 500, 'INTERNAL_SERVER_ERROR', refused);
      // One at a time, as Java asks, so twenty ids are not twenty queries at
      // once on the database the site shares.
      const found = new Map();
      for (const id of ids) if (!found.has(id)) found.set(id, await orthologyOf(id, species.value));
      const kept = orthologyMap(ids, found);
      if (kept.size === 0) return notFound(request, 'No orthologies found');
      const entries = [...kept.entries()].map(([id, object]) => [id, mapNodes([object])[0]]);
      return {
        status: 200,
        serialised: writeDomain(new JsonMap(entries), ...writerFor(request)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/interactors/static/molecule/{id}/details',
    sample: 'P04637',
    differs: [/: \.url: /],
    /**
     * An accession's interactors from IntAct, as the Pathway Browser's entity
     * popup lists them: graph-core's InteractionsRepository.getByAcc, paged
     * when `page` and `pageSize` are both given, each interaction written as
     * the content service's Interactor (interactorsJson).
     */
    handler: async (request) => {
      const acc = pathId(rawSegment(request, 5));
      const window = interactorPaging(request);
      if (window.answer) return window.answer;
      const rows = await interactionsOf(request, acc, window);
      if (rows.answer) return rows.answer;
      // getAccession().size() on an interaction with none.
      if (rows.some((row) => row.accession === null)) return unexpected(request);
      if (rows.length === 0) return notFound(request, `No interactors found for accession: ${acc}`);
      return { status: 200, body: interactorsJson([[acc, rows]]), type: 'application/json' };
    },
  },
  {
    path: '/ContentService/interactors/static/molecules/details',
    method: 'post',
    sampleBody: 'P04637,Q00987, P38398\nXYZ',
    differs: [/: \.url: /],
    /**
     * Interactors for many accessions, which the Pathway Browser asks for every
     * protein in a diagram when the static resource is chosen: the body split
     * and trimmed into a HashSet (its order is the answer's), each accession
     * as the GET above, one at a time as Java asks. One with none is still an
     * entry, with its count; none for any is a 404 naming the body as sent.
     */
    handler: async (request) => {
      const contentType = request.get?.('content-type');
      const problem = plainTextProblem(contentType);
      if (problem) return javaError(request, 415, 'UNSUPPORTED_MEDIA_TYPE', problem);
      const window = interactorPaging(request);
      if (window.answer) return window.answer;
      if (request.tooLarge)
        return javaError(request, 413, 'PAYLOAD_TOO_LARGE', 'More than 10MB of accessions');
      if (!Buffer.isBuffer(request.body) || request.body.length === 0)
        return javaError(
          request,
          422,
          'UNPROCESSABLE_ENTITY',
          'Required request body is missing: public org.reactome.server.service.model.interactors.Interactors org.reactome.server.service.controller.interactors.StaticInteractionsController.getProteinsDetailsByAccs(java.lang.Integer,java.lang.Integer,java.lang.String)'
        );
      const proteins = plainText(request.body, contentType);
      const accs = new JavaHashMap();
      for (const acc of plainIds(proteins)) accs.set(acc, true);
      const entities = [];
      for (const acc of accs.keys()) {
        const rows = await interactionsOf(request, acc, window);
        if (rows.answer) return rows.answer;
        if (rows.some((row) => row.accession === null)) return unexpected(request);
        entities.push([acc, rows]);
      }
      if (entities.every(([, rows]) => rows.length === 0))
        return notFound(request, `No interactors found for accession: ${proteins}`);
      return { status: 200, body: interactorsJson(entities), type: 'application/json' };
    },
  },
  {
    path: '/ContentService/interactors/static/molecule/enhanced/{id}/details',
    sample: 'P04637',
    /**
     * The same interactions with more about each partner, for the website's
     * and the Pathway Browser's interactor tables: graph-core's
     * CustomInteractionsRepository, as written, each row a CustomInteraction.
     * None is `[]`, not a 404: the controller only refuses a null.
     */
    handler: async (request) => {
      const acc = pathId(rawSegment(request, 6));
      const rows = await read(
        `MATCH (t:ReferenceEntity)<-[:interactor]-(in:Interaction)-[ir:interactor]->(re:ReferenceEntity) WHERE t.variantIdentifier = $identifier OR (t.variantIdentifier IS NULL AND t.identifier = $identifier) OPTIONAL MATCH (pe:PhysicalEntity)-[r:referenceEntity]->(re) OPTIONAL MATCH (se:Species)<-[s:species]-(re) WITH in, re, se, pe, t ORDER BY in.score DESC RETURN DISTINCT in.dbId AS dbId, in.score AS score, SIZE(in.accession) AS evidenceCount, re.identifier AS identifier, re.databaseName AS databaseName, re.displayName AS displayName, re.variantIdentifier as variantIdentifier, re.geneName AS geneName, re.url as url, in.url AS evidenceURL,  se.displayName AS speciesName, COUNT(pe) AS entitiesCount`,
        { identifier: acc }
      );
      const written = rows.map(customInteractionJson);
      if (written.includes(undefined)) return unexpected(request);
      return { status: 200, body: `[${written.join(',')}]`, type: 'application/json' };
    },
  },
  {
    path: '/ContentService/interactors/static/molecule/{id}/withEntities',
    sample: 'P04637',
    differs: [/: \.url: /],
    /**
     * Each interaction with the Reactome entities its partner is, for the
     * website's interactor page: the content service's own query, as written,
     * each row an InteractionWithEntities.
     */
    handler: async (request) => {
      const acc = pathId(rawSegment(request, 5));
      const rows = await read(
        'MATCH (s:ReferenceEntity)<-[:interactor]-(it:Interaction),       (it)-[ir:interactor]->(in:ReferenceEntity)<-[re:referenceEntity]-(pe:PhysicalEntity),       (:ReactionLikeEvent)-[:input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator*]->(pe) WHERE s.variantIdentifier = $accession OR (s.variantIdentifier IS NULL AND s.identifier = $accession) RETURN DISTINCT it.score AS score, in.identifier AS accession, in.url AS accessionURL,                 COLLECT(DISTINCT{                          dbId: pe.dbId,                          stId: pe.stId,                          displayName: pe.displayName,                          schemaClass: pe.schemaClass                 }) AS physicalEntity,                 SIZE(it.accession) AS evidences,                 it.url AS url ORDER BY score DESC, accession',
        { accession: acc }
      );
      if (rows.length === 0) return notFound(request, `No interactors found for accession: ${acc}`);
      return {
        status: 200,
        body: `[${rows.map(interactionWithEntitiesJson).join(',')}]`,
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/exporter/diagram/{id}',
    // The error path, which is all the diff harness can compare: the figure
    // itself is drawn by another renderer. Never expanded over --ids, which
    // would have Java draw a full figure for every one (a versioned id's
    // version reads as the extension).
    sample: 'XYZ.svg',
    samplesOnly: true,
    differs: [/: \.url: /],
    /**
     * A diagram figure, as ImageExporterController.diagramImage answers it:
     * graph-core's DiagramService resolves the id to the diagram that draws
     * it and the events to select there, and the drawing is the render
     * service's (tools/render) -- the site's own renderer -- asked over
     * loopback, the whole diagram with those events highlighted.
     *
     * Not routed yet (#273). Every parameter Java takes is converted as Spring
     * converts it; any this does not draw yet is refused by name at a value
     * other than its default, because a figure that leaves out what was asked
     * for is a 200 no caller can detect.
     */
    handler: async (request) => {
      const name = splitExportName(pathId(rawSegment(request, 4)));
      if (!name) return springNotFound(request);
      const asked = exporterParameters(request);
      if (asked.answer) return asked.answer;
      const unsupported = notDrawnYet(asked.values);
      if (unsupported.length)
        return javaError(
          request,
          400,
          'BAD_REQUEST',
          `Not drawn by this service yet: ${unsupported.join(', ')}. Ask without them, or at their defaults.`
        );

      const refused = longPastRange([name.identifier]);
      if (refused) return javaError(request, 500, 'INTERNAL_SERVER_ERROR', refused);
      const result = await diagramResult(name.identifier);
      if (!result)
        return javaError(request, 400, 'BAD_REQUEST', `'${name.identifier}' is not an event`);
      const ext = name.ext.toLowerCase();
      const problem = figureProblem(asked.values, ext);
      if (problem === 'unexpected') return unexpected(request);
      if (problem) return javaError(request, problem.status, problem.reason, problem.message);
      const figure = diagramExportRequest(result, { ...asked.values, ext });
      // Java selects on an illustration too; the render page does not yet.
      if (figure.searchParams.has('highlight') && (await hasIllustration(result.diagramStId)))
        return javaError(
          request,
          400,
          'BAD_REQUEST',
          `Not drawn by this service yet: a selection on ${result.diagramStId}'s illustration. Ask with ehld=false once that is drawn, or for the pathway itself.`
        );
      return renderFigure(request, figure, ext);
    },
  },
  ...['suggest', 'spellcheck'].map((handler) => ({
    path: `/ContentService/search/${handler}`,
    // Search-core's getAutocompleteSuggestions / getSpellcheckSuggestions:
    // the collations Solr's own /suggest or /spellcheck handler offers for
    // `query`, each kept only if /exists finds it in the index. What is
    // offered, in what order and how many is solrconfig.xml's, as for Java.
    // An empty query is Java's null: a 200 with no body and no type.
    handler: async (request) => {
      const given = queryValues(request, 'query');
      if (given.length === 0)
        return javaError(
          request,
          400,
          'BAD_REQUEST',
          "Required request parameter 'query' for method parameter type String is not present"
        );
      const query = given.join(',');
      if (query === '') return { status: 200 };
      return fromSolr(request, `/ContentService/search/${handler}`, async (signal) => ({
        status: 200,
        type: 'application/json',
        body: await suggestionsFrom(`/${handler}`, query, solr, signal),
      }));
    },
  })),
  {
    path: '/ContentService/search/facet',
    // SearchService.getTotalFacetingInformation: every document's facets,
    // counted by Solr's /facetall handler over the reference-entity scope.
    // The search page asks for it before anything is searched.
    handler: (request) =>
      fromSolr(request, '/ContentService/search/facet', async (signal) =>
        facetAnswer(
          await solr(
            '/facetall',
            [
              ['q', '*:*'],
              ['fq', 'hasReferenceEntity:false'],
            ],
            { signal }
          )
        )
      ),
  },
  {
    path: '/ContentService/search/facet_query',
    // SearchController.facet_type: the facets of a query, filtered by the
    // species, types, keywords and compartments given, in a scope. The
    // search page asks for it with every search.
    handler: (request) => {
      const given = queryValues(request, 'query');
      if (given.length === 0)
        return javaError(
          request,
          400,
          'BAD_REQUEST',
          "Required request parameter 'query' for method parameter type String is not present"
        );
      const scope = springScope(queryValues(request, 'scope'));
      if (scope.error) return javaError(request, 400, 'BAD_REQUEST', scope.error);
      const force = springBoolean(queryValues(request, 'Force filters'));
      if (force.error) return javaError(request, 400, 'BAD_REQUEST', force.error);
      const query = {
        query: given.join(','),
        scope: scope.value,
        species: springList(queryValues(request, 'species')),
        types: springList(queryValues(request, 'types')),
        keywords: springList(queryValues(request, 'keywords')),
        compartments: springList(queryValues(request, 'compartments')),
      };
      // An empty query is SearchService's null, before any scope is read.
      if (query.query === '') return { status: 200 };
      if (scope.value === null)
        return javaError(
          request,
          500,
          'INTERNAL_SERVER_ERROR',
          'Something unexpected happened and the error has been reported.'
        );
      return fromSolr(request, '/ContentService/search/facet_query', async (signal) => ({
        status: 200,
        type: 'application/json',
        body: await facetsOf(query, force.value === true, signal),
      }));
    },
  },
  {
    path: '/ContentService/search/icon/facet',
    // SearchService.getIconFacetingInformation: the icon library's
    // categories, counted by Solr's /icon/facet handler over the icons.
    handler: (request) =>
      fromSolr(request, '/ContentService/search/icon/facet', async (signal) =>
        facetAnswer(await solr('/icon/facet', [['q', '{!term f=type}icon']], { signal }))
      ),
  },
];

/** The extensions ImageExporterController answers, pdf aside (its own 500). */
const EXPORT_FORMATS = ['png', 'jpg', 'jpeg', 'svg', 'gif'];

/**
 * What diagramImage fails on once the id is resolved, in its order, or
 * undefined: pdf, by its own literal message; a blank quality, unboxed for
 * the raster budget (the service's generic 500, 'unexpected'); a quality
 * outside 1-10, which RasterArgs refuses; a blank ehld, unboxed. Then what
 * this service does not draw: an extension Java has no check for -- its
 * ImageIO writes nothing and it answers an empty 200; this names it -- and
 * gif, whose renderer draws the expression animation, not a still.
 */
export function figureProblem(values, ext) {
  const fail = (message) => ({ status: 500, reason: 'INTERNAL_SERVER_ERROR', message });
  if (ext === 'pdf') return fail('Unsupported file extension pdf');
  if (values.quality === null) return 'unexpected';
  if (values.quality < 1 || values.quality > 10) return fail('quality must be in the range [1-10]');
  if (values.ehld === null) return 'unexpected';
  if (!EXPORT_FORMATS.includes(ext)) return fail(`Unsupported file extension ${ext}`);
  if (ext === 'gif')
    return {
      status: 400,
      reason: 'BAD_REQUEST',
      message:
        'Not drawn by this service yet: gif. The renderer’s GIF is the expression animation, not a still.',
    };
  return undefined;
}

/** Whether a pathway is drawn as its illustration (hasEHLD), as the render page draws it. */
async function hasIllustration(stId) {
  const [row] = await read('MATCH (p:Pathway{stId:$stId}) RETURN p.hasEHLD AS ehld', { stId });
  return row?.ehld === true;
}

/** Where the render service listens: loopback only, never public. */
const RENDER_SERVICE = process.env.RENDER_SERVICE_URL || 'http://127.0.0.1:4310';

/**
 * Spring's `{identifier}.{ext:.*}`: both variables are `(.*)`, the first
 * greedy, so the extension is what follows the last dot and a versioned id
 * keeps its version (graph-core then cuts it). No dot matches nothing.
 */
export function splitExportName(segment) {
  const dot = segment.lastIndexOf('.');
  if (dot === -1) return undefined;
  return { identifier: segment.slice(0, dot), ext: segment.slice(dot + 1) };
}

/**
 * diagramImage's parameters, converted in its order as Spring converts them,
 * with their defaults: Integers and Booleans as springIntegerWithDefault and
 * springBoolean read them, `sel` a List<String> -- one value split on commas
 * and trimmed, several taken as they are.
 */
function exporterParameters(request) {
  const values = {};
  const integer = (name, fallback) => {
    const read = springIntegerWithDefault(queryValues(request, name), fallback);
    if (read.error) return javaError(request, 400, 'BAD_REQUEST', read.error);
    values[name] = read.value;
    return undefined;
  };
  // Absent or a single empty value is the default; a blank one converts to
  // null, which the controller then passes on as it is.
  const boolean = (name, fallback) => {
    const given = queryValues(request, name);
    if (given.length === 0 || (given.length === 1 && given[0] === '')) {
      values[name] = fallback;
      return undefined;
    }
    const read = springBoolean(given);
    if (read.error) return javaError(request, 400, 'BAD_REQUEST', read.error);
    values[name] = read.value ?? null;
    return undefined;
  };
  // A String: repeated values arrive joined by ',', as Spring joins a String[].
  const text = (name, fallback) => {
    const given = queryValues(request, name);
    values[name] =
      given.length > 1
        ? given.join(',')
        : given[0] === undefined || given[0] === ''
          ? fallback
          : given[0];
  };
  const answer =
    integer('quality', 5) ||
    (text('flg', null), undefined) ||
    boolean('flgInteractors', true) ||
    (() => {
      const given = queryValues(request, 'sel');
      values.sel =
        given.length === 1
          ? given[0].split(',').map((part) => part.trim())
          : given.filter((value) => value !== '');
      values.sel = values.sel.filter((value) => value !== '');
      return undefined;
    })() ||
    boolean('title', true) ||
    integer('margin', 15) ||
    boolean('ehld', true) ||
    (text('diagramProfile', 'Modern'), undefined) ||
    (text('token', null), undefined) ||
    (text('resource', 'TOTAL'), undefined) ||
    (text('analysisProfile', 'Standard'), undefined) ||
    integer('expColumn', null);
  return answer ? { answer } : { values };
}

/**
 * The parameters given at something other than their default that the render
 * service does not draw yet (#273, step 4), as `name=value`.
 */
function notDrawnYet(values) {
  const defaults = {
    quality: 5,
    flgInteractors: true,
    title: true,
    margin: 15,
    ehld: true,
    diagramProfile: 'Modern',
    resource: 'TOTAL',
    analysisProfile: 'Standard',
  };
  // Left for after the resolution, where Java fails on them (figureProblem):
  // a quality outside 1-10, and a blank quality or ehld.
  const later = (name) =>
    (name === 'quality' &&
      (values.quality === null || values.quality < 1 || values.quality > 10)) ||
    (name === 'ehld' && values.ehld === null) ||
    // RasterArgs.setMargin(null) keeps its 15: a blank margin is the default.
    (name === 'margin' && values.margin === null);
  const named = Object.entries(defaults)
    .filter(([name, fallback]) => !later(name) && values[name] !== fallback)
    .map(([name]) => `${name}=${values[name] ?? ''}`);
  // Opt-in: anything given is something not drawn.
  for (const name of ['flg', 'expColumn'])
    if (values[name] !== null && values[name] !== undefined) named.push(`${name}=${values[name]}`);
  return named;
}

/**
 * graph-core's DiagramRepository.getDiagramResult, as DiagramService picks
 * it: by stable id or by dbId as getIdentifier reads the id (REACT_ ids
 * translated), else none. The diagram that draws the event, and the events
 * to select there: none for a pathway with a diagram of its own, a
 * subpathway's reactions, or the reaction itself.
 */
async function diagramResult(raw) {
  const id = inDepthId(raw);
  if (!id) return undefined;
  let { idType, id: value } = id;
  if (idType === 'oldStId') {
    const [old] = await read(
      'MATCH (n:DatabaseObject) WHERE n.oldStId = $id RETURN n.stId AS stId LIMIT 1',
      { id: value }
    );
    value = old?.stId ?? value;
    idType = 'stId';
  }
  const rows = await read(
    idType === 'dbId' ? DIAGRAM_RESULT_BY_DBID : DIAGRAM_RESULT_BY_STID,
    idType === 'dbId' ? { dbId: neo4j.int(value) } : { stId: value }
  );
  return rows[0];
}

const DIAGRAM_RESULT_BY_STID =
  'MATCH (d:Pathway{stId:$stId, hasDiagram:true}) RETURN d.stId AS diagramStId, [] AS events, d.diagramWidth AS width, d.diagramHeight AS height, 1 AS level UNION MATCH path=(d:Pathway{hasDiagram:true})-[:hasEvent*1..100]->(s:Pathway{stId:$stId, hasDiagram:false}) WHERE single(x IN nodes(path) WHERE (x:Pathway) AND x.hasDiagram) OPTIONAL MATCH aux=(s)-[:hasEvent*1..100]->(rle:ReactionLikeEvent) WHERE none(x IN nodes(aux) WHERE (x:Pathway) AND x.hasDiagram) WITH DISTINCT d, s, collect(DISTINCT rle.stId) AS events OPTIONAL MATCH depth=shortestPath((tlp:TopLevelPathway)-[:hasEvent*1..100]->(d)) WHERE NOT (d:TopLevelPathway) RETURN d.stId AS diagramStId, events, d.diagramWidth AS width, d.diagramHeight AS height, size(nodes(depth)) AS level ORDER BY level LIMIT 1 UNION MATCH path=(d:Pathway{hasDiagram:true})-[:hasEvent*1..100]->(r:ReactionLikeEvent{stId:$stId}) WHERE single(x IN nodes(path) WHERE (x:Pathway) AND x.hasDiagram) WITH DISTINCT d, r OPTIONAL MATCH depth=shortestPath((tlp:TopLevelPathway)-[:hasEvent*1..100]->(d)) WHERE NOT (d:TopLevelPathway) RETURN d.stId AS diagramStId, [r.stId] AS events, d.diagramWidth AS width, d.diagramHeight AS height, size(nodes(depth)) AS level ORDER BY level LIMIT 1';

const DIAGRAM_RESULT_BY_DBID =
  'MATCH (d:Pathway{dbId:$dbId, hasDiagram:true}) RETURN d.stId AS diagramStId, [] AS events, d.diagramWidth AS width, d.diagramHeight AS height, 1 AS level UNION MATCH path=(d:Pathway{hasDiagram:true})-[:hasEvent*]->(s:Pathway{dbId:$dbId, hasDiagram:false}) WHERE single(x IN nodes(path) WHERE (x:Pathway) AND x.hasDiagram) OPTIONAL MATCH aux=(s)-[:hasEvent*]->(rle:ReactionLikeEvent) WHERE none(x IN nodes(aux) WHERE (x:Pathway) AND x.hasDiagram) WITH DISTINCT d, s, collect(DISTINCT rle.stId) AS events OPTIONAL MATCH depth=shortestPath((tlp:TopLevelPathway)-[:hasEvent*]->(d)) WHERE NOT (d:TopLevelPathway) RETURN d.stId AS diagramStId, events, d.diagramWidth AS width, d.diagramHeight AS height, size(nodes(depth)) AS level ORDER BY level LIMIT 1 UNION MATCH path=(d:Pathway{hasDiagram:true})-[:hasEvent*]->(r:ReactionLikeEvent{dbId:$dbId}) WHERE single(x IN nodes(path) WHERE (x:Pathway) AND x.hasDiagram) WITH DISTINCT d, r OPTIONAL MATCH depth=shortestPath((tlp:TopLevelPathway)-[:hasEvent*]->(d)) WHERE NOT (d:TopLevelPathway) RETURN d.stId AS diagramStId, [r.stId] AS events, d.diagramWidth AS width, d.diagramHeight AS height, size(nodes(depth)) AS level ORDER BY level LIMIT 1';

/**
 * The render service's request for a resolved figure: the diagram that draws
 * it, with Java's selection -- the resolved events, then `sel` -- as
 * `highlight`, which marks them on the whole diagram and frames nothing, as
 * Java draws a selection. jpg is jpeg to the render service.
 */
export function diagramExportRequest(result, { ext, sel, token }) {
  const format = ext === 'jpg' ? 'jpeg' : ext;
  const url = new URL(`${RENDER_SERVICE}/render/${result.diagramStId}.${format}`);
  const highlight = [...(result.events ?? []), ...(sel ?? [])];
  if (highlight.length) url.searchParams.set('highlight', highlight.join(','));
  if (token) url.searchParams.set('token', token);
  return url;
}

/** The content type Java sends with each format. */
// UTF-8 on every type, images included: the service forces the encoding.
const FIGURE_TYPE = {
  svg: 'image/svg+xml;charset=UTF-8',
  png: 'image/png;charset=UTF-8',
  jpg: 'image/jpg;charset=UTF-8',
  jpeg: 'image/jpeg;charset=UTF-8',
};

/**
 * Ask the render service for a figure and pass its bytes on. Its 503 -- a
 * full queue -- is passed on with its Retry-After; any other failure is a 500
 * naming it, and a render service that cannot be reached is a 503.
 */
async function renderFigure(request, url, ext) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  } catch (failure) {
    const late = failure?.name === 'TimeoutError';
    return javaError(
      request,
      503,
      'SERVICE_UNAVAILABLE',
      late ? 'The figure took too long to draw' : 'The figure service cannot be reached'
    );
  }
  if (response.status === 503)
    return {
      ...javaError(
        request,
        503,
        'SERVICE_UNAVAILABLE',
        'Too many figures are being drawn; try again shortly'
      ),
      headers: { 'Retry-After': response.headers.get('retry-after') ?? '5' },
    };
  if (!response.ok) {
    const reason = await response
      .json()
      .then((body) => body.error)
      .catch(() => `the figure service answered ${response.status}`);
    return javaError(request, 500, 'INTERNAL_SERVER_ERROR', reason);
  }
  return {
    status: 200,
    body: Buffer.from(await response.arrayBuffer()),
    type: FIGURE_TYPE[ext],
  };
}

/**
 * The `page` and `pageSize` of the static details endpoints: Integers that
 * default to -1, paging only when neither is -1. A blank one is null, which
 * the service may fail on (pagingUnboxFails).
 */
function interactorPaging(request) {
  const page = springIntegerWithDefault(queryValues(request, 'page'), -1);
  if (page.error) return { answer: javaError(request, 400, 'BAD_REQUEST', page.error) };
  const pageSize = springIntegerWithDefault(queryValues(request, 'pageSize'), -1);
  if (pageSize.error) return { answer: javaError(request, 400, 'BAD_REQUEST', pageSize.error) };
  return { page: page.value, pageSize: pageSize.value };
}

/**
 * Whether graph-core's getInteractions fails unboxing a null page or
 * pageSize: it reads page first, and pageSize only when page is not -1. It
 * runs once per accession, so a request with none never fails here.
 */
export function pagingUnboxFails({ page, pageSize }) {
  return page === null || (page !== -1 && pageSize === null);
}

/** Java's answer to an exception its handler has no mapping for: a NullPointerException. */
function unexpected(request) {
  return javaError(
    request,
    500,
    'INTERNAL_SERVER_ERROR',
    'Something unexpected happened and the error has been reported.'
  );
}

/**
 * graph-core's InteractionsRepository.getByAcc, as written -- the plan, and so
 * the order of equal scores, is the query's -- with each interaction's partner
 * taken from its result. Every interaction has two interactors, the accession
 * and its partner, so the partner list holds one (the accession itself for a
 * homodimer). A negative SKIP or LIMIT is Java's 500 with Neo4j's message,
 * returned as `answer`.
 */
async function interactionsOf(request, acc, { page, pageSize }) {
  if (pagingUnboxFails({ page, pageSize })) return { answer: unexpected(request) };
  const paged = page !== -1 && pageSize !== -1;
  try {
    return await read(
      `CALL {
         MATCH (t:ReferenceEntity)<-[:interactor]-(in:Interaction)-[ir:interactor]->(re:ReferenceEntity) WHERE t.variantIdentifier = $acc OR (t.variantIdentifier IS NULL AND t.identifier = $acc) OPTIONAL MATCH (pe:PhysicalEntity)-[r:referenceEntity]->(re) RETURN DISTINCT in, COLLECT(DISTINCT ir) AS irs, COLLECT(DISTINCT re) AS res, COLLECT(DISTINCT r) AS rs, COLLECT(DISTINCT pe)[..20] AS pe ORDER BY in.score DESC${paged ? ' SKIP ($page - 1) * $pageSize LIMIT $pageSize' : ''}
       }
       RETURN in.dbId AS id, in.score AS score, in.accession AS accession, in.url AS url,
              [x IN res | {labels: labels(x), identifier: x.identifier,
                           variantIdentifier: x.variantIdentifier, url: x.url,
                           geneName: x.geneName}] AS partners`,
      { acc, ...(paged && { page: neo4j.int(page), pageSize: neo4j.int(pageSize) }) }
    );
  } catch (failure) {
    const message = neo4jFailureMessage(failure);
    if (message === undefined) throw failure;
    return { answer: javaError(request, 500, 'INTERNAL_SERVER_ERROR', message) };
  }
}

/**
 * A Java object as the content service's NON_EMPTY mapper writes it: the
 * members in order, any null, empty text or empty list left out. A `double`
 * member is written as Java writes a Double (1.0, not 1).
 */
function nonEmptyJson(members) {
  const out = [];
  for (const [name, value, double] of members) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    const written =
      value instanceof RawJson ? value.text : double ? javaDouble(value) : javaJson(value);
    out.push(`${javaJson(name)}:${written}`);
  }
  return `{${out.join(',')}}`;
}

/** Text already written as JSON, for nonEmptyJson. */
class RawJson {
  constructor(text) {
    this.text = text;
  }
}

/**
 * The content service's Interactor, from one interactionsOf row: the partner's
 * variant identifier if it is an isoform with one, else its identifier; its
 * first gene name as the alias; the evidence count, score and URLs.
 */
export function interactorJson(row) {
  const [partner = {}] = row.partners;
  const isoform = partner.labels?.includes('ReferenceIsoform');
  const acc = isoform && partner.variantIdentifier ? partner.variantIdentifier : partner.identifier;
  const alias = partner.labels?.includes('ReferenceSequence') ? partner.geneName?.[0] : undefined;
  return nonEmptyJson([
    ['acc', acc],
    ['alias', alias],
    ['id', row.id],
    ['evidences', row.accession?.length],
    ['score', row.score, true],
    ['accURL', partner.url],
    ['evidencesURL', row.url],
  ]);
}

/**
 * The content service's Interactors: `static`, and an entry for each
 * accession -- its interactors' count, and the list, left out when empty.
 */
export function interactorsJson(entities) {
  const written = entities.map(([acc, rows]) =>
    nonEmptyJson([
      ['acc', acc],
      ['count', rows.length],
      ['interactors', rows.length ? new RawJson(`[${rows.map(interactorJson).join(',')}]`) : []],
    ])
  );
  return `{"resource":"static","entities":[${written.join(',')}]}`;
}

/**
 * graph-core's CustomInteraction, a row of its query, in field order, as its
 * Record constructor reads it: asString() writes a missing value as the text
 * "null"; speciesName and variantIdentifier are asString(null); a missing
 * geneName is an empty list. A missing dbId, score or evidenceCount fails
 * asLong() or asDouble(): undefined, the service's failure.
 */
export function customInteractionJson(row) {
  if ([row.dbId, row.score, row.evidenceCount].some((value) => value === null)) return undefined;
  const text = (value) => value ?? 'null';
  return nonEmptyJson([
    ['dbId', row.dbId],
    ['identifier', text(row.identifier)],
    ['score', row.score, true],
    ['evidenceCount', row.evidenceCount],
    ['url', text(row.url)],
    ['evidenceURL', text(row.evidenceURL)],
    ['geneName', row.geneName],
    ['databaseName', text(row.databaseName)],
    ['entitiesCount', row.entitiesCount],
    ['speciesName', row.speciesName],
    ['displayName', text(row.displayName)],
    ['variantIdentifier', row.variantIdentifier],
  ]);
}

/**
 * The content service's InteractionWithEntities, a row of its query, as
 * build() reads it -- score and evidences as 0 when missing -- with the
 * entities sorted by name as String.CASE_INSENSITIVE_ORDER sorts (stably).
 * Each entity is a SimpleDatabaseObject built from a map: stId asString(null),
 * displayName and schemaClass asString(), which writes a missing one "null".
 */
export function interactionWithEntitiesJson(row) {
  const entities = (row.physicalEntity ?? [])
    .map((pe) => ({ ...pe, displayName: pe.displayName ?? 'null' }))
    .sort((a, b) => caseInsensitive(a.displayName, b.displayName));
  const written = entities.map((pe) =>
    nonEmptyJson([
      ['dbId', pe.dbId],
      ['stId', pe.stId],
      ['displayName', pe.displayName],
      ['schemaClass', pe.schemaClass ?? 'null'],
    ])
  );
  return nonEmptyJson([
    ['score', row.score ?? 0, true],
    ['accession', row.accession],
    ['accessionURL', row.accessionURL],
    ['physicalEntity', written.length ? new RawJson(`[${written.join(',')}]`) : []],
    ['evidences', row.evidences ?? 0],
    ['url', row.url],
  ]);
}

/** case-snapshot.json, as two maps from a UTF-16 unit to its case, read on first use. */
let javaCase;

/**
 * String.CASE_INSENSITIVE_ORDER: per UTF-16 unit, equal if their upper cases
 * are, else ordered by the lower cases of those upper cases (so the long s, ſ,
 * sorts as s) -- each the JVM's Character mapping
 * (case-snapshot.json; snapshot-case.mjs says why not JavaScript's).
 */
function caseInsensitive(a, b) {
  if (!javaCase) {
    const { upper, lower } = JSON.parse(
      readFileSync(new URL('./case-snapshot.json', import.meta.url), 'utf8')
    );
    const pairs = (flat) =>
      new Map(flat.flatMap((unit, at) => (at % 2 ? [] : [[unit, flat[at + 1]]])));
    javaCase = { upper: pairs(upper), lower: pairs(lower) };
  }
  const length = Math.min(a.length, b.length);
  for (let at = 0; at < length; at += 1) {
    const x = a.charCodeAt(at);
    const y = b.charCodeAt(at);
    if (x === y) continue;
    const upperX = javaCase.upper.get(x) ?? x;
    const upperY = javaCase.upper.get(y) ?? y;
    const lowerX = javaCase.lower.get(upperX) ?? upperX;
    const lowerY = javaCase.lower.get(upperY) ?? upperY;
    if (lowerX !== lowerY) return lowerX - lowerY;
  }
  return a.length - b.length;
}

/**
 * getOrthologies' two HashMaps, given each id's orthologyOf: the service puts
 * every id that is an id (not null) -- found or not -- and the controller
 * keeps those found, iterating the first. How far the first grows decides
 * the second's order, so an id that is no id must not be put in it.
 */
export function orthologyMap(ids, found) {
  const byId = new JavaHashMap();
  for (const id of ids) if (found.get(id) !== null) byId.set(id, found.get(id));
  const kept = new JavaHashMap();
  for (const [id, object] of byId.entries()) if (object) kept.set(id, object);
  return kept;
}

/** The reason Java's envelope gives with each status these endpoints send. */
const REASON = { 400: 'BAD_REQUEST', 500: 'INTERNAL_SERVER_ERROR' };

/**
 * graph-core's OrthologyRepository, as OrthologyService chooses between its
 * two queries: an object's counterparts in a species, inferred from it or it
 * from them (one step either way) or sharing the object they were both
 * inferred from (two steps). The Cypher is Java's, in a subquery so the
 * result comes back as a map; the first row is the one Java keeps.
 *
 * null when the id is no id (Java's null); undefined when nothing is found
 * (Java's empty list). A REACT_ id is the object whose oldStId it is, or, when
 * there is none, looked for as a stable id -- and not found, as in Java.
 */
async function orthologyOf(raw, species) {
  const id = inDepthId(raw);
  if (!id) return null;
  let { idType, id: value } = id;
  if (idType === 'oldStId') {
    const [old] = await read(
      'MATCH (n:DatabaseObject) WHERE n.oldStId = $id RETURN n.stId AS stId LIMIT 1',
      { id: value }
    );
    value = old?.stId ?? value;
    idType = 'stId';
  }
  const anchor = idType === 'dbId' ? '{dbId:$id}' : '{stId:$id}';
  const rows = await read(
    `CALL {
       MATCH (:DatabaseObject${anchor})<-[:inferredTo]-()-[:inferredTo]->(o:DatabaseObject)-[:species]->(:Species{dbId:$speciesId}) RETURN DISTINCT o
       UNION
       MATCH (:DatabaseObject${anchor})-[:inferredTo]-(o:DatabaseObject)-[:species]->(:Species{dbId:$speciesId}) RETURN DISTINCT o
     }
     RETURN {id: id(o), labels: labels(o), props: properties(o)} AS o`,
    { id: idType === 'dbId' ? neo4j.int(value) : value, speciesId: neo4j.int(String(species)) }
  );
  return rows[0]?.o;
}

/**
 * Long.parseLong's 500 for the first id that is a dbId past a long, naming it
 * as Java read it (trimmed, any version cut), or undefined. neo4j.int would
 * wrap round instead and find some other object.
 */
function longPastRange(ids) {
  for (const raw of ids) {
    const id = inDepthId(raw);
    if (id?.idType === 'dbId' && BigInt(id.id) > 9223372036854775807n)
      return `For input string: "${javaTrim(raw).split('.')[0]}"`;
  }
  return undefined;
}

/**
 * The ids in getOrthologies' body: String.split on , ; newline or tab --
 * trailing empty strings dropped, as Java's split drops them -- each trimmed;
 * more than twenty, the first twenty collected into a HashSet, in its order.
 */
export function orthologyIds(body) {
  const ids = plainIds(body);
  if (ids.length <= 20) return ids;
  const set = new JavaHashMap();
  for (const id of ids.slice(0, 20)) set.set(id, true);
  return [...set.keys()];
}

/**
 * A text/plain body of ids as the controllers split it: String.split on , ;
 * newline or tab -- trailing empty strings dropped, as Java's split drops
 * them -- each trimmed.
 */
function plainIds(body) {
  const parts = body.split(/,|;|\n|\t/);
  if (parts.length > 1) while (parts.length && parts.at(-1) === '') parts.pop();
  return parts.map((part) => javaTrim(part));
}

/**
 * Whether Spring takes a Content-Type for `consumes = "text/plain"`: undefined
 * if so, else the 415's message. It parses the header as MimeTypeUtils does
 * -- the type and subtype lower-cased, parameters as given, a charset Java
 * must know -- and only text/plain is compatible: `text/*` is not.
 */
export function plainTextProblem(header) {
  if (!header) return "Content type '' not supported";
  const invalid = (why) => `Invalid mime type "${header}": ${why}`;
  const [first = '', ...rest] = header.split(';');
  const full = first.trim() === '*' ? '*/*' : first.trim();
  const slash = full.indexOf('/');
  if (slash === -1) return invalid("does not contain '/'");
  if (slash === full.length - 1) return invalid("does not contain subtype after '/'");
  const type = full.slice(0, slash).toLowerCase();
  const subtype = full.slice(slash + 1).toLowerCase();
  if (type === '*' && subtype !== '*')
    return invalid("wildcard type is legal only in '*/*' (all mime types)");
  const parameters = [];
  for (const parameter of rest) {
    const at = parameter.indexOf('=');
    if (at === -1) continue;
    const name = parameter.slice(0, at).trim();
    const value = parameter.slice(at + 1).trim();
    if (name.toLowerCase() === 'charset' && !knownCharset(value))
      return invalid(`unsupported charset '${value.replace(/^"(.*)"$/, '$1')}'`);
    parameters.push(`;${name}=${value}`);
  }
  if (type === 'text' && subtype === 'plain') return undefined;
  return `Content type '${type}/${subtype}${parameters.join('')}' not supported`;
}

function knownCharset(value) {
  return decoderFor(value.replace(/^"(.*)"$/, '$1').toLowerCase()) !== undefined;
}

/**
 * A text/plain body as StringHttpMessageConverter reads it: in the header's
 * charset, else ISO-8859-1, a malformed sequence read as U+FFFD.
 */
export function plainText(body, header) {
  const charset = /;\s*charset\s*=\s*"?([^";]+)"?/i
    .exec(header ?? '')?.[1]
    ?.trim()
    .toLowerCase();
  return (decoderFor(charset ?? 'iso-8859-1') ?? decoderFor('iso-8859-1'))(body);
}

/** Java's names for the charsets decoded here as Java decodes them. */
const JAVA_CHARSETS = [
  [
    'iso-8859-1 iso8859_1 iso_8859_1 iso_8859-1 iso8859-1 8859_1 latin1 l1 ibm819 ibm-819 cp819 819 csisolatin1 iso-ir-100 iso_8859-1:1987',
    (body) => body.toString('latin1'),
  ],
  [
    'us-ascii ascii us iso646-us 646 ascii7 default csascii cp367 ibm367 iso-ir-6 ansi_x3.4-1968 ansi_x3.4-1986 iso_646.irv:1983 iso_646.irv:1991',
    (body) =>
      Array.from(body, (byte) => (byte < 0x80 ? String.fromCharCode(byte) : '\ufffd')).join(''),
  ],
  ['utf-8 utf8 unicode-1-1-utf-8', (body) => body.toString('utf8')],
  ['utf-16 utf_16 utf16 unicode', (body) => utf16(body, undefined)],
  ['utf-16be utf_16be x-utf-16be iso-10646-ucs-2 unicodebigunmarked', (body) => utf16(body, 'be')],
  ['utf-16le utf_16le x-utf-16le unicodelittleunmarked', (body) => utf16(body, 'le')],
  ['utf-32 utf_32 utf32', (body) => utf32(body, undefined)],
  ['utf-32be utf_32be x-utf-32be', (body) => utf32(body, 'be')],
  ['utf-32le utf_32le x-utf-32le', (body) => utf32(body, 'le')],
].flatMap(([names, decode]) => names.split(' ').map((name) => [name, decode]));
const JAVA_DECODERS = new Map(JAVA_CHARSETS);

/**
 * How to read a body in a charset named in a Content-Type, lower-cased, or
 * undefined for one this cannot read -- Spring's 415. Latin-1, ASCII and the
 * UTF family are read as the JDK reads them (orthology.spec.mjs holds the
 * JDK's answers); any other charset by TextDecoder when it knows the name,
 * which for a body of stable ids reads the same. A charset only Java knows
 * (an EBCDIC code page) is refused here and read by Java.
 */
function decoderFor(charset) {
  if (JAVA_DECODERS.has(charset)) return JAVA_DECODERS.get(charset);
  try {
    const decoder = new TextDecoder(charset);
    return (body) => decoder.decode(body);
  } catch {
    return undefined;
  }
}

/**
 * The JDK's UTF-16 decoders: with no order given, a byte-order mark decides it
 * and is dropped, and without one it is big-endian; with an order, a mark is
 * a character. A reversed mark (U+FFFE) anywhere, a lone surrogate or an odd
 * last byte is U+FFFD -- one for a high surrogate and the odd byte after it.
 */
function utf16(body, order) {
  let at = 0;
  let little = order === 'le';
  if (order === undefined && body.length >= 2) {
    if (body[0] === 0xfe && body[1] === 0xff) at = 2;
    else if (body[0] === 0xff && body[1] === 0xfe) {
      at = 2;
      little = true;
    }
  }
  const units = [];
  for (; at + 1 < body.length; at += 2)
    units.push(little ? body[at] | (body[at + 1] << 8) : (body[at] << 8) | body[at + 1]);
  let text = '';
  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i];
    if (unit >= 0xd800 && unit <= 0xdbff && units[i + 1] >= 0xdc00 && units[i + 1] <= 0xdfff) {
      text += String.fromCharCode(unit, units[i + 1]);
      i += 1;
    } else
      text +=
        (unit >= 0xd800 && unit <= 0xdfff) || unit === 0xfffe
          ? '\ufffd'
          : String.fromCharCode(unit);
  }
  // A high surrogate waiting at the end takes the odd byte with it: one U+FFFD.
  const last = units.at(-1);
  const waiting = last >= 0xd800 && last <= 0xdbff;
  return at < body.length && !waiting ? `${text}\ufffd` : text;
}

/**
 * The JDK's UTF-32 decoders: a leading byte-order mark is dropped -- and,
 * with no order given, decides it (big-endian without one) -- unless it is
 * the other order's mark; a value past U+10FFFF, a surrogate, or a short last
 * group is U+FFFD.
 */
function utf32(body, order) {
  let at = 0;
  let little = order === 'le';
  if (body.length >= 4) {
    const first = body.readUInt32BE(0);
    if (first === 0xfeff && order !== 'le') {
      at = 4;
      little = false;
    } else if (first === 0xfffe0000 && order !== 'be') {
      at = 4;
      little = true;
    }
  }
  let text = '';
  for (; at + 3 < body.length; at += 4) {
    const point = little ? body.readUInt32LE(at) : body.readUInt32BE(at);
    text +=
      point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)
        ? '\ufffd'
        : String.fromCodePoint(point);
  }
  return at < body.length ? `${text}\ufffd` : text;
}

/**
 * A java.util.HashMap's iteration order, for answers Java writes from one --
 * its put, resize and tree bins ported from the JDK the service runs on
 * (11). A key's bucket is String.hashCode, its high half folded in, masked
 * to the table size; the table starts at 16 and doubles past three quarters
 * full. A bucket keeps keys in the order they arrived until a ninth arrives:
 * then, under 64 buckets, the table doubles; at 64, the bucket becomes a
 * red-black tree ordered by hash then String.compareTo, whose root is moved
 * to the front and whose later keys are linked in after their parent -- so
 * eleven ids sharing a hash come out in Java's order, not arrival's. Checked
 * against the JDK's own HashMap (orthology.spec.mjs).
 */
export class JavaHashMap {
  #table = new Array(16).fill(null);
  size = 0;

  static #hash(key) {
    let h = 0;
    for (let at = 0; at < key.length; at += 1) h = (Math.imul(31, h) + key.charCodeAt(at)) | 0;
    return h ^ (h >>> 16);
  }

  set(key, value) {
    const hash = JavaHashMap.#hash(key);
    const table = this.#table;
    const index = (table.length - 1) & hash;
    let p = table[index];
    let existing = null;
    if (p === null) table[index] = { hash, key, value, next: null };
    else if (p.hash === hash && p.key === key) existing = p;
    else if (p.tree) existing = this.#putTreeValue(table, hash, key, value);
    else {
      for (let count = 0; ; count += 1) {
        const e = p.next;
        if (e === null) {
          p.next = { hash, key, value, next: null };
          if (count >= 7) this.#treeifyBin(hash);
          break;
        }
        if (e.hash === hash && e.key === key) {
          existing = e;
          break;
        }
        p = e;
      }
    }
    if (existing) {
      existing.value = value;
      return this;
    }
    this.size += 1;
    if (this.size > this.#table.length * 0.75) this.#resize();
    return this;
  }

  *entries() {
    for (let node of this.#table) for (; node; node = node.next) yield [node.key, node.value];
  }

  *keys() {
    for (const [key] of this.entries()) yield key;
  }

  #resize() {
    const old = this.#table;
    const table = new Array(old.length * 2).fill(null);
    this.#table = table;
    for (let index = 0; index < old.length; index += 1) {
      const head = old[index];
      if (!head) continue;
      if (head.next === null) table[head.hash & (table.length - 1)] = head;
      else if (head.tree) this.#split(table, head, index, old.length);
      else {
        const [lo, hi] = [[], []];
        for (let node = head; node; node = node.next)
          ((node.hash & old.length) === 0 ? lo : hi).push(node);
        for (const [list, at] of [
          [lo, index],
          [hi, index + old.length],
        ]) {
          if (!list.length) continue;
          list.forEach((node, i) => (node.next = list[i + 1] ?? null));
          table[at] = list[0];
        }
      }
    }
  }

  #treeifyBin(hash) {
    const table = this.#table;
    if (table.length < 64) return this.#resize();
    const index = (table.length - 1) & hash;
    let previous = null;
    for (let node = table[index]; node; node = node.next) {
      Object.assign(node, {
        tree: true,
        prev: previous,
        parent: null,
        left: null,
        right: null,
        red: false,
      });
      previous = node;
    }
    this.#treeify(table, table[index]);
  }

  /** TreeNode.split: the bucket's nodes, in order, to the two halves of a doubled table. */
  #split(table, head, index, bit) {
    const [lo, hi] = [[], []];
    for (let node = head; node; node = node.next) ((node.hash & bit) === 0 ? lo : hi).push(node);
    for (const [list, at, other] of [
      [lo, index, hi],
      [hi, index + bit, lo],
    ]) {
      if (!list.length) continue;
      list.forEach((node, i) => {
        node.next = list[i + 1] ?? null;
        node.prev = list[i - 1] ?? null;
      });
      if (list.length <= 6) {
        for (const node of list) {
          node.tree = false;
          node.parent = node.left = node.right = node.prev = null;
        }
        table[at] = list[0];
      } else {
        table[at] = list[0];
        if (other.length) this.#treeify(table, list[0]);
      }
    }
  }

  static #direction(hash, key, node) {
    if (node.hash > hash) return -1;
    if (node.hash < hash) return 1;
    return key < node.key ? -1 : key > node.key ? 1 : 0;
  }

  #treeify(table, head) {
    let root = null;
    for (let x = head, next; x; x = next) {
      next = x.next;
      x.left = x.right = null;
      if (root === null) {
        x.parent = null;
        x.red = false;
        root = x;
        continue;
      }
      for (let p = root; ;) {
        const dir = JavaHashMap.#direction(x.hash, x.key, p);
        const xp = p;
        p = dir <= 0 ? p.left : p.right;
        if (p === null) {
          x.parent = xp;
          if (dir <= 0) xp.left = x;
          else xp.right = x;
          root = JavaHashMap.#balanceInsertion(root, x);
          break;
        }
      }
    }
    JavaHashMap.#moveRootToFront(table, root);
  }

  #putTreeValue(table, hash, key, value) {
    const root = table[(table.length - 1) & hash];
    for (let p = root; ;) {
      if (p.hash === hash && p.key === key) return p;
      const dir = JavaHashMap.#direction(hash, key, p);
      const xp = p;
      p = dir <= 0 ? p.left : p.right;
      if (p === null) {
        const xpn = xp.next;
        const x = {
          hash,
          key,
          value,
          next: xpn,
          tree: true,
          prev: xp,
          parent: xp,
          left: null,
          right: null,
          red: false,
        };
        if (dir <= 0) xp.left = x;
        else xp.right = x;
        xp.next = x;
        if (xpn) xpn.prev = x;
        JavaHashMap.#moveRootToFront(table, JavaHashMap.#balanceInsertion(root, x));
        return null;
      }
    }
  }

  static #moveRootToFront(table, root) {
    const index = (table.length - 1) & root.hash;
    const first = table[index];
    if (root === first) return;
    table[index] = root;
    const { prev: rp, next: rn } = root;
    if (rn) rn.prev = rp;
    if (rp) rp.next = rn;
    if (first) first.prev = root;
    root.next = first;
    root.prev = null;
  }

  static #rotateLeft(root, p) {
    const r = p.right;
    if (!r) return root;
    const rl = (p.right = r.left);
    if (rl) rl.parent = p;
    const pp = (r.parent = p.parent);
    if (!pp) (root = r).red = false;
    else if (pp.left === p) pp.left = r;
    else pp.right = r;
    r.left = p;
    p.parent = r;
    return root;
  }

  static #rotateRight(root, p) {
    const l = p.left;
    if (!l) return root;
    const lr = (p.left = l.right);
    if (lr) lr.parent = p;
    const pp = (l.parent = p.parent);
    if (!pp) (root = l).red = false;
    else if (pp.right === p) pp.right = l;
    else pp.left = l;
    l.right = p;
    p.parent = l;
    return root;
  }

  static #balanceInsertion(root, x) {
    x.red = true;
    for (;;) {
      const xp = x.parent;
      if (!xp) {
        x.red = false;
        return x;
      }
      const xpp = xp.parent;
      if (!xp.red || !xpp) return root;
      const xppl = xpp.left;
      const xppr = xpp.right;
      const uncle = xp === xppl ? xppr : xppl;
      if (uncle && uncle.red) {
        uncle.red = false;
        xp.red = false;
        xpp.red = true;
        x = xpp;
        continue;
      }
      // x's parent is red and its uncle black: rotate x up to where its parent
      // was if it is the inner grandchild, then rotate the grandparent.
      const left = xp === xppl;
      let parent = xp;
      if (x === (left ? xp.right : xp.left)) {
        x = xp;
        root = left ? JavaHashMap.#rotateLeft(root, x) : JavaHashMap.#rotateRight(root, x);
        parent = x.parent;
      }
      const grand = parent ? parent.parent : null;
      if (parent) {
        parent.red = false;
        if (grand) {
          grand.red = true;
          root = left
            ? JavaHashMap.#rotateRight(root, grand)
            : JavaHashMap.#rotateLeft(root, grand);
        }
      }
    }
  }
}

/**
 * The endpoint a path was expanded from, by its whole template. Matching on
 * the text before the first `{` gave every /schema/{id}/... path to the first
 * of them, /count, so /min was judged by /count's declared differences and
 * failed on a difference it declares itself.
 */
export function endpointFor(path) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return endpoints.find((e) =>
    new RegExp(
      `^${e.path
        .split(/\{\w+\}/)
        .map(escape)
        .join('[^/?]+')}(\\?|$)`
    ).test(path)
  );
}

/** graph-core SchemaRepository.getSchemaClassCounts, as written. */
export const schemaModelQuery =
  'MATCH (n:DatabaseObject) RETURN DISTINCT LABELS(n) AS labels, Count(n) AS count';

/**
 * graph-core SchemaRepository's queries for /schema/{className}/min, by
 * species taxId, species name or neither. `className` is spliced in, as Java
 * splices it, and is only ever a name isSchemaClass accepted.
 */
export function schemaMinQuery(className, by) {
  return (
    `${schemaMatch(className, by)} ` +
    'RETURN DISTINCT(n.dbId) as dbId, n.stId as stId, n.displayName as displayName, labels(n) as labels ' +
    'ORDER BY n.displayName ' +
    'SKIP $skip LIMIT $limit'
  );
}

/**
 * The count for /schema/{className}/count. With a species, graph-core's query;
 * without, the label count Spring Data's `count(Class)` makes, which reads
 * Neo4j's count store. Quoted, because a woven `X$AjcClosure3` is a class too.
 */
export function schemaCountQuery(className, by) {
  if (by === undefined) return `MATCH (n:\`${className}\`) RETURN count(n) AS n`;
  return `${schemaMatch(className, by)} RETURN COUNT(n) AS n`;
}

function schemaMatch(className, by) {
  if (by === 'taxId') return `MATCH (s:Species{taxId:$taxId})<-[:species]-(n:${className})`;
  if (by === 'speciesName') {
    return `MATCH (s:Species{displayName:$speciesName})<-[:species]-(n:${className})`;
  }
  return `MATCH (n:${className})`;
}

/**
 * SKIP and LIMIT as the controller and graph-core compute them: offset capped
 * at 20000, skip `(page - 1) * offset` in Java's int arithmetic, overflow and
 * all. Negative values are left for Neo4j to refuse, as Java leaves them.
 */
export function schemaWindow(page, offset) {
  const limit = offset > 20000 ? 20000 : offset;
  return { skip: Math.imul((page - 1) | 0, limit), limit };
}

/**
 * graph-core's SimpleDatabaseObject as Jackson writes it. stId is read with
 * asString(null), so a missing one is left out; displayName with asString(),
 * which writes a missing one as the text "null". The class is the one the
 * labels name (schemaClassOf), not the schemaClass property.
 */
export function simpleObjectJson(row) {
  const out = { dbId: row.dbId };
  if (row.stId !== null && row.stId !== undefined && row.stId !== '') out.stId = row.stId;
  const displayName = row.displayName ?? 'null';
  if (displayName !== '') out.displayName = displayName;
  out.schemaClass = schemaClassOf(row.labels);
  return out;
}

/**
 * Text as Jackson writes it, which differs from JSON.stringify in one place:
 * a control character without a short escape is `\u001F`, upper-case, where
 * JSON.stringify writes `\u001f`. Only an escape is changed -- an odd run of
 * backslashes before `u00` -- never a literal backslash followed by text.
 */
export function javaJson(value) {
  return JSON.stringify(value).replace(/(\\+)u00([0-9a-f]{2})/g, (match, slashes, hex) =>
    slashes.length % 2 ? `${slashes}u00${hex.toUpperCase()}` : match
  );
}

/**
 * A Neo4j argument error as Spring's exception translation reports it, which
 * is what Java answers a negative SKIP or LIMIT with. Undefined for any other
 * failure: those are not part of Java's contract to mirror.
 */
export function neo4jFailureMessage(failure) {
  if (failure?.code !== 'Neo.ClientError.Statement.ArgumentError') return undefined;
  return (
    `${failure.message}; Error code '${failure.code}'; ` +
    `nested exception is org.neo4j.driver.exceptions.ClientException: ${failure.message}`
  );
}

/** Java's error envelope, written as Jackson writes it. */
/** The ContentService's answer to a ClassNotFoundException. */
function classNotFound(request) {
  return javaError(request, 500, 'INTERNAL_SERVER_ERROR', 'Specified class was not found');
}

/**
 * graph-core's four locations queries (HierarchyRepository), by kind of id and
 * by `directParticipants`: Java's MATCH and expansion exactly, because the
 * paths come back in the order the plan expands them and parseHierarchy builds
 * the tree from that order.
 *
 * Only the RETURN differs, and only in shape. Java collects every path into one
 * record; for a small molecule that is one record of 94,690 paths, and the node
 * driver decodes a record that spans many network chunks byte by byte -- 32s
 * for an answer Java gives in 2.8s, and nothing at all within two minutes for
 * the largest. One row per path streams instead (7.6s for that one, against
 * Java's 7.0s). The step's labels are left out, as nothing but the root reads
 * them. Checked rather than assumed: the streamed rows and Java's collected
 * list were compared path for path over twelve ids, both relationship sets,
 * and agreed every time; the diff harness then compares the answers.
 */
export function locationsQuery(byDbId, directParticipants) {
  const match = byDbId
    ? 'MATCH (n:DatabaseObject{dbId:$dbId}) '
    : 'MATCH (n:DatabaseObject{stId:$stId}) ';
  const relationships = directParticipants
    ? 'regulatedBy|regulator|physicalEntity|catalystActivity|requiredInputComponent|diseaseEntity|entityFunctionalStatus|input|output|hasEvent'
    : 'regulatedBy|regulator|physicalEntity|requiredInputComponent|diseaseEntity|entityFunctionalStatus|activeUnit|catalystActivity|repeatedUnit|hasMember|hasCandidate|hasComponent|input|output|hasEvent|proteinMarker|RNAMarker';
  return (
    match +
    `OPTIONAL MATCH path=(n)<-[:${relationships}*]-() ` +
    'RETURN [n.stId, n.displayName, n.hasDiagram, n.speciesName, n.schemaClass, labels(n), 0] AS db, ' +
    '[rel IN relationships(path) | [startNode(rel).stId, startNode(rel).displayName, startNode(rel).hasDiagram, startNode(rel).speciesName, startNode(rel).schemaClass, null, rel.order]] AS steps'
  );
}

/**
 * Build once, serve from memory, and heal from a bad start.
 *
 * Measured, which is the only reason this exists: Java answers both of these in
 * 3-7ms and this port answered in 4.5-6.2s, a thousand times worse. Java is not
 * faster -- `ContentPageManager` has a `@PostConstruct` that runs both queries
 * at startup and keeps the lists in memory, so the traversal is paid once per
 * deploy rather than once per reader. A port that skips that is a regression no
 * functional diff would catch, because every response is byte-identical and
 * merely slow.
 *
 * One deliberate difference. Java's init catches Exception, logs it and leaves
 * the list **empty**, so a database that is slow or unreachable at startup
 * leaves the contents page blank until somebody redeploys -- a transient fault
 * made permanent. Here a failed build is not cached: the next request tries
 * again. A slow start costs one slow request instead of an empty page nobody
 * connects to a restart hours earlier.
 *
 * Held for the life of the process, which makes restarting this service part of
 * updating the database rather than an optimisation detail. That is the agreed
 * rule, and it is the rule rather than an inference: the previous version of
 * this comment asserted that "a release restarts the service", which is true of
 * Java -- its WAR is redeployed -- and was not true of this, a container with
 * `restart: unless-stopped` that nothing restarted.
 *
 * What it costs to get wrong, so the rule is worth keeping: the release number
 * keys the bucket paths for diagrams, figures and icons, so a service holding
 * the previous release's number sends every one of those requests to the wrong
 * prefix, and keeps doing it silently. `/health` reports the release this
 * process is holding for exactly that reason -- a missed restart is then one
 * curl away from being obvious instead of invisible.
 */
function cached(name, build) {
  let ready;
  const handler = async (request) => {
    ready ??= build(request).catch((error) => {
      ready = undefined;
      throw error;
    });
    const started = Date.now();
    const answer = await ready;
    const spent = Date.now() - started;
    if (spent > 100) console.log(`[content-node] built ${name} in ${spent}ms`);

    // Serialised once, not per request. The body cannot change while the
    // process lives, and `res.json` would stringify a quarter of a megabyte
    // every time somebody asked. Measured over 20 requests: 5.4ms before,
    // against Java's 3.1ms, and the gap was this.
    answer.serialised ??= typeof answer.body === 'string' ? answer.body : javaJson(answer.body);
    return answer;
  };
  // Marks this one for warming at startup; a handler that reads its request
  // cannot be warmed, and saying so here keeps that decision beside the cache.
  handler.warms = true;
  return handler;
}

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
    const rows = await read(
      `MATCH ${pattern}
       OPTIONAL MATCH (p)<-[${relationship.own}]-(:InstanceEdit)<-[:author]-(own:Person)
       WITH p, COLLECT(DISTINCT own) AS own
       OPTIONAL MATCH (p)-[:hasEvent*]->(:Event)<-[${relationship.descendants}]-(:InstanceEdit)<-[:author]-(sub:Person)
       RETURN p.stId AS stId, own, COLLECT(DISTINCT sub) AS sub`
    );
    for (const row of rows) {
      const seen = new Map();
      for (const person of [...(row.own ?? []), ...(row.sub ?? [])]) {
        if (person && !seen.has(person.dbId)) seen.set(person.dbId, person);
      }
      out[role].set(row.stId, [...seen.values()]);
    }
  }
  return out;
}

/**
 * One object as ControllerUtils.toTSV writes it for `/data/query/{id}/{attr}`:
 * the stable id (the dbId when there is none or it is empty), the name and the
 * class, tab-separated, with no newline after. A missing name is Java's string
 * concatenation of null. toTSV prefers a `getText()` over the name; no class
 * served through here has one, so it is not read.
 */
export function databaseObjectTsv({ dbId, stId, displayName, schemaClass }) {
  const id = stId !== null && stId !== undefined && stId !== '' ? stId : dbId;
  return `${id}\t${displayName ?? 'null'}\t${schemaClass}`;
}

/** The five fields Java's SimplePerson carries, in its order. */
function simplePeople(persons) {
  return (persons ?? []).map((person) => ({
    dbId: person.dbId,
    displayName: person.displayName,
    surname: person.surname,
    firstname: person.firstname,
    orcidId: person.orcidId,
  }));
}

/**
 * What Jackson would actually serialise.
 *
 * `spring.jackson.default-property-inclusion=non_empty` in the Java service's
 * application.properties, so a field is omitted when it is null, an empty
 * string **or** an empty collection -- not just when it is null. The diff found
 * this the slow way: entries with no reviewers came back from Java without the
 * key at all while this returned `[]`, on fifteen pathways.
 *
 * Numbers and booleans are left alone: NON_EMPTY has no notion of an empty
 * number, so `0` and `false` are serialised.
 */
function compact(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/**
 * How Java reads an id, as a Cypher condition on `n`.
 *
 * Mirrors graph-core's DatabaseObjectUtils (getIdentifier, trimId, isStId,
 * isDbId) and AdvancedDatabaseObjectService.findById:
 *
 * - trimmed; an id without ':' is also cut at its first '.', so any version
 *   suffix is ignored (`R-HSA-70486.4`, `70486.3`). An id with ':' -- a
 *   reference, `UniProt:P04637` -- is only trimmed.
 * - `REACT_…` is a pre-2016 id: findNewStId looks up the node whose `oldStId`
 *   it is, and that node is the answer. Here that is one match on `oldStId`.
 * - starting with 'R', or containing ':', is a stable id; all digits is a
 *   dbId (leading zeros allowed, as Long.parseLong allows them). Anything else
 *   is not found, as in Java. Case matters: `r-hsa-70486` is not found.
 * - One known difference: `.` alone is Java's 500 (it indexes the empty
 *   result of the split); here it is a 404, the answer it should have been.
 *
 * Every branch matches one indexed property on DatabaseObject, never a
 * disjunction: a disjunction across properties uses no index and scans the
 * whole graph (see the person endpoints).
 */
export function resolveId(raw) {
  const trimmed = javaTrim(String(raw));
  const id = trimmed.includes(':') ? trimmed : (trimmed.split('.')[0] ?? '');
  if (id.startsWith('REACT_')) return { where: 'n.oldStId = $id', params: { id } };
  if (id.startsWith('R') || id.includes(':')) return { where: 'n.stId = $id', params: { id } };
  // StringUtils.isNumeric and Long.parseLong take a digit of any script.
  if (javaNumeric(id)) {
    return { where: 'n.dbId = toInteger($id)', params: { id: asciiDigits(id) } };
  }
  return { where: 'false', params: {} };
}

/**
 * Java's String.trim: every character up to U+0020 off both ends, control
 * characters included, and nothing above it -- a no-break space stays.
 */
function javaTrim(text) {
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && text.charCodeAt(end - 1) <= 0x20) end -= 1;
  return text.slice(start, end);
}

/**
 * StringUtils.isNumeric, which Java's id and species readers use: non-empty,
 * and every UTF-16 unit a decimal digit. Per unit rather than per code point,
 * because that is what Java tests -- a digit outside the BMP (U+1D7CF) is a
 * surrogate pair to it, and neither half is a digit.
 */
function javaNumeric(text) {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (!/\p{Nd}/u.test(String.fromCharCode(text.charCodeAt(i)))) return false;
  }
  return true;
}

/**
 * A run of digits from any script, as ASCII. Unicode keeps each script's
 * digits in contiguous runs from 0 to 9, some runs back to back, so a digit's
 * value is its distance from the start of its run, modulo ten.
 */
function asciiDigits(digits) {
  const isDigit = (code) => /\p{Nd}/u.test(String.fromCodePoint(code));
  return [...digits]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      let first = code;
      while (isDigit(first - 1)) first -= 1;
      return String((code - first) % 10);
    })
    .join('');
}

/**
 * The id as Spring hands it to a controller, from the path segment as it was
 * sent. Whatever follows a ';' is a matrix parameter, removed before the path
 * is decoded and matched, so Java reads `70486;x` as `70486` -- in its answer
 * and its 404 message alike -- but `70486%3Bx` as `70486;x`. Express decodes
 * `request.params` first, which loses that difference, so the raw segment is
 * read instead (nginx passes the request's own URI through).
 */
export function pathId(segment) {
  const kept = String(segment).split(';')[0] ?? '';
  return javaPathDecode(kept);
}

/**
 * A path segment percent-decoded as Tomcat decodes it: the bytes read as
 * UTF-8, each malformed sequence U+FFFD -- Java answers person/%FF with "No
 * person found for id: \ufffd". decodeURIComponent throws on those instead.
 */
function javaPathDecode(text) {
  if (!text.includes('%')) return text;
  const bytes = [];
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === '%' && /^[0-9A-Fa-f]{2}$/.test(text.slice(at + 1, at + 3))) {
      bytes.push(parseInt(text.slice(at + 1, at + 3), 16));
      at += 2;
    } else {
      const code = text.codePointAt(at);
      if (code > 0xffff) at += 1;
      bytes.push(...Buffer.from(String.fromCodePoint(code), 'utf8'));
    }
  }
  return javaUtf8(bytes);
}

/**
 * Bytes to text as the JDK's UTF-8 decoder (sun.nio.cs.UTF_8, the one Tomcat
 * reads a path with) does with malformed input replaced: each malformed
 * sequence one U+FFFD, its length by the JDK's rules -- an encoded surrogate
 * (ED A0 80) is one, where the WHATWG decoder Node uses makes three -- and an
 * incomplete sequence at the end one more.
 */
export function javaUtf8(bytes) {
  const continuation = (b) => (b & 0xc0) === 0x80;
  const malformed3 = (b1, b2) => (b1 === 0xe0 && (b2 & 0xe0) === 0x80) || !continuation(b2);
  const malformed4 = (b1, b2) =>
    b1 > 0xf4 ||
    (b1 === 0xf0 && (b2 < 0x90 || b2 > 0xbf)) ||
    (b1 === 0xf4 && (b2 & 0xf0) !== 0x80) ||
    !continuation(b2);
  let text = '';
  let at = 0;
  while (at < bytes.length) {
    const b1 = bytes[at];
    const left = bytes.length - at;
    if (b1 < 0x80) {
      text += String.fromCharCode(b1);
      at += 1;
    } else if (b1 >= 0xc2 && b1 <= 0xdf) {
      if (left < 2) break;
      if (!continuation(bytes[at + 1])) {
        text += '\ufffd';
        at += 1;
        continue;
      }
      text += String.fromCharCode(((b1 & 0x1f) << 6) | (bytes[at + 1] & 0x3f));
      at += 2;
    } else if (b1 >= 0xe0 && b1 <= 0xef) {
      if (left < 3) {
        if (left > 1 && malformed3(b1, bytes[at + 1])) {
          text += '\ufffd';
          at += 1;
          continue;
        }
        break;
      }
      const [b2, b3] = [bytes[at + 1], bytes[at + 2]];
      if (malformed3(b1, b2) || !continuation(b3)) {
        text += '\ufffd';
        at += malformed3(b1, b2) ? 1 : 2;
        continue;
      }
      const char = ((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      text += char >= 0xd800 && char <= 0xdfff ? '\ufffd' : String.fromCharCode(char);
      at += 3;
    } else if (b1 >= 0xf0 && b1 <= 0xf7) {
      if (left < 4) {
        if (b1 > 0xf4 || (left > 1 && malformed4(b1, bytes[at + 1]))) {
          text += '\ufffd';
          at += 1;
          continue;
        }
        if (left > 2 && !continuation(bytes[at + 2])) {
          text += '\ufffd';
          at += 2;
          continue;
        }
        break;
      }
      const [b2, b3, b4] = [bytes[at + 1], bytes[at + 2], bytes[at + 3]];
      const point = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f);
      if (
        !continuation(b2) ||
        !continuation(b3) ||
        !continuation(b4) ||
        point < 0x10000 ||
        point > 0x10ffff
      ) {
        text += '\ufffd';
        at += malformed4(b1, b2) ? 1 : !continuation(b3) ? 2 : 3;
        continue;
      }
      text += String.fromCodePoint(point);
      at += 4;
    } else {
      text += '\ufffd';
      at += 1;
    }
  }
  // What is left is an incomplete sequence: one replacement for all of it.
  return at < bytes.length ? `${text}\ufffd` : text;
}

/** The raw, undecoded path segment at `index` (`/ContentService/data/query/{id}` is 4). */
function rawSegment(request, index) {
  return (
    String(request.originalUrl ?? '')
      .split('?')[0]
      ?.split('/')[index] ?? ''
  );
}

/**
 * Java's error envelope, which callers already parse.
 *
 * Reproduced rather than invented because a 404 here is part of the contract:
 * `/data/pathways/top/{taxId}` answers 404 for a species with no top-level
 * pathways, existent or not, and node was answering `200 []`. Nothing caught it
 * because the diff had only ever been run with valid species ids -- the
 * not-found path was never compared with anything.
 *
 * `url` is rebuilt from the request. Behind nginx that is the external URL,
 * because `proxy_set_header Host $host` preserves it; asked directly on
 * loopback it is the loopback address, which is what Java would say too. It
 * leaves the query out, as every Java error url does (javaError): this one
 * used to keep it, so `/pathways/low/entity/foo?species=9606` named the
 * species in its url where Java does not -- hidden from the diff harness by
 * the `.url` differences endpoints declare for the host.
 */
export function notFound(request, message) {
  return javaError(request, 404, 'NOT_FOUND', message);
}

/** The named properties that are actually present. Absent means omitted, not null. */
function only(source, keys) {
  const out = {};
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) out[key] = source[key];
  }
  return out;
}

/**
 * An event as graph-core's EventProjection, written as Java writes it.
 *
 * Jackson's order: properties backed by a field of the same name, in the order
 * the fields are declared, then `inferred` and `inDisease`, whose getters do not
 * match their `isInferred` / `isInDisease` fields. Absent values are omitted,
 * except the ones the projection defaults: false for the flags, 0 for the
 * diagram size -- which is why a reaction says `"hasDiagram":false`.
 */
export function eventProjection(node) {
  return {
    ...only(node, [
      'dbId',
      'displayName',
      'stId',
      'name',
      'stIdVersion',
      'oldStId',
      'schemaClass',
      'doi',
      'speciesName',
      'releaseDate',
      'releaseStatus',
    ]),
    hasDiagram: node.hasDiagram ?? false,
    hasEHLD: node.hasEHLD ?? false,
    diagramWidth: node.diagramWidth ?? 0,
    diagramHeight: node.diagramHeight ?? 0,
    ...only(node, ['category', 'isCanonical', 'definition']),
    inferred: node.isInferred ?? false,
    inDisease: node.isInDisease ?? false,
  };
}

/**
 * java.net.URLDecoder.decode(s, "UTF-8"), which content-service applies to
 * /pathways/top's species on top of the servlet's own decoding: '+' is a
 * space, runs of %XX are bytes decoded as UTF-8 (javaUtf8), and a '%' with
 * fewer than two characters after it, or two that Integer.parseInt(…, 16)
 * refuses, throws Java's own message -- which Java answers as a 500.
 * parseInt takes a sign, so '%-1' is the "negative value" error and '%+F' is
 * 0x0F, as in Java; its digits are Character.digit's.
 */
export function javaUrlDecode(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '+') {
      out += ' ';
      i += 1;
    } else if (c === '%') {
      const bytes = [];
      while (i + 2 < text.length && text[i] === '%') {
        bytes.push(javaHexByte(text.slice(i + 1, i + 3)));
        i += 3;
      }
      if (i < text.length && text[i] === '%') {
        throw new Error('URLDecoder: Incomplete trailing escape (%) pattern');
      }
      out += javaUtf8(Uint8Array.from(bytes));
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** Integer.parseInt(two, 16) as URLDecoder uses it, with its messages. */
function javaHexByte(two) {
  const digit = (ch) => {
    if (/^[0-9a-fA-F]$/.test(ch)) return parseInt(ch, 16);
    const code = ch.charCodeAt(0);
    // Fullwidth A-F and a-f, which Character.digit accepts.
    if (code >= 0xff21 && code <= 0xff26) return code - 0xff21 + 10;
    if (code >= 0xff41 && code <= 0xff46) return code - 0xff41 + 10;
    if (javaNumeric(ch)) return Number(asciiDigits(ch));
    return -1;
  };
  const refuse = (index) =>
    new Error(
      `URLDecoder: Illegal hex characters in escape (%) pattern - Error at index ${index} in: "${two}"`
    );
  let sign = 1;
  let start = 0;
  if (two[0] === '-' || two[0] === '+') {
    sign = two[0] === '-' ? -1 : 1;
    start = 1;
  }
  let value = 0;
  for (let k = start; k < two.length; k += 1) {
    const d = digit(two[k]);
    if (d < 0) throw refuse(k);
    value = value * 16 + d;
  }
  value *= sign;
  if (value < 0) {
    throw new Error('URLDecoder: Illegal hex characters in escape (%) pattern - negative value');
  }
  return value;
}

/**
 * The species of /pathways/top/{species}, as graph-core's
 * TopLevelPathwayService reads it: StringUtils.isNumeric is a taxId, anything
 * else must equal a Species' displayName exactly -- "Homo sapiens" answers,
 * "homo sapiens" and "Homo_sapiens" are 404s. Not the looser speciesFilter
 * other endpoints use.
 */
export function topSpeciesMatch(raw) {
  return javaNumeric(raw)
    ? { where: 's.taxId = $species', params: { species: raw } }
    : { where: 's.displayName = $species', params: { species: raw } };
}

/**
 * A top-level pathway as Java writes it under /pathways/top/{species}: the
 * Pathway fields in Jackson's order -- releaseStatus before speciesName, then
 * the species, then doi -- with `species` the one-element array the caller
 * builds (the Species object the first time, its dbId after).
 */
export function topPathwayJson(pathway, species) {
  return {
    ...only(pathway, [
      'dbId',
      'displayName',
      'stId',
      'stIdVersion',
      'isInDisease',
      'isInferred',
      'maxDepth',
      'name',
      'releaseDate',
      'releaseStatus',
      'speciesName',
    ]),
    species: [species],
    ...only(pathway, ['doi', 'hasDiagram', 'hasEHLD', 'lastUpdatedDate']),
    schemaClass: pathway.schemaClass,
    className: pathway.schemaClass,
  };
}

/**
 * A Pathway as graph-core's domain class serialises it when only the node is
 * loaded: these keys, in this order, absent values omitted. Measured from
 * Java's answers, which agree across 150 pathways: `oldStId` and the diagram
 * size are on the node but not written, and `className` repeats the class.
 */
export function pathwayJson(node) {
  // hasEHLD has a field default of false in Java, should a node lack it (none
  // does today); isCanonical is declared but on no node yet.
  const out = only({ ...node, hasEHLD: node.hasEHLD ?? false }, [
    'dbId',
    'displayName',
    'stId',
    'stIdVersion',
    'definition',
    'isInDisease',
    'isInferred',
    'maxDepth',
    'name',
    'releaseDate',
    'releaseStatus',
    'speciesName',
    'doi',
    'hasDiagram',
    'hasEHLD',
    'isCanonical',
    'lastUpdatedDate',
    'schemaClass',
  ]);
  if (node.schemaClass) out.className = node.schemaClass;
  return out;
}

/**
 * The ReferenceEntity classes, most specific first: a node carries the labels
 * of its class and every superclass, in no reliable order (an isoform lists
 * ReferenceGeneProduct after ReferenceIsoform), and graph-core maps it to the
 * most specific -- which is also what `className` says, even on the two nodes
 * whose schemaClass property reads "6".
 */
const REFERENCE_CLASSES = [
  'ReferenceIsoform',
  'ReferenceGeneProduct',
  'ReferenceDNASequence',
  'ReferenceRNASequence',
  'ReferenceTherapeutic',
  'ReferenceMolecule',
  'ReferenceGroup',
  'ReferenceSequence',
  'ReferenceEntity',
];

/** What each class's constructor sets moleculeType to; ReferenceGroup sets none. */
const MOLECULE_TYPES = {
  ReferenceIsoform: 'Protein',
  ReferenceGeneProduct: 'Protein',
  ReferenceDNASequence: 'Entity',
  ReferenceRNASequence: 'Entity',
  ReferenceSequence: 'Entity',
  ReferenceTherapeutic: 'ChemicalDrug',
  ReferenceMolecule: 'Chemical',
};

/**
 * A ReferenceEntity as graph-core serialises a bare node, whatever its class:
 * one key order fits them all, measured from Java over 16,000 entities of six
 * classes. Stored but never written: ReferenceMolecule's `trivial`.
 */
export function referenceEntityJson(node, labels) {
  const className = REFERENCE_CLASSES.find((name) => labels.includes(name)) ?? 'ReferenceEntity';
  const moleculeType = MOLECULE_TYPES[className];
  return {
    ...only(node, [
      'dbId',
      'displayName',
      'stId',
      'databaseName',
      'identifier',
      'name',
      'otherIdentifier',
      'url',
    ]),
    ...(moleculeType && { moleculeType }),
    ...only(node, [
      'formula',
      'checksum',
      'comment',
      'description',
      'geneName',
      'isSequenceChanged',
      'keyword',
      'secondaryIdentifier',
      'sequenceLength',
      'chain',
      'variantIdentifier',
      'abbreviation',
      'approvalSource',
      'approved',
      'inn',
      'type',
    ]),
    className,
    ...only(node, ['schemaClass']),
  };
}

/**
 * The driver's Value.asString() as graph-core calls it on a reference
 * entity's fields: a missing value is not left out but written as the text
 * "null", because NullValue.asString() returns that.
 */
function asJavaString(value) {
  return value === null || value === undefined ? 'null' : String(value);
}

/**
 * The relationships Java's participants queries follow from the event. The
 * dbId query also follows RNAMarker and proteinMarker and the stable-id one
 * does not -- a difference in graph-core, kept, because it shows: for a Cell
 * the dbId form reaches its RNA markers and the stable-id form returns [].
 */
export function participantsFrom(byDbId) {
  return byDbId
    ? 'hasEvent|input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|RNAMarker|proteinMarker|regulator'
    : 'hasEvent|input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator';
}

/**
 * graph-core's Participant as Java writes it: the entity's dbId, name and
 * class (a missing name or class left out -- asString(null) there), then its
 * reference entities in ParticipantRefEntities' field order.
 */
export function participantJson(row) {
  return {
    peDbId: row.peDbId,
    ...only(row, ['displayName', 'schemaClass']),
    refEntities: (row.refEntities ?? []).map((ref) => ({
      dbId: ref.dbId,
      stId: asJavaString(ref.stId),
      identifier: asJavaString(ref.identifier),
      schemaClass: asJavaString(ref.schemaClass),
      displayName: asJavaString(ref.displayName),
      icon: asJavaString(ref.icon),
      url: asJavaString(ref.url),
    })),
  };
}

/** EntityWithAccessionedSequence.getClassName: by the reference type. */
const EWAS_CLASS_NAMES = {
  ReferenceGeneProduct: 'Protein',
  ReferenceDNASequence: 'DNA Sequence',
  ReferenceRNASequence: 'RNA Sequence',
};

/** The stored fields, in the order Jackson writes them for every class here. */
const PHYSICAL_ENTITY_FIELDS = [
  'dbId',
  'displayName',
  'stId',
  'stIdVersion',
  'definition',
  'maxDepth',
  'name',
  'speciesName',
  'systematicName',
  'endCoordinate',
  'referenceType',
  'startCoordinate',
];

/**
 * A physical entity -- of the classes that have a reference entity -- as
 * graph-core serialises a bare node. Measured from Java over every class that
 * appears as an other form, and the class names from graph-core's getters:
 *
 * - an EWAS is named by its reference type (Protein, DNA Sequence, RNA
 *   Sequence), and anything else -- an isoform's -- falls back to
 *   GenomeEncodedEntity's "Genes and Transcripts";
 * - a SimpleEntity is a "Chemical Compound";
 * - a drug has no override, so DatabaseObject's simple class name, and
 *   Jackson writes it last rather than before inDisease.
 *
 * `isInDisease` is written as `inDisease`; `oldStId` never (@JsonIgnore).
 */
export function physicalEntityJson(node) {
  const head = only(node, PHYSICAL_ENTITY_FIELDS);
  const tail = only({ inDisease: node.isInDisease, schemaClass: node.schemaClass }, [
    'inDisease',
    'schemaClass',
  ]);
  if (node.schemaClass === 'EntityWithAccessionedSequence') {
    const className = EWAS_CLASS_NAMES[node.referenceType] ?? 'Genes and Transcripts';
    return { ...head, className, ...tail };
  }
  if (node.schemaClass === 'SimpleEntity') {
    return { ...head, className: 'Chemical Compound', ...tail };
  }
  return { ...head, ...tail, ...(node.schemaClass && { className: node.schemaClass }) };
}

/**
 * What a NullPointerException would have been in Java: graph-core dereferences
 * a few values without checking them, and Java answers its generic 500 then.
 */
class JavaNullPointer extends Error {}

/** Java's String.compareTo: by UTF-16 unit, which is also what `<` compares. */
function javaCompare(a, b) {
  if (a === null || a === undefined) throw new JavaNullPointer('compareTo on null');
  if (b === null || b === undefined) throw new JavaNullPointer('compareTo with null');
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * graph-core's PathwayBrowserNode (service/helper), the node of every tree the
 * Pathway Browser's hierarchy endpoints answer with.
 *
 * Its children and parents are TreeSets ordered by compareTo -- species, then
 * the curated `order`, then name -- and a TreeSet keeps the first of two
 * entries that compare equal, so two different events with the same name,
 * species and order under one parent are one child. Kept, because Java's
 * answer is that: here they are arrays held in that order, with that rule.
 *
 * There is no equals or hashCode, and no identity in the JSON: a node reached
 * from two parents is one object, written out in full under each.
 */
export class PathwayBrowserNode {
  stId = undefined;
  name = undefined;
  species = undefined;
  url = undefined;
  type = undefined;
  diagram = undefined;
  unique = undefined;
  order = undefined;
  children = null;
  parent = null;

  addChild(node) {
    this.children = sortedAdd(this.children, node);
  }

  addParent(node) {
    this.parent = sortedAdd(this.parent, node);
  }

  hasDiagram() {
    return this.diagram ?? false;
  }

  /** PathwayBrowserNode.compareTo. */
  compareTo(node) {
    const species = javaCompare(this.species ?? '', node.species ?? '');
    if (species !== 0) return species;
    const order = (this.order ?? 0) - (node.order ?? 0);
    if (order !== 0) return order;
    return javaCompare(this.name, node.name);
  }

  /** getLeaves: a TreeSet, so leaves that compare equal are one. */
  getLeaves() {
    if (this.children === null) return [this];
    let leaves = null;
    for (const child of this.children) {
      for (const leaf of child.getLeaves()) leaves = sortedAdd(leaves, leaf);
    }
    return leaves ?? [];
  }
}

/** TreeSet.add: in compareTo order, and nothing added when an equal one is there. */
function sortedAdd(set, node) {
  const list = set ?? [];
  // TreeMap.put on an empty map still compares the key with itself.
  if (list.length === 0) node.compareTo(node);
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const order = node.compareTo(list[middle]);
    if (order === 0) return list;
    if (order < 0) high = middle;
    else low = middle + 1;
  }
  list.splice(low, 0, node);
  return list;
}

/**
 * HierarchyTreeItem.build: one `[stId, displayName, hasDiagram, speciesName,
 * schemaClass, labels, order]` row of the query, read with the driver's
 * defaults -- a missing flag is false and a missing order 0.
 */
function treeItem(row) {
  return {
    stId: row[0] ?? null,
    displayName: row[1] ?? null,
    hasDiagram: row[2] ?? false,
    speciesName: row[3] ?? null,
    schemaClass: row[4] ?? null,
    labels: row[5] ?? [],
    order: row[6] ?? 0,
  };
}

/** The types the browser cannot place, which the tree skips unless told not to. */
function displayable(type) {
  if (type === null || type === undefined) throw new JavaNullPointer('type');
  return (
    type !== 'CatalystActivity' &&
    !type.includes('Regulation') &&
    type !== 'Requirement' &&
    type !== 'EntityFunctionalStatus'
  );
}

/**
 * HierarchyRepository.parseRaw, kept line for line: the tree from the query's
 * root and its paths, each path a list of tree items.
 *
 * One node per stId (a HashMap, so every item without a stable id is the one
 * node too). A path longer than the previous one is taken to extend it, and
 * only its last step is added, to whatever node the previous path ended on --
 * true of the order Neo4j expands paths in, and not checked. Anything else
 * starts again from the root. That rule is why the query is run exactly as
 * Java writes it: the rows' order is part of the answer.
 */
export function parseHierarchy(rootRow, paths, omitNonDisplayableItems) {
  const rootItem = treeItem(rootRow);
  const root = new PathwayBrowserNode();
  root.stId = rootItem.stId ?? undefined;
  root.name = rootItem.displayName ?? undefined;
  root.type = rootItem.schemaClass ?? undefined;
  if (rootItem.labels.includes('Event')) {
    root.species = rootItem.speciesName ?? undefined;
    if (rootItem.labels.includes('Pathway')) root.diagram = rootItem.hasDiagram;
  } else if (rootItem.labels.includes('PhysicalEntity')) {
    root.species = rootItem.speciesName ?? undefined;
  }

  const nodes = new Map([[rootItem.stId, root]]);
  const addNode = (previous, row) => {
    const found = treeItem(row);
    let node = nodes.get(found.stId);
    if (!node) {
      node = new PathwayBrowserNode();
      node.stId = found.stId ?? undefined;
      node.name = found.displayName ?? undefined;
      node.diagram = found.hasDiagram;
      node.species = found.speciesName ?? undefined;
      node.type = found.schemaClass ?? undefined;
      node.order = found.order;
      nodes.set(found.stId, node);
    }
    if (!omitNonDisplayableItems || displayable(node.type)) {
      previous.addChild(node);
      node.addParent(previous);
      return node;
    }
    return previous;
  };

  let previous = root;
  let previousSize = 0;
  for (const path of paths ?? []) {
    if (path.length > previousSize) {
      previous = addNode(previous, path[path.length - 1]);
    } else {
      previous = root;
      for (const row of path) previous = addNode(previous, row);
    }
    previousSize = path.length;
  }
  return root;
}

const PATHWAY_BROWSER_URL = '/PathwayBrowser/#/';
const PATHWAY_TYPES = new Set(['Pathway', 'CellLineagePath', 'TopLevelPathway']);

/**
 * The controller's getLeaves, PathwayBrowserLocationsUtils.removeOrphans and
 * buildTreesFromLeaves: the reverse graph turned round, one tree per top-level
 * pathway, each node carrying the browser address that opens it in place.
 * Kept line for line, `unique` included: it is written onto the shared graph
 * nodes as the walk goes, so a node's address depends on the walk's order.
 */
export function locationsInPathwayBrowser(root) {
  const leaves = root.getLeaves().filter((leaf) => leaf.type === 'TopLevelPathway');
  let trees = null;
  for (const leaf of leaves) trees = sortedAdd(trees, treeFromLeaf(leaf, '', '', '', ''));
  return trees ?? [];
}

function treeFromLeaf(leaf, sel, path, shortPath, lastNodeWithDiagram) {
  const tree = new PathwayBrowserNode();
  tree.stId = leaf.stId;
  tree.name = leaf.name;
  tree.species = leaf.species;
  tree.type = leaf.type;

  if (leaf.type === null || leaf.type === undefined) throw new JavaNullPointer('type');
  const isPathway = PATHWAY_TYPES.has(leaf.type);
  const hasDiagram = leaf.hasDiagram();
  leaf.unique = false;

  let main;
  if (isPathway) {
    main = leaf.stId;
  } else {
    sel = leaf.stId;
    main = lastNodeWithDiagram;
  }

  const children = leaf.children;
  if (isPathway) {
    if (children === null) {
      leaf.unique = true;
    } else if (children.length === 1) {
      const only = children[0].unique;
      if (only === null || only === undefined) throw new JavaNullPointer('isUnique');
      if (only) leaf.unique = true;
    }
  }

  // StringBuilder.append(null) writes "null".
  const text = (value) => (value === null || value === undefined ? 'null' : String(value));
  let url = PATHWAY_BROWSER_URL;
  if (leaf.unique) {
    url += text(leaf.stId);
  } else {
    url += text(main);
    if (sel === null || sel === undefined) throw new JavaNullPointer('sel');
    if (sel !== '') url += `&amp;SEL=${sel}`;
    const trail = isPathway ? path : shortPath;
    if (trail !== '') url += `&amp;PATH=${trail}`;
  }
  tree.url = url;

  if (isPathway) {
    if (hasDiagram) {
      shortPath += shortPath === '' ? text(lastNodeWithDiagram) : `,${text(lastNodeWithDiagram)}`;
    } else {
      path += path === '' ? text(leaf.stId) : `,${text(leaf.stId)}`;
    }
  }
  if (hasDiagram) lastNodeWithDiagram = leaf.stId;

  for (const node of leaf.parent ?? []) {
    tree.addChild(treeFromLeaf(node, sel, path, shortPath, lastNodeWithDiagram));
  }
  return tree;
}

/**
 * A PathwayBrowserNode as Jackson writes it: the field-backed properties in
 * declaration order, the @JsonIgnore'd ones (unique, order, parent and two
 * flags) never, and -- under the service's non_empty -- nothing that is null,
 * and no empty children.
 */
export function pathwayBrowserJson(node) {
  const out = only(node, ['stId', 'name', 'species', 'url', 'type', 'diagram']);
  if (node.children?.length) out.children = node.children.map(pathwayBrowserJson);
  return out;
}

/**
 * A `Boolean` request parameter as Spring converts it (StringToBooleanConverter):
 * the first value decides, trimmed as String.trim trims; empty is absent; true,
 * on, yes and 1 or false, off, no and 0 in any case; anything else Java's 400.
 *
 * The 400 names what Spring was given: one value is a String, named as sent;
 * several are a String[], and the message lists all of them joined by ','
 * (untrimmed) even though only the first was read. A refused later value
 * changes nothing -- `true&foo` is true. All measured against Java.
 */
export function springBoolean(values) {
  const [raw] = values;
  if (raw === undefined) return { value: undefined };
  const value = javaTrim(raw).toLowerCase();
  if (value === '') return { value: undefined };
  if (['true', 'on', 'yes', '1'].includes(value)) return { value: true };
  if (['false', 'off', 'no', '0'].includes(value)) return { value: false };
  const type = values.length > 1 ? 'java.lang.String[]' : 'java.lang.String';
  return {
    error:
      `Failed to convert value of type '${type}' to required type 'java.lang.Boolean'; ` +
      `nested exception is java.lang.IllegalArgumentException: Invalid boolean value [${values.join(',')}]`,
  };
}

/**
 * An `Integer` request parameter as Spring binds it, given its values as the
 * servlet reads them (queryValues). Measured against Java case by case:
 *
 * - none is Spring's "not present" 400; an empty first value converts to null,
 *   which is its "present but converted to null" 400.
 * - the ConversionService reads the first value with NumberUtils.parseNumber:
 *   every Java whitespace character removed (anywhere, not just the ends),
 *   then `0x`, `0X` or `#` after an optional '-' is Integer.decode's hex, and
 *   anything else Integer.valueOf -- a '+' sign, leading zeros and digits of
 *   any script accepted.
 * - when that fails Spring tries again with the CustomNumberEditor, on the
 *   value -- or all of them joined by ',' -- which reads blank as null and
 *   otherwise parses the same way. The NumberFormatException of that second
 *   attempt is the 400's message, naming String or String[].
 */
export function springInteger(values, name) {
  const required = `Required request parameter '${name}' for method parameter type Integer`;
  if (values.length === 0) return { error: `${required} is not present` };
  const empty = { error: `${required} is present but converted to null` };
  const attempt = (text) => {
    try {
      return { value: javaParseInteger(text) };
    } catch (failure) {
      if (failure instanceof JavaNumberFormat) return { failure: failure.message };
      throw failure;
    }
  };

  const [first] = values;
  if (first === '') return empty;
  const converted = attempt(first);
  if ('value' in converted) return converted;

  const text = values.join(',');
  if (javaTrimAll(text) === '') return empty;
  const retried = attempt(text);
  if ('value' in retried) return retried;
  const type = values.length > 1 ? 'java.lang.String[]' : 'java.lang.String';
  return {
    error:
      `Failed to convert value of type '${type}' to required type 'java.lang.Integer'; ` +
      `nested exception is java.lang.NumberFormatException: ${retried.failure}`,
  };
}

/** A java.lang.NumberFormatException, carrying Java's message. */
class JavaNumberFormat extends Error {}

/**
 * Character.isWhitespace as the service's JVM has it: the space,
 * line and paragraph separators but the no-break ones, and the ASCII controls
 * \t-\r and \u001C-\u001F.
 */
const JAVA_WHITESPACE = new RegExp(
  `[${[
    [0x09, 0x0d],
    [0x1c, 0x20],
    [0x1680, 0x1680],
    [0x2000, 0x2006],
    [0x2008, 0x200a],
    [0x2028, 0x2029],
    [0x205f, 0x205f],
    [0x3000, 0x3000],
  ]
    .map(([from, to]) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`)
    .join('')}]`,
  'g'
);

/** Spring's StringUtils.trimAllWhitespace. */
function javaTrimAll(text) {
  return text.replace(JAVA_WHITESPACE, '');
}

/**
 * NumberUtils.parseNumber(text, Integer.class), or Long.class for 64 bits:
 * Integer's as a number, Long's as a bigint.
 */
function javaParseInteger(text, bits = 32) {
  const trimmed = javaTrimAll(text);
  const at = trimmed.startsWith('-') ? 1 : 0;
  const hex =
    trimmed.startsWith('0x', at) || trimmed.startsWith('0X', at) || trimmed.startsWith('#', at);
  const value = hex ? javaDecode(trimmed, bits) : javaParseInt(trimmed, 10, bits);
  return bits === 32 ? Number(value) : value;
}

/** Integer.decode, or Long.decode, as far as parseNumber reaches it. */
function javaDecode(text, bits) {
  if (text === '') throw new JavaNumberFormat('Zero length string');
  let index = 0;
  let radix = 10;
  const negative = text[0] === '-';
  if (negative || text[0] === '+') index += 1;
  if (text.startsWith('0x', index) || text.startsWith('0X', index)) {
    index += 2;
    radix = 16;
  } else if (text.startsWith('#', index)) {
    index += 1;
    radix = 16;
  } else if (text.startsWith('0', index) && text.length > 1 + index) {
    index += 1;
    radix = 8;
  }
  if (text.startsWith('-', index) || text.startsWith('+', index)) {
    throw new JavaNumberFormat('Sign character in wrong position');
  }
  const rest = text.slice(index);
  try {
    const result = javaParseInt(rest, radix, bits);
    return negative ? BigInt.asIntN(bits, -result) : result;
  } catch (failure) {
    if (!(failure instanceof JavaNumberFormat)) throw failure;
    // Java retries with the sign attached, for the one value that needs it
    // (-0x80000000), and that attempt's message is the one reported.
    return javaParseInt(negative ? `-${rest}` : rest, radix, bits);
  }
}

/**
 * Integer.parseInt(text, radix), or Long.parseLong for 64 bits, as the
 * service's JVM has them, per UTF-16 unit. A bigint either way.
 */
function javaParseInt(text, radix, bits) {
  const refuse = () => {
    throw new JavaNumberFormat(`For input string: "${text}"`);
  };
  if (text.length === 0) refuse();
  const min = -(1n << BigInt(bits - 1));
  let i = 0;
  let negative = false;
  let limit = min + 1n;
  if (text[0] < '0') {
    if (text[0] === '-') {
      negative = true;
      limit = min;
    } else if (text[0] !== '+') refuse();
    if (text.length === 1) refuse();
    i += 1;
  }
  const base = BigInt(radix);
  const multmin = limit / base;
  let result = 0n;
  while (i < text.length) {
    const digit = javaDigit(text[i], radix);
    i += 1;
    if (digit < 0 || result < multmin) refuse();
    result *= base;
    if (result < limit + BigInt(digit)) refuse();
    result -= BigInt(digit);
  }
  return negative ? result : -result;
}

/**
 * Character.digit(char, radix): a decimal digit of any script, and for hex the
 * Latin letters A-F in either case, fullwidth ones included.
 */
function javaDigit(char, radix) {
  const code = char.charCodeAt(0);
  if (radix === 16) {
    for (const start of [0x41, 0x61, 0xff21, 0xff41]) {
      if (code >= start && code <= start + 5) return code - start + 10;
    }
  }
  if (!/\p{Nd}/u.test(char)) return -1;
  const value = Number(asciiDigits(char));
  return value < radix ? value : -1;
}

/**
 * One query parameter's values as Tomcat reads them, in order: the query is
 * split on '&' and each pair at its first '='; a pair with no name is skipped;
 * name and value are percent-decoded, '+' as a space, the bytes read as UTF-8
 * with U+FFFD for a bad sequence. A pair whose name or value holds a malformed
 * escape (`%zz`, a lone `%`) is dropped whole -- Tomcat logs it and carries on
 * -- which URLSearchParams does not do: it keeps the text as it is.
 */
export function servletParameter(query, name) {
  const values = [];
  for (const pair of String(query).split('&')) {
    if (pair === '') continue;
    const at = pair.indexOf('=');
    const key = servletDecode(at === -1 ? pair : pair.slice(0, at));
    const value = servletDecode(at === -1 ? '' : pair.slice(at + 1));
    if (key === null || value === null || key === '') continue;
    if (key === name) values.push(value);
  }
  return values;
}

/** Percent-decoding as Tomcat's query parser does it, or null when malformed. */
function servletDecode(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '+') {
      bytes.push(0x20);
    } else if (char === '%') {
      const hex = text.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(char, 'utf8'));
    }
  }
  return javaUtf8(bytes);
}

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
export function personWhere(id, { email = false } = {}) {
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
 * graph-core's DatabaseObjectUtils.getIdentifier then isStId / isDbId, as the
 * in-depth services read an id: trimmed, a version cut unless the id has a
 * ':', a pre-2016 REACT_ id translated to the object it was, then a stable id
 * if it starts with R or has a ':', else a dbId if numeric (any script's
 * digits), else nothing.
 */
export function inDepthId(raw) {
  const trimmed = javaTrim(raw);
  const id = trimmed.includes(':') ? trimmed : trimmed.split('.')[0];
  // getIdentifier swaps an old REACT_ id for the stable id it became: the
  // object whose oldStId it is.
  if (id.startsWith('REACT_')) return { idType: 'oldStId', id };
  if (id.startsWith('R') || id.includes(':')) return { idType: 'stId', id };
  if (javaNumeric(id)) return { idType: 'dbId', id: asciiDigits(id) };
  return undefined;
}

/**
 * QueryObjectController.needsIncomingRelationship, on the id as it came (not
 * as getIdentifier reads it): a stable id needs them unless it is a chemical
 * (R-ALL-, chebi:); a dbId -- Long.valueOf, so a sign but no padding -- unless
 * the object is a Species, Summation, Person, Compartment or SimpleEntity.
 * Anything Long.valueOf refuses, or no such object, is Java's caught
 * exception: false.
 */
export async function needsIncoming(raw) {
  if (raw.startsWith('R') || raw.includes(':'))
    return !raw.startsWith('R-ALL-') && !raw.startsWith('chebi:');
  const sign = /^[+-]/.test(raw) ? raw[0] : '';
  const digits = raw.slice(sign.length);
  if (!javaNumeric(digits)) return false;
  const value = BigInt(`${sign === '-' ? '-' : ''}${asciiDigits(digits)}`);
  if (value > 9223372036854775807n || value < -9223372036854775808n) return false;
  const [row] = await read(
    `MATCH (n:DatabaseObject) WHERE n.dbId = $id
     RETURN NOT (n:Species OR n:Summation OR n:Person OR n:Compartment OR n:SimpleEntity) AS needs`,
    { id: neo4j.int(value.toString()) }
  );
  return row?.needs ?? false;
}

/**
 * `attributes` as the in-depth controllers read it: Spring joins repeated
 * values with ',', and an empty one takes the default; String.split(',')
 * drops trailing empties; an empty list means species. Joined with '|' for
 * the relationship pattern -- and refused unless that is relationship type
 * names, because Java writes it into the query text unchecked.
 */
export function inDepthAttributes(values, fallback = 'species,compartment') {
  const text = values.length && values.join(',') !== '' ? values.join(',') : fallback;
  const parts = text.split(',');
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  const joined = (parts.length ? parts : ['species']).join('|');
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\|[A-Za-z_][A-Za-z0-9_]*)*$/.test(joined))
    return { error: `attributes must be relationship type names, not: ${text}` };
  return { value: joined };
}

/**
 * A primitive `boolean` request parameter with a default, as Spring reads it:
 * absent or empty takes the default; otherwise as springBoolean reads a
 * Boolean, except that blank is no longer "absent" but a value Spring cannot
 * put in a primitive -- its 400, naming `boolean`. Measured against Java's
 * /query/enhanced/v2.
 */
export function springPrimitiveBoolean(values, fallback) {
  // Only one empty value is Spring's "absent": repeated, the array is converted.
  if (values.length === 0 || (values.length === 1 && values[0] === '')) return { value: fallback };
  const value = javaTrim(values[0]).toLowerCase();
  if (['true', 'on', 'yes', '1'].includes(value)) return { value: true };
  if (['false', 'off', 'no', '0'].includes(value)) return { value: false };
  const type = values.length > 1 ? 'java.lang.String[]' : 'java.lang.String';
  return {
    error:
      `Failed to convert value of type '${type}' to required type 'boolean'; ` +
      `nested exception is java.lang.IllegalArgumentException: Invalid boolean value [${values.join(',')}]`,
  };
}

/**
 * A primitive `int` request parameter with a default, as Spring reads it:
 * absent or empty takes the default; otherwise the first value parsed as
 * NumberUtils.parseNumber does (see springInteger), then all of them joined;
 * failing both, the 400 names `int` and the second attempt's message.
 */
export function springIntWithDefault(values, fallback) {
  // Only one empty value is Spring's "absent": repeated, the array is converted.
  if (values.length === 0 || (values.length === 1 && values[0] === '')) return { value: fallback };
  const attempt = (text) => {
    try {
      return { value: javaParseInteger(text) };
    } catch (failure) {
      if (failure instanceof JavaNumberFormat) return { failure: failure.message };
      throw failure;
    }
  };
  const converted = attempt(values[0]);
  if ('value' in converted) return converted;
  const retried = attempt(values.join(','));
  if ('value' in retried) return retried;
  const type = values.length > 1 ? 'java.lang.String[]' : 'java.lang.String';
  return {
    error:
      `Failed to convert value of type '${type}' to required type 'int'; ` +
      `nested exception is java.lang.NumberFormatException: ${retried.failure}`,
  };
}

/** rfd-snapshot.json's extensions, read on first use. */
let safeExtensions;

/**
 * Whether Java would mark this answer `Content-Disposition:
 * inline;filename=f.txt` -- Spring's guard against a reflected download
 * (AbstractMessageConverterMethodProcessor.addContentDispositionHeader), on
 * every body it writes but a redirect's. The request path's last segment is
 * read up to any ';', percent-decoded, and its extension -- after the last
 * '.' -- checked; so is the extension of the matrix parameters after it. An
 * extension Spring does not trust (rfd-snapshot.json; snapshot-rfd.mjs says
 * which it does) on either is marked: a versioned id, `R-HSA-69620.5`, as
 * much as `.exe`.
 */
export function downloadGuard(request) {
  const uri = String(request.originalUrl ?? '').split('?')[0];
  const last = uri.slice(uri.lastIndexOf('/') + 1);
  const at = last.indexOf(';');
  const name = at === -1 ? last : last.slice(0, at);
  const parameters = at === -1 ? '' : last.slice(at);
  safeExtensions ??= new Set(
    JSON.parse(readFileSync(new URL('./rfd-snapshot.json', import.meta.url), 'utf8')).safe
  );
  const trusted = (text) => {
    let decoded = text;
    try {
      decoded = decodeURIComponent(text);
    } catch {
      // Left as it came; Tomcat has refused a malformed escape before this.
    }
    const dot = decoded.lastIndexOf('.');
    if (dot === -1 || decoded.lastIndexOf('/') > dot) return true;
    const extension = decoded.slice(dot + 1);
    return javaTrimAll(extension) === '' || safeExtensions.has(extension.toLowerCase());
  };
  return !trusted(name) || !trusted(parameters);
}

/**
 * An `Integer` request parameter with a default, as Spring binds it: none, or
 * one empty value, is the default; otherwise the first value converts -- an
 * empty one to null -- and failing that, all of them joined, which with no
 * text is null too. A null is the caller's to answer.
 */
export function springIntegerWithDefault(values, fallback) {
  if (values.length === 0 || (values.length === 1 && values[0] === '')) return { value: fallback };
  if (values[0] === '') return { value: null };
  const attempt = (text) => {
    try {
      return { value: javaParseInteger(text) };
    } catch (failure) {
      if (failure instanceof JavaNumberFormat) return { failure: failure.message };
      throw failure;
    }
  };
  const converted = attempt(values[0]);
  if ('value' in converted) return converted;
  const text = values.join(',');
  if (javaTrimAll(text) === '') return { value: null };
  const retried = attempt(text);
  if ('value' in retried) return retried;
  const type = values.length > 1 ? 'java.lang.String[]' : 'java.lang.String';
  return {
    error:
      `Failed to convert value of type '${type}' to required type 'java.lang.Integer'; ` +
      `nested exception is java.lang.NumberFormatException: ${retried.failure}`,
  };
}

/**
 * A `Long` path variable as Spring binds it: the ConversionService's
 * NumberUtils.parseNumber (see springInteger), then the CustomNumberEditor on
 * the same text, which reads one with no text as null -- for a path variable,
 * Java's 500. Otherwise the 400 names the second attempt's failure.
 */
export function springPathLong(text, name) {
  try {
    return { value: javaParseInteger(text, 64) };
  } catch (failure) {
    if (!(failure instanceof JavaNumberFormat)) throw failure;
    if (javaTrimAll(text) === '')
      return {
        status: 500,
        error: `Required URI template variable '${name}' for method parameter type Long is present but converted to null`,
      };
    return {
      status: 400,
      error:
        "Failed to convert value of type 'java.lang.String' to required type 'java.lang.Long'; " +
        `nested exception is java.lang.NumberFormatException: ${failure.message}`,
    };
  }
}

/**
 * A query the database ended -- at graph.mjs's time limit, by terminating
 * it, or at its memory limit: 503 in Java's envelope -- the request is not
 * malformed, the service will not answer it -- or undefined for any other
 * failure.
 */
export function timedOut(request, failure) {
  const code = String(failure?.code ?? '');
  // Every connection in use: the driver says so in its message alone. Not the
  // caller's fault and not for long, so the same 503 with a reason that fits.
  if (String(failure?.message ?? '').startsWith('Connection acquisition timed out'))
    return javaError(request, 503, 'SERVICE_UNAVAILABLE', 'The service is busy; try again shortly');
  const ended =
    code.startsWith('Neo.ClientError.Transaction.TransactionTimedOut') ||
    code.endsWith('.Transaction.Terminated') ||
    code === 'Neo.TransientError.General.TransactionMemoryLimit' ||
    code === 'Neo.TransientError.General.MemoryPoolOutOfMemoryError' ||
    // The database itself out of memory, or not there: the driver's own codes
    // for an unreachable server or a lost session.
    code === 'Neo.TransientError.General.OutOfMemoryError' ||
    code === 'Neo.TransientError.Database.DatabaseUnavailable' ||
    code === 'ServiceUnavailable' ||
    code === 'SessionExpired';
  if (!ended) return undefined;
  return javaError(
    request,
    503,
    'SERVICE_UNAVAILABLE',
    'The query took longer than this service allows; ask for less (a smaller maxDepth, fewer attributes)'
  );
}

/**
 * CustomMessageConverter.getObjectWriter: the view and identity Java writes
 * domain objects with, from `?view=` and `?includeRef=`, as writeDomain's
 * arguments. getParameter is the first value; Boolean.parseBoolean ignores case.
 */
export function writerFor(request) {
  const [view] = queryValues(request, 'view');
  const [includeRef] = queryValues(request, 'includeRef');
  return [
    view === 'nested'
      ? VIEW.nested
      : view === 'nested-aggregated'
        ? VIEW.nestedAggregated
        : VIEW.flatten,
    { jsog: String(includeRef).toLowerCase() === 'true' },
  ];
}

/** The values of one query parameter as the servlet reads them, in order. */
function queryValues(request, name) {
  const url = String(request.originalUrl ?? '');
  const at = url.indexOf('?');
  return servletParameter(at === -1 ? '' : url.slice(at + 1), name);
}

/**
 * Spring's own 404, for a path no mapping matches: not Java's envelope but
 * BasicErrorController's, with the time it was answered and the path as it
 * came, matrix parameters included.
 */
function springNotFound(request) {
  const path = String(request.originalUrl ?? '').split('?')[0];
  return {
    status: 404,
    type: 'application/json',
    body: javaJson({ timestamp: Date.now(), status: 404, error: 'Not Found', path }),
  };
}

/**
 * A failure Java answers in its own way, or undefined. A dbId past a long's
 * range: Java's Long.parseLong throws, naming the id as it read it (trimmed,
 * any version cut); Neo4j's toInteger refuses it the same way, which is how
 * this sees it -- on every endpoint, whatever its id rules.
 */
export function failureAnswer(request, path, failure) {
  const tooLong = timedOut(request, failure);
  if (tooLong) return tooLong;
  if (
    failure?.code !== 'Neo.ClientError.Statement.TypeError' ||
    !/is too large$/.test(failure.message)
  )
    return undefined;
  // Java names the text it failed to parse: the id (as read: trimmed, any
  // version cut), or a query parameter that was converted the same way, such
  // as /pathways/low/entity's species. Neo4j names the digits it was given.
  const refused = failure.message.match(/integer, (\S+), is too large$/)?.[1];
  const idAt = path.split('/').indexOf('{id}');
  const candidates = [
    ...(idAt < 0 ? [] : [javaTrim(pathId(rawSegment(request, idAt))).split('.')[0]]),
    ...[...new URLSearchParams(String(request.originalUrl ?? '').split('?')[1] ?? '').values()],
  ];
  const named = candidates.find((text) => {
    const trimmed = javaTrim(text);
    return javaNumeric(trimmed) && asciiDigits(trimmed).replace(/^0+(?=\d)/, '') === refused;
  });
  if (named === undefined && idAt < 0) return undefined;
  return javaError(
    request,
    500,
    'INTERNAL_SERVER_ERROR',
    `For input string: "${named ?? candidates[0] ?? refused}"`
  );
}

/**
 * The collations of a Solr spellcheck answer, as SolrJ's
 * getCollatedResults reads them: JSON gives the list flat, name then value,
 * and a value is the collation itself or, when extended, an object carrying
 * it as collationQuery.
 */
export function collations(answer) {
  const flat = answer?.spellcheck?.collations ?? [];
  const found = [];
  for (let at = 0; at + 1 < flat.length; at += 2) {
    if (flat[at] !== 'collation') continue;
    const value = flat[at + 1];
    found.push(typeof value === 'string' ? value : value?.collationQuery);
  }
  return found.filter((value) => typeof value === 'string');
}

/**
 * The answer `work` makes from Solr, or the one Java makes when Solr cannot
 * be asked. `work` is given a signal that aborts when the client goes away
 * -- the search box, a keystroke later -- which takes its waiting Solr calls
 * with it. A queue too long to join is a 503 to retry; any other failure is
 * Java's GlobalExceptionHandler 500, whose message repeats the parameters
 * sent to Solr -- this one says only what failed.
 */
async function fromSolr(request, path, work) {
  const gone = new AbortController();
  request.res?.on('close', () => {
    if (!request.res.writableFinished) gone.abort();
  });
  try {
    return await work(gone.signal);
  } catch (failure) {
    if (gone.signal.aborted) return { status: 500 };
    if (failure.busy)
      return {
        ...javaError(request, 503, 'SERVICE_UNAVAILABLE', 'The service is busy; try again shortly'),
        headers: { 'Retry-After': '5' },
      };
    console.error(`${path}: ${failure.message}`);
    return javaError(request, 500, 'INTERNAL_SERVER_ERROR', 'Solr exception occurred');
  }
}

/**
 * SolrConverter.getFacetMap's FacetMapping, from Solr's facet fields: the
 * field each facet field fills, in the order Jackson writes them.
 */
const FACET_FIELDS = new Map([
  ['species_facet', 'speciesFacet'],
  ['type_facet', 'typeFacet'],
  ['keywords_facet', 'keywordFacet'],
  ['compartment_facet', 'compartmentFacet'],
  ['iconCategories_facet', 'iconCategoriesFacet'],
]);

/**
 * A FacetMapping as ContentService writes it: every count Solr gave, in its
 * order, under the field its facet fills, and what the mapper's NON_EMPTY
 * leaves out left out -- an empty list, a null or empty name. Java's null, no
 * facet fields at all, is undefined. A facet field Java has no place for is
 * its NullPointerException, so a failure here too: a 500, though in the
 * envelope where Java's is Spring's own error page -- only a change to
 * solrconfig.xml could reach it.
 */
export function facetMapping(answer) {
  const fields = answer?.facet_counts?.facet_fields ?? {};
  if (Object.keys(fields).length === 0) return undefined;
  const lists = {};
  for (const [field, flat] of Object.entries(fields)) {
    const key = FACET_FIELDS.get(field);
    if (!key) throw new Error(`a facet field search-core does not map: ${field}`);
    const available = [];
    for (let at = 0; at + 1 < (flat ?? []).length; at += 2)
      available.push(
        flat[at] === null || flat[at] === ''
          ? { count: flat[at + 1] }
          : { name: flat[at], count: flat[at + 1] }
      );
    lists[key] = available.length ? { available } : {};
  }
  const mapping = { totalNumFount: answer?.response?.numFound ?? 0 };
  for (const key of FACET_FIELDS.values()) if (key in lists) mapping[key] = lists[key];
  return mapping;
}

/**
 * A `List<String>` request parameter as Spring binds it: absent is null; one
 * value is split at commas and each part trimmed (StringToCollectionConverter
 * -- so "" is the empty list); several are taken as they are, neither split
 * nor trimmed. Measured against Java's /search/facet_query.
 */
export function springList(values) {
  if (values.length === 0) return null;
  if (values.length > 1) return [...values];
  if (values[0] === '') return [];
  return values[0].split(',').map(javaTrim);
}

const SCOPES = ['REFERENCE_ENTITY', 'PHYSICAL_ENTITY', 'BOTH'];

/**
 * The `scope` parameter, a Query.Scope defaulting to PHYSICAL_ENTITY, as
 * Spring converts it: absent or one empty value takes the default; otherwise
 * the first value, trimmed, must be a constant's exact name -- anything else
 * is the 400 below. Blank converts to null, which search-core's
 * configureScope cannot switch on: Java's 500 (null here).
 */
export function springScope(values) {
  if (values.length === 0 || (values.length === 1 && values[0] === '')) {
    return { value: 'PHYSICAL_ENTITY' };
  }
  const name = javaTrim(values[0]);
  if (name === '') return { value: null };
  if (SCOPES.includes(name)) return { value: name };
  const type = values.length > 1 ? 'java.lang.String[]' : 'java.lang.String';
  return {
    error:
      `Failed to convert value of type '${type}' to required type 'org.reactome.server.search.domain.Query$Scope'; ` +
      'nested exception is org.springframework.core.convert.ConversionFailedException: Failed to convert from type ' +
      '[java.lang.String] to type [@io.swagger.v3.oas.annotations.Parameter @org.springframework.web.bind.annotation.RequestParam ' +
      `org.reactome.server.search.domain.Query$Scope] for value '${name}'; nested exception is ` +
      `java.lang.IllegalArgumentException: No enum constant org.reactome.server.search.domain.Query.Scope.${name}`,
  };
}

/** SolrCore.configureScope's filter for each scope; BOTH has none. */
const SCOPE_FILTER = {
  REFERENCE_ENTITY: 'hasReferenceEntity:false',
  PHYSICAL_ENTITY: '-isReferenceSummary:true',
};

/** The filters a query takes, in the order SolrCore adds them, with its tag and field. */
const QUERY_FILTERS = [
  ['species', '{!tag=sf}', 'species_facet', 'speciesFacet'],
  ['types', '{!tag=tf}', 'type_facet', 'typeFacet'],
  ['keywords', '{!tag=kf}', 'keywords_facet', 'keywordFacet'],
  ['compartments', '{!tag=cf}', 'compartment_facet', 'compartmentFacet'],
];

/**
 * What SolrCore.getFacetingInformation(Query) sends the /facet handler: the
 * scope's filter, one tagged filter for each list given, not deleted, the
 * query. getFilterString drops empty names from a list as it goes -- they
 * are dropped here too, so the caller sees the lists as Java's are after --
 * and a list with nothing left is a bare tag, as Java sends it.
 */
export function facetQueryParams(query) {
  const params = [];
  if (SCOPE_FILTER[query.scope]) params.push(['fq', SCOPE_FILTER[query.scope]]);
  for (const [list, tag, field] of QUERY_FILTERS) {
    const given = query[list];
    if (!given || given.length === 0) continue;
    const kept = given.filter((name) => name !== '' && name !== null);
    given.splice(0, given.length, ...kept);
    params.push(['fq', kept.length ? `${tag}${field}:("${kept.join('" OR "')}")` : tag]);
  }
  params.push(['fq', '-deleted'], ['q', query.query]);
  return params;
}

/** One FacetContainer, NON_EMPTY: a null or empty name is left out. */
function facetContainer(name, count) {
  return name === null || name === '' ? { count } : { name, count };
}

/**
 * SolrConverter.getFacetMap(response, query): each of the four facets split
 * into the names the query selected and the rest, as FacetList(selected,
 * available) -- a facet Solr did not count is left out, empty lists too.
 */
function facetMappingFor(answer, query) {
  const fields = answer?.facet_counts?.facet_fields ?? {};
  const mapping = { totalNumFount: answer?.response?.numFound ?? 0 };
  const selected = {};
  for (const [list, , field, key] of QUERY_FILTERS) {
    if (!(field in fields)) continue;
    const flat = fields[field] ?? [];
    const chosen = [];
    const available = [];
    for (let at = 0; at + 1 < flat.length; at += 2) {
      const container = facetContainer(flat[at], flat[at + 1]);
      (query[list]?.includes(flat[at]) ? chosen : available).push(container);
    }
    selected[list] = chosen.map((container) => container.name ?? null);
    mapping[key] = {
      ...(chosen.length ? { selected: chosen } : {}),
      ...(available.length ? { available } : {}),
    };
  }
  return { mapping, selected };
}

/**
 * SearchService.getFacetingInformation(query, forceFilters): the facets of
 * `query`; unless filters are forced, a list whose names were not all found
 * is cut to those that were, and Solr asked again -- so a filter that
 * selects nothing is no filter. A list with no facet to check is Java's
 * NullPointerException, a failure here too.
 */
async function facetsOf(query, forceFilters, signal) {
  const ask = async () =>
    facetMappingFor(await solr('/facet', facetQueryParams(query), { signal }), query);
  const first = await ask();
  if (forceFilters) return first.mapping;
  let correct = true;
  for (const [list] of QUERY_FILTERS) {
    if (!query[list]) continue;
    if (!(list in first.selected)) throw new Error(`no ${list} facet to check the filter against`);
    if (first.selected[list].length !== query[list].length) {
      correct = false;
      query[list] = first.selected[list];
    }
  }
  return correct ? first.mapping : (await ask()).mapping;
}

/** A FacetMapping endpoint's answer: the mapping, or Java's empty 200 for its null. */
function facetAnswer(answer) {
  const mapping = facetMapping(answer);
  return mapping === undefined
    ? { status: 200 }
    : { status: 200, type: 'application/json', body: mapping };
}

/**
 * SolrConverter.getSuggestions: the collations `handler` offers for `query`,
 * in order, less those /exists finds nothing for. One at a time, as Java
 * asks: Solr's heap is small and the list is a handful.
 */
export async function suggestionsFrom(handler, query, ask = solr, signal = undefined) {
  const offered = collations(await ask(handler, [['spellcheck.q', query]], { signal }));
  const kept = [];
  for (const collation of offered) {
    const exists = await ask('/exists', [['q', collation]], { signal });
    if ((exists?.response?.numFound ?? 0) > 0) kept.push(collation);
  }
  return kept;
}

/**
 * Java's error envelope for any status. Its `url` is the request's without the
 * query string, which is how Java writes it. Serialised here, as Jackson
 * writes it (javaJson): a message carrying a control character -- the id or
 * parameter as given -- is `\u001F` in Java's, and was `\u001f` in ours.
 */
export function javaError(request, code, reason, message) {
  const host = request.get?.('host') ?? 'localhost';
  const protocol = request.protocol ?? 'http';
  const url = String(request.originalUrl ?? '').split('?')[0];
  return {
    status: code,
    type: 'application/json',
    body: javaJson({
      code,
      reason,
      url: `${protocol}://${host}${url}`,
      messages: [message],
      targets: null,
    }),
  };
}

/**
 * The `species` parameter as graph-core's SpeciesService.getSpecies reads it:
 * nothing when absent or empty; digits as a taxId, then as a dbId; anything
 * else as a name -- lower-cased, runs of '_' and ' ' made one space, first
 * letter capitalised -- matched against a Species' names.
 */
export function speciesFilter(raw) {
  if (raw === undefined || raw === '') return { kind: 'none' };
  if (javaNumeric(raw)) return { kind: 'number', value: raw };
  const name = raw.toLowerCase().replace(/[_ ]+/g, ' ');
  return { kind: 'name', value: name.charAt(0).toUpperCase() + name.slice(1) };
}

/** The taxId of the species a filter names, or undefined: none, or not found. */
async function speciesTaxId(filter) {
  if (filter.kind === 'none') return undefined;
  if (filter.kind === 'number') {
    const [byTaxId] = await read(
      'MATCH (s:Species {taxId: $value}) RETURN s.taxId AS taxId LIMIT 1',
      filter
    );
    if (byTaxId) return byTaxId.taxId;
    const [byDbId] = await read(
      'MATCH (s:Species {dbId: toInteger($value)}) RETURN s.taxId AS taxId LIMIT 1',
      { value: asciiDigits(filter.value) }
    );
    return byDbId?.taxId ?? undefined;
  }
  const [byName] = await read(
    'MATCH (s:Species) WHERE $value IN s.name RETURN s.taxId AS taxId LIMIT 1',
    filter
  );
  return byName?.taxId ?? undefined;
}

/**
 * The files /health's build fingerprint hashes: the service's modules and the
 * data it answers with (schema-snapshot.json), sorted by name. Specs excluded.
 * They ship in the image -- the Dockerfile copies the directory -- but they are
 * not what the service does, and a fingerprint that changes when a test is
 * edited reports a deployment difference that is not one. Caught by this very
 * endpoint: adding service.spec.mjs moved the hash without changing a line the
 * service runs.
 */
export function fingerprintFiles(names) {
  return names.filter((name) => /\.(mjs|json)$/.test(name) && !name.endsWith('.spec.mjs')).sort();
}

/**
 * A fingerprint of the code this process is actually running.
 *
 * The image bakes these modules in, so `docker compose build` is a separate act
 * from merging and nothing connected the two: a fix could be merged and not
 * deployed, or a container could be quietly ahead of main, and the only way to
 * tell was to read the source on disk -- which is the CLI's copy, not the
 * container's, and therefore always agrees with you.
 *
 * A content hash rather than a git sha, because a sha has to be passed in at
 * build time and anything that has to be remembered eventually is not. Compare
 * it against a checkout with
 * `LC_ALL=C ls tools/content-node/*.mjs tools/content-node/*.json | grep -v spec | xargs cat | sha256sum`,
 * taking the files sorted by name, as here. The JSON is schema-snapshot.json:
 * data the service answers with, so a regenerated snapshot is a different build.
 */
function buildId() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const names = fingerprintFiles(readdirSync(here));
    const hash = createHash('sha256');
    for (const name of names) hash.update(readFileSync(path.join(here, name)));
    return { build: hash.digest('hex').slice(0, 12), modules: names.length };
  } catch {
    // Never fail a health check over its own metadata.
    return { build: 'unknown', modules: 0 };
  }
}

/**
 * A handler's answer on the wire. Objects go out as JSON written as Jackson
 * writes it (javaJson, not res.json's JSON.stringify); strings as they are, so
 * a text/plain endpoint is not quoted into JSON; a cached endpoint's body as it
 * was serialised once; and no body at all as nothing -- as Java sends when a
 * controller returns null, where send('') would add a text/html content type
 * Java does not.
 */
export function writeResult(response, result) {
  response.status(result.status);
  if (result.type) response.type(result.type);
  for (const [name, value] of Object.entries(result.headers ?? {})) response.setHeader(name, value);
  const body = result.body !== undefined || Boolean(result.serialised);
  const redirect = result.status >= 300 && result.status < 400;
  if (body && !redirect && response.req && downloadGuard(response.req))
    response.setHeader('Content-Disposition', 'inline;filename=f.txt');
  if (result.body === undefined && !result.serialised) response.end();
  else if (typeof result.body === 'string') response.send(result.body);
  // A figure's bytes, under the type the handler set.
  else if (Buffer.isBuffer(result.body)) response.end(result.body);
  else if (result.serialised) response.type('application/json').send(result.serialised);
  else response.type('application/json').send(javaJson(result.body));
}

/**
 * A POST's body, as the bytes that came: not inflated (Tomcat does not
 * inflate a request), and not refused for its type, which the handler checks
 * as Spring does. Past 10MB the rest is read and dropped and the handler
 * answers 413, where Java would read on; no client sends that many ids.
 */
function readBody(request, _response, next) {
  const chunks = [];
  let size = 0;
  request.on('data', (chunk) => {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) request.tooLarge = true;
    else chunks.push(chunk);
  });
  request.on('end', () => {
    request.body = Buffer.concat(chunks);
    next();
  });
  request.on('error', next);
}

export function app() {
  const server = express();
  server.disable('x-powered-by');

  // Readable from any origin, as Java's ContentService is: pages on other sites
  // read it -- the embeddable diagram (spec 009) asks for the species list from
  // a partner's page. The ported endpoints matched Java's bodies byte for byte
  // and still broke that, by leaving this header out. On every answer, errors
  // included, so a page elsewhere can read that a request failed; and a
  // preflight is answered the way Java answers it.
  server.use('/ContentService', (request, response, next) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (request.method !== 'OPTIONS') return next();
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Max-Age', '1');
    response.sendStatus(200);
  });

  // Before any route, as Tomcat and Spring look at a path before any
  // controller does. A slash or backslash encoded, or a raw backslash, is Tomcat's 400 -- its page
  // names the server and its version, which this does not copy -- and a
  // doubled slash matches no mapping, which is Spring's own 404.
  server.use('/ContentService', (request, response, next) => {
    const path = String(request.originalUrl ?? '').split('?')[0];
    if (/%2f|%5c|\\/i.test(path))
      return response
        .status(400)
        .type('text/html')
        .send(
          '<!doctype html><html lang="en"><head><title>HTTP Status 400 – Bad Request</title></head><body><h1>HTTP Status 400 – Bad Request</h1></body></html>'
        );
    if (path.includes('//')) return writeResult(response, springNotFound(request));
    // Spring reads matrix parameters out of every segment, not only an id's:
    // /data/query;x/R-HSA-70486/stId is /data/query/R-HSA-70486/stId to Java.
    // Routing here sees the path without them; handlers still read the id
    // from the path as it came (rawSegment). A segment that was only one is
    // no segment, which matches no mapping: Spring's 404.
    const [relative, query] = String(request.url).split(/\?(.*)/s);
    const segments = relative.split('/');
    const stripped = segments.map((segment) => segment.split(';')[0]);
    if (stripped.some((segment, at) => segment === '' && segments[at].includes(';')))
      return writeResult(response, springNotFound(request));
    request.url = stripped.join('/') + (query === undefined ? '' : `?${query}`);
    next();
  });

  server.get('/health', async (_request, response) => {
    // The release this process is holding, which is the one thing here that can
    // be wrong without anything looking wrong. Caches live for the life of the
    // process by agreement -- updating the database includes restarting this --
    // and a missed restart shows up as diagram, figure and icon URLs pointing at
    // the previous release's bucket prefix, silently. Reporting it makes that
    // one curl away from obvious.
    //
    // Read through the same cache the endpoint uses, so this reports what is
    // being *served* rather than what the graph currently says. A health check
    // that went straight to the database would answer correctly while every
    // other response was stale, which is the opposite of useful.
    let release = null;
    try {
      const version = endpoints.find((e) => e.path.endsWith('/data/database/version'));
      const answer = await version?.handler({ params: {}, query: {} });
      release = answer?.body ?? null;
    } catch {
      // A health check that fails because the graph is down is reporting the
      // wrong thing: the process is up, and that is what this answers.
    }
    response.json({
      ok: true,
      ...buildId(),
      graph: configured(),
      solr: solrConfigured(),
      release,
      endpoints: endpoints.map((e) => e.path),
    });
  });

  for (const endpoint of endpoints) {
    // The table stores the Java path with {id}; express wants :id. Keeping one
    // string means the diff harness and proxy.conf.js can address an endpoint by
    // exactly what the Java service calls it.
    const route = endpoint.path.replace(/\{(\w+)\}/g, ':$1');
    // A POST's body arrives as bytes; its handler decodes them as Java would.
    const body = endpoint.method === 'post' ? [readBody] : [];
    server[endpoint.method ?? 'get'](route, ...body, (request, response) =>
      answerWith(endpoint, request, response)
    );
  }

  // Any other method on these paths is Java's 405: nginx sends every method
  // here, and Express's own answer was an HTML 404. After every route, so a
  // path two templates match is answered by the one that takes the method.
  for (const endpoint of endpoints) {
    server.all(endpoint.path.replace(/\{(\w+)\}/g, ':$1'), (request, response) =>
      writeResult(
        response,
        javaError(
          request,
          405,
          'METHOD_NOT_ALLOWED',
          `Request method '${request.method}' not supported`
        )
      )
    );
  }

  // Express decodes route parameters before any handler runs, and a segment
  // that is not valid UTF-8 (%FF) made it answer its own HTML 400 -- a stack
  // trace, NODE_ENV being unset -- where Java decodes it to U+FFFD and answers
  // as usual. Handlers read the raw path (rawSegment), so the endpoint is run
  // regardless.
  server.use((failure, request, response, next) => {
    if (!(failure instanceof URIError) || response.headersSent) return next(failure);
    // The path as routing saw it -- matrix parameters already stripped from
    // every segment -- less a trailing slash, which Express ignores too.
    const path = String(request.url)
      .split('?')[0]
      .replace(/(.)\/$/, '$1');
    const endpoint = endpointFor(path);
    if (!endpoint) return next(failure);
    // HEAD is answered as GET, as Express answers it; any other method the
    // template does not take is Java's 405, as for a decodable id.
    const method = request.method === 'HEAD' ? 'get' : request.method.toLowerCase();
    if ((endpoint.method ?? 'get') !== method)
      return writeResult(
        response,
        javaError(
          request,
          405,
          'METHOD_NOT_ALLOWED',
          `Request method '${request.method}' not supported`
        )
      );
    const body = endpoint.method === 'post' ? readBody : (_request, _response, done) => done();
    body(request, response, () => answerWith(endpoint, request, response));
  });

  // Anything else that reaches here is this service's failure: Java's
  // envelope, never Express's page with a stack trace in it.
  server.use((failure, request, response, _next) => {
    console.error(`${request.path}: ${failure?.message}`);
    writeResult(response, unexpected(request));
  });

  return server;
}

/**
 * How many deep queries (an endpoint marked `deep`) may run at once. The
 * graph pool is 32 so that a few slow requests cannot hold every connection;
 * these routes can each run for the full read timeout and cost the database
 * the most, so they keep a smaller share. One past it is a 503 at once rather
 * than a wait, as the render service answers a full queue.
 */
export function deepShare(max) {
  let running = 0;
  return {
    enter: () => (running < max ? ((running += 1), true) : false),
    leave: () => {
      running = Math.max(0, running - 1);
    },
  };
}

/** DEEP_QUERY_LIMIT when it is a whole number from 1 to 32 (the pool's default); otherwise 4. */
export function deepLimit(setting) {
  const limit = Number(setting);
  return Number.isInteger(limit) && limit >= 1 && limit <= 32 ? limit : 4;
}

const DEEP = deepShare(deepLimit(process.env.DEEP_QUERY_LIMIT));

/**
 * One endpoint's answer to one request: its handler's result, or what a
 * failure means in Java's terms, never a stack trace.
 */
async function answerWith(endpoint, request, response) {
  if (endpoint.deep) {
    if (!DEEP.enter())
      return writeResult(response, {
        ...javaError(request, 503, 'SERVICE_UNAVAILABLE', 'The service is busy; try again shortly'),
        headers: { 'Retry-After': '5' },
      });
    try {
      return await answer(endpoint, request, response);
    } finally {
      DEEP.leave();
    }
  }
  return answer(endpoint, request, response);
}

async function answer(endpoint, request, response) {
  // An id that is only a matrix parameter is no id to Spring: no mapping
  // matches, and it answers its own 404.
  const idAt = endpoint.path.split('/').indexOf('{id}');
  if (idAt > -1 && pathId(rawSegment(request, idAt)) === '')
    return writeResult(response, springNotFound(request));
  try {
    writeResult(response, await endpoint.handler(request));
  } catch (failure) {
    const answer = failureAnswer(request, endpoint.path, failure);
    if (answer) return writeResult(response, answer);
    // The message, not a stack: this stands in for a service whose errors
    // reach real clients.
    console.error(`${endpoint.path}: ${failure.message}`);
    writeResult(response, { status: 500, type: 'text/plain', body: 'content service error' });
  }
}

// Started directly rather than imported by a test.
if (process.argv[1] && process.argv[1].endsWith('service.mjs')) {
  const server = app().listen(PORT, HOST, () => {
    console.log(`content-node listening on http://${HOST}:${PORT}`);
    // Warm the cached endpoints the way Java's @PostConstruct does, so the
    // first reader does not pay the four seconds. Failures are left to the
    // request path, which retries: warming must not be the thing that decides
    // whether the service can answer.
    for (const endpoint of endpoints) {
      if (!endpoint.handler.warms) continue;
      endpoint
        .handler({ params: {} })
        .catch((error) => console.error(`warming ${endpoint.path}: ${error.message}`));
    }
    console.log(
      `  graph credentials: ${configured() ? 'present' : 'MISSING (set NEO4J_USER/PASSWORD)'}`
    );
    console.log(
      `  solr: ${solrConfigured() ? 'configured' : 'MISSING (set SOLR_URL/USER/PASSWORD)'}`
    );
    console.log(`  endpoints: ${endpoints.length}`);
  });
  const stop = async () => {
    server.close();
    await close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
