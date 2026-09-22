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
import { fileURLToPath } from 'node:url';
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
    handler: cached(
      'database/version',
      async () => {
        const [row] = await read('MATCH (n:DBInfo) RETURN n.releaseNumber AS version LIMIT 1');
        if (!row) return { status: 404, body: 'no DBInfo node' };
        return { status: 200, body: String(row.version), type: 'text/plain;charset=UTF-8' };
      },
      // A minute of staleness after a release, instead of forever.
      { ttlMs: 60_000 }
    ),
  },
  {
    path: '/ContentService/data/database/name',
    handler: cached(
      'database/name',
      async () => {
        const [row] = await read('MATCH (n:DBInfo) RETURN n.name AS name LIMIT 1');
        if (!row) return { status: 404, body: 'no DBInfo node' };
        return { status: 200, body: String(row.name), type: 'text/plain;charset=UTF-8' };
      },
      { ttlMs: 60_000 }
    ),
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
];

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
 * `ttlMs` bounds how stale an answer may be. Without one the value is held for
 * the life of the process, which was justified here as "a release restarts the
 * service, and these lists only change with the graph". That is true of Java,
 * whose WAR is redeployed, and **not** of this: it runs as a container with
 * `restart: unless-stopped`, and nothing in the release procedure or in any
 * script on the host restarts it. Checked rather than assumed, after caching
 * something where being stale is worse than being slow.
 *
 * So a value that decides what the site asks for elsewhere takes a TTL. The
 * release number is the case in point -- it keys the bucket paths for diagrams,
 * figures and icons, so serving last release's number sends every one of those
 * requests to the wrong prefix, and it would keep doing so until somebody
 * noticed and restarted a container.
 *
 * The lists keep the unbounded form. They are large to rebuild, they are only
 * read by pages that render them, and a stale entry there is a missing person
 * or a missing DOI until the next deploy rather than a wrong URL everywhere.
 * That is a judgement about consequence, not about likelihood, and it is
 * written down here so the next person can disagree with it knowingly.
 */
function cached(name, build, { ttlMs = Infinity } = {}) {
  let ready;
  let builtAt = 0;
  const handler = async (request) => {
    if (ready && Date.now() - builtAt > ttlMs) ready = undefined;
    if (!ready) {
      builtAt = Date.now();
      ready = build(request).catch((error) => {
        ready = undefined;
        throw error;
      });
    }
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
  // Readable by the spec: a cache that may never expire is a decision, and one
  // that can be asserted is a decision that stays made.
  handler.ttlMs = ttlMs;
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

  server.get('/health', (_request, response) => {
    response.json({
      ok: true,
      ...buildId(),
      graph: configured(),
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
        if (typeof result.body === 'string') response.send(result.body);
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
