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
      const taxId = String(request.params.id);
      const rows = await read(
        `MATCH (p:TopLevelPathway)-[:species]->(s:Species)
         WHERE s.taxId = $taxId
         RETURN properties(p) AS pathway, properties(s) AS species
         // toLower, as /content/toc already does. Neo4j orders by code point,
         // so uppercase sorts before lowercase and "DNA Repair" landed before
         // "Developmental Biology"; Java's collation is case-insensitive.
         ORDER BY toLower(p.displayName)`,
        { taxId }
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

      const body = rows.map(({ pathway, species }) => ({
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
          'speciesName',
          'doi',
          'releaseStatus',
        ]),
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
        species: [seenSpecies.has(species.dbId) ? species.dbId : full(species)],
        ...only(pathway, ['hasDiagram', 'hasEHLD', 'lastUpdatedDate']),
        schemaClass: pathway.schemaClass,
        className: pathway.schemaClass,
      }));
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
        const id = String(request.params.id);
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
      differs: [/: java normalised by the endpoint's own rule before comparing$/],
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
      const given = request.query?.species;
      const species = given === undefined ? undefined : [given].flat().join(',');
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
];

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
    answer.serialised ??=
      typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body);
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
  try {
    return decodeURIComponent(kept);
  } catch {
    return kept;
  }
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
 * loopback it is the loopback address, which is what Java would say too.
 */
function notFound(request, message) {
  const host = request.get?.('host') ?? 'localhost';
  const protocol = request.protocol ?? 'http';
  return {
    status: 404,
    type: 'application/json',
    body: {
      code: 404,
      reason: 'NOT_FOUND',
      url: `${protocol}://${host}${request.originalUrl ?? ''}`,
      messages: [message],
      targets: null,
    },
  };
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
 * the first value, trimmed as String.trim trims; empty is absent; true, on, yes
 * and 1 or false, off, no and 0 in any case; anything else Java's 400, naming
 * the value as it was sent.
 */
export function springBoolean(values) {
  const [raw] = values;
  if (raw === undefined) return { value: undefined };
  const value = javaTrim(raw).toLowerCase();
  if (value === '') return { value: undefined };
  if (['true', 'on', 'yes', '1'].includes(value)) return { value: true };
  if (['false', 'off', 'no', '0'].includes(value)) return { value: false };
  return {
    error:
      "Failed to convert value of type 'java.lang.String' to required type 'java.lang.Boolean'; " +
      `nested exception is java.lang.IllegalArgumentException: Invalid boolean value [${raw}]`,
  };
}

/** The values of one query parameter as the servlet reads them, in order. */
function queryValues(request, name) {
  const query = String(request.originalUrl ?? '').split('?')[1] ?? '';
  try {
    return new URLSearchParams(query).getAll(name);
  } catch {
    return [];
  }
}

/**
 * Java's error envelope for any status. Its `url` is the request's without the
 * query string, which is how Java writes it.
 */
function javaError(request, code, reason, message) {
  const host = request.get?.('host') ?? 'localhost';
  const protocol = request.protocol ?? 'http';
  const url = String(request.originalUrl ?? '').split('?')[0];
  return {
    status: code,
    type: 'application/json',
    body: { code, reason, url: `${protocol}://${host}${url}`, messages: [message], targets: null },
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
 * it against a checkout with `ls tools/content-node/*.mjs | grep -v spec | xargs cat | sha256sum`, taking
 * the files sorted by name as readdir gives them here.
 */
function buildId() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const names = readdirSync(here)
      // Specs excluded. They ship in the image -- the Dockerfile copies the
      // directory -- but they are not what the service does, and a fingerprint
      // that changes when a test is edited reports a deployment difference that
      // is not one. Caught by this very endpoint: adding service.spec.mjs moved
      // the hash without changing a line the service runs.
      .filter((name) => name.endsWith('.mjs') && !name.endsWith('.spec.mjs'))
      .sort();
    const hash = createHash('sha256');
    for (const name of names) hash.update(readFileSync(path.join(here, name)));
    return { build: hash.digest('hex').slice(0, 12), modules: names.length };
  } catch {
    // Never fail a health check over its own metadata.
    return { build: 'unknown', modules: 0 };
  }
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
      release,
      endpoints: endpoints.map((e) => e.path),
    });
  });

  for (const endpoint of endpoints) {
    // The table stores the Java path with {id}; express wants :id. Keeping one
    // string means the diff harness and proxy.conf.js can address an endpoint by
    // exactly what the Java service calls it.
    server.get(endpoint.path.replace(/\{(\w+)\}/g, ':$1'), async (request, response) => {
      try {
        const result = await endpoint.handler(request);
        response.status(result.status);
        if (result.type) response.type(result.type);
        // Objects go out as JSON; strings as they are, so a text/plain endpoint
        // is not quoted into JSON.
        // No body at all, as Java sends when a controller returns null: not
        // send(''), which would add a text/html content type Java does not.
        if (result.body === undefined && !result.serialised) response.end();
        else if (typeof result.body === 'string') response.send(result.body);
        // A cached endpoint carries its own serialised body; anything else is
        // small enough that stringifying per request costs nothing.
        else if (result.serialised) response.type('application/json').send(result.serialised);
        else response.json(result.body);
      } catch (failure) {
        // The message, not a stack: this stands in for a service whose errors
        // reach real clients.
        console.error(`${endpoint.path}: ${failure.message}`);
        response.status(500).type('text/plain').send('content service error');
      }
    });
  }

  return server;
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
