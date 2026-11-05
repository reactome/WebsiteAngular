# Decisions behind moving ContentService to node in this repository

Each entry: what was decided, why, what was measured, and what was rejected.

The position was reached on 21 Aug 2026 and revisited on 18 Sep after two
concrete cases where behaviour that should have been ours was not. This records
it so the argument is not had a third time.

---

## D1. ContentService moves to node/TypeScript in this repository

**Decision**: port it, keeping paths and response shapes byte-identical. Java
stays for three exporter implementations and for anything that proves
impractical, reached by proxy.

**Why**: it is overwhelmingly a UI-serving API, and the models it returns are
hand-mirrored in TypeScript on our side today. Drift between the two does not
fail loudly — it renders a plausible page with something missing, which is how
the blank-diagram bug reached beta. One system means one set of types.

**Measured** (18 Sep 2026, from the service's own `/v3/api-docs`, so it can be
re-run rather than believed):

    98 operations across 98 paths
      /data          55
      /interactors   17
      /search        15
      /exporter       7
      /references     3
      /contact        1

The Aug analysis found the UI calls 49 of the 98 — `/data` 31 of 55, `/search`
10 of 15, `/interactors` 3 of 17, exporters 7 of 7. That half is the working
surface; the rest still has to be carried, see D3.

**Rejected**: leaving it in Java and asking for changes. That is what we do now,
and D2 is what it costs.

## D2. The case is no longer theoretical

Two things on 18 Sep could not be fixed from here, and both are ours in every
sense except where the code lives:

- **`/search/suggest` returns a flat array of bare strings with no type.** So
  `tello-ruiz` is indistinguishable from `il6r`, and a click can blend a curator
  with a gene. That produced a confidently wrong answer about "Tello-Ruiz, IL6,
  Beta-1". The type exists in `/search/query` (`typeName: "Person"`) and not in
  `suggest`. Fixing it properly means changing a service we do not own.
- **The hCaptcha secret lives on Tomcat**, because `/contact` verifies there. A
  human gate for the search answer therefore could not be tested at all from
  this repository, shipped switched off, and was eventually rebuilt on
  Cloudflare Turnstile — which was the better choice, but it was forced.

Both are the same shape: a behaviour the website needs, in a service the website
cannot change.

## D3. Parity first, cleanup second, and nothing is dropped

**Decision**: every one of the 98 operations keeps its path and its response
shape, byte for byte, including the 49 the UI does not call. Improvements to
shapes come after parity and are announced separately.

**Why**: the old site, FIViz, ReactomeGSA and curators' own scripts call this.
An endpoint we do not use is not an endpoint nobody uses, and we have no
inventory of who calls what.

**Rejected**: porting only what the UI needs. It halves the work and breaks
consumers we cannot enumerate, which we would find out from a complaint rather
than a test.

## D4. The diff harness is the safety net, and it already works

**Decision**: for each endpoint, and a corpus of stable identifiers, call node
and Java and assert deep equality of the parsed JSON. It runs in the release
suite while the migration is in flight.

**Measured**: `tools/content-node/diff.mjs` on branch `content-node-spike`
earned its place on the **first** endpoint by catching that the property is
`releaseNumber`, not `version`. A reviewer reading the two implementations would
not reliably have seen that.

Comparing parsed JSON rather than bytes is deliberate: key order and whitespace
are not contracts, and asserting on them produces failures nobody acts on.

**Rejected**: porting endpoint by endpoint with tests written from the
documentation. The documentation is not the behaviour; the running service is.

## D5. Cut over per endpoint, behind a route switch

**Decision**: node fronts everything and proxies to Java by default. Each ported
endpoint is switched to the node implementation by configuration, so rollback is
a setting rather than a deploy.

**Why**: a migration that cannot be reversed per endpoint is a migration that
gets reverted wholesale at the first surprise.

## D6. Start with `/search/*`, not with `/data/query/enhanced/v2`

**Decision**: the first slice is `/search/*` (15 operations, 10 used by the UI),
followed by `/contact` (1).

**Why this changed.** The Aug plan named `enhanced/v2` first, because nested
aggregated views are where a subtle shape difference would render a
plausible-but-wrong page — that was the right order for discovering whether the
port was feasible at all. The spike has since answered that: three endpoints are
byte-identical and the harness works.

With feasibility established, the first slice should be chosen for value and low
risk instead:

- `/search/*` is **Solr, not Neo4j**. None of the graph-shape risk applies.
- It is self-contained: no traversal, no model reflection.
- It is where both of D2's problems live. Owning it means typing `suggest`
  ourselves rather than asking.

`/contact` is one operation and is where the captcha secret sits. Small, and it
removes the reason a human gate could not be tested here.

**Rejected**: starting with `/data`. It is 55 operations and the highest-risk
shapes; starting there means the longest possible time before anything improves.

## D7. AnalysisService is not a candidate for porting the compute

**Decision**: node goes in front of it. The maths stays in Java.

**Why**: the UI calls 6 of its 39 paths, so the shared-types payoff is nearly
nil, while the risks are concrete — p-values and Benjamini-Hochberg FDR must
match to the digit or published results change; the work is CPU-bound in a
single-threaded runtime; tokens are stateful with TTLs that curators paste into
papers; and the pathway space is held as an in-memory compact binary.

Fronting it still pays: one deploy, one place for rate limits and logging, and
Java on loopback. If any of it ever moves, the formatting endpoints go first,
behind a harness diffing p-values on real submissions.

GSA is R-based and not a candidate at all.

## D8. Superseded: ported endpoints ship as they are ready

**Originally**: none of this starts until the curator round on beta is finished,
because a service migration doubles the risk surface inside exactly the window
where a regression would look to a curator like a regression in the site they
are reviewing, with no way for them to tell the difference.

**Now**: endpoints are ported, proven against Java by the harness, and routed as
they are ready. Decided 20 Sep 2026.

**What changed, in order of how much it matters:**

- **A node outage degrades to Java rather than failing.** The `content_node`
  upstream lists Tomcat as a `backup`, and the paths are identical on both, so
  if the node container is down, stopped for a rebuild, or still warming its
  caches, nginx retries Java and the reader gets an answer. Tested by stopping
  the container against the live site: 200 either way, and the only difference
  in the response is the subpathway DOIs Java drops. That removes most of what
  D8 was protecting against -- the failure mode it feared was a curator meeting
  a broken page and reporting it as a website fault.

  **Reversed 10 Oct 2026: no fallback.** A path routed to node is answered by
  node or fails visibly. Falling back hid which backend had answered, and these
  routes are how Java's ContentService is retired: an endpoint is done when node
  serves it alone, and Tomcat is switched off once every endpoint is. The
  `backup` server is gone from every `content_node` upstream, and so is the
  retry rule that only it used (#390).

- **The curator round is no longer a single gate.** The blocking issues are
  fixed; what comes back now is smaller and rarer, and fixing it and rolling it
  out as we go is a better fit than batching behind a freeze.
- **Each route is one line, and reversible in one line.** D5's per-endpoint
  switch turned out to be the thing that made this safe: `/content/toc` and
  `/content/doi` went live without touching anything else, and
  `/content/contributors` kept being served by Java throughout.

**What has not changed**: parity is still proven before a route is added (D4),
improvements are still declared rather than smuggled in (D11), and the exporters
and the analysis maths are still not candidates (D1, D7).

**Kept rather than deleted** because the argument was sound when it was made and
the conditions changed underneath it. A superseded decision with its reasoning
intact is how the next person tells "we thought about this" from "nobody
considered it".

---

## D9. An endpoint Java caches must be ported with its caching

**Decision**: before porting an endpoint, find out whether the Java service
precomputes it. If it does, the node version builds the same thing at startup,
warms it, and serves from memory.

**Why**: a port without it is a regression that no functional diff can see.
Every byte of every response is identical; it is merely a thousand times slower,
and the harness in D4 compares content rather than time.

**Measured** on `/content/toc` and `/content/doi`, mean of twenty requests on a
250kB payload:

    naive port, querying per request     4,500ms / 5,600ms
    java                                     3ms /     6ms
    with the same startup cache               5ms
    with the body serialised once too       3.8ms  (java 4.1ms)

Java is not faster. `ContentPageManager` has a `@PostConstruct` that runs both
queries once and keeps the lists in memory. Both gaps were ours: no cache, then
re-serialising an unchanged 250kB body on every request. For this kind of work
-- read the graph, shape JSON, serve it -- node matches the WAR once it is doing
the same thing. **Speed is not a reason to port, and slowness is not a reason
not to.**

**Rejected**: trusting that a runtime comparison is a language comparison. The
first numbers said node was a thousand times slower and they were about our
code, not about node.

## D10. One deliberate difference from Java's caching: a failed build is not kept

**Decision**: cache the built list, but not a failure. The next request rebuilds.

**Why**: Java's `init()` catches `Exception`, logs it, and leaves the list
**empty**. A database that is slow or unreachable at startup therefore leaves
the contents page blank until somebody redeploys -- a transient fault made
permanent, and nobody connects an empty page to a restart hours earlier. A slow
start should cost one slow request.

## D11. Parity means matching the behaviour, not the bugs -- and saying which is which

**Decision**: a ported endpoint may differ from Java deliberately, and each
difference is declared on the endpoint as `differs`. The harness reports a
declared difference as intended, and reports its **disappearance** as news.

**Why**: two bad options otherwise. Byte-for-byte parity means porting the bug
and losing the reason to have ported at all; an undeclared improvement means the
diff is permanently red and stops being read.

**Measured**: `/content/toc` carries one declared difference and is otherwise
identical; `/content/doi` is identical outright.

## D12. What the first two endpoints found, which is the argument for the rest

Three defects, none visible from the TypeScript side:

- **`ContentPageManager:91` discards every subpathway's DOI.**
  `new TocSubpathway(stId, displayName, null, speciesName)` -- the third
  argument is the DOI, hardcoded `null`, and Jackson drops nulls. The query
  already returns each child as a full `Pathway` node. Production's own contents
  page carries 44 DOIs of which **41 are subpathways**, so all but three were
  missing on beta, with nothing logged. It forced a client-side join against
  `/content/doi` -- a 796kB request -- which the port makes unnecessary.
- **The TOC query can drop a whole pathway.** It ends `UNWIND allAuthors AS
totalAtrs` with no guard, and `UNWIND []` yields no rows, so a top-level
  pathway with no authors anywhere in its subtree would vanish from the contents
  page silently. The sibling DOI query guards exactly that with
  `CASE allAuthors WHEN [] THEN [null]`. Measured: 34 pathways, 34 returned, 0
  without authors -- a trap waiting for the first pathway curated without one.
- **Nobody reads the curated order.** `hasEvent` carries an `order` property --
  for Autophagy: Macroautophagy 0, Chaperone Mediated Autophagy 1, Late endosomal
  microautophagy 2 -- and both implementations emit children in internal node id
  order instead. The contents page has never shown children in the sequence a
  curator chose. Left alone on purpose, per D3.

And three shape details the harness caught that reading would not have: the DOI
query reads `authored|revised` for a pathway but `authored` alone for its
descendants while the contents query reads both at both levels;
`spring.jackson.default-property-inclusion=non_empty` omits an empty array
rather than sending `[]`; and children arrive in internal id order.

**Why this is recorded here**: the case for the port in D1 was that hand-mirrored
types drift silently. These are the same fault a layer down -- a mapping that
discards a field, a query that can drop a row -- and neither is visible from the
consuming side at all.

## D13. Host networking is temporary, and named as such

**Decision**: the content-node container shares the host's network namespace
today, and stops doing so when the graph database becomes a container.

**Why now**: Neo4j binds to `127.0.0.1:7687`. A bridged container cannot reach
it, and the usual fix -- binding Neo4j to the docker bridge -- widens who can
reach the database in order to fit a container in. Sharing the namespace changes
nothing about the database's reachability.

**Why it ends**: the plan is a Neo4j image built per release. Once the graph is
a container, this one joins the compose network, `NEO4J_URI` names that service
rather than loopback, and the port is published on 127.0.0.1 the way `render`
does. `graph.mjs` already takes `NEO4J_URI` from the environment, so the switch
is configuration.

**Recorded because it will look arbitrary later.** `network_mode: host` in a
compose file is the kind of line someone deletes to tidy up, discovers the
service can still reach the database in their environment, and leaves deleted --
until it reaches one where it cannot.

## D14. Three ways a containerised service can be up and useless

Found while containerising, each of which left the service running and every
request answering 500:

- **compose's `env_file` parser ate the password.** `NEO4J_DATABASE=graph.db`
  came through; `NEO4J_PASSWORD` arrived empty. That is the same fault
  `graph.mjs` carries a comment about -- a generated secret contains characters
  a parser treats as syntax -- reintroduced by the layer underneath it. The file
  is now **mounted, not parsed**.
- **The container ran as the image's `node` user, uid 1000**, and the
  credentials file is `0600` owned by the operator. Readable by nobody in the
  container. It now runs as that owner rather than the file being loosened.
- **Neo4j unreachable at startup** is not fatal: the warm-up fails, logs, and the
  first request rebuilds (D10).

**Why this is worth a decision rather than a comment**: all three produced a
container reporting `Up`, a `/health` that answered, and a service that could
not do its job. "Up and useless" is the state monitoring notices least, which is
why `/health` reports `graph: true|false` rather than just `ok`.

## D15. An unordered array is declared by sorting, not by a wildcard

`/content/contributors` matches Java exactly, 999 entries, every field, with one
exception: the order of the array. Java's order is not by name, dbId, any of the
four counts, their total, or a Java `HashMap`'s iteration order over the dbIds --
all five checked against the live response, none matched. It is whatever the
aggregation happened to emit.

Nothing reads it. `contributors.component.ts` sorts by `displayName` before
rendering, so the order this endpoint returns is never the order anyone sees.

**The first attempt was wrong in an instructive way.** Declaring the difference
the obvious way -- a `differs` pattern matching `[47].reviewedReactions: ...` --
made the endpoint report green. It also would have reported green for a wrong
count, a wrong name, or a missing person, because every per-element difference
matches that shape. The declaration mechanism of D11 is for differences we
_chose_; a pattern broad enough to cover an arbitrary reordering covers
everything else too, and the safety net stops being one.

**What it does instead**: the endpoint gives the diff harness an `unordered` key
(`entry.person.dbId`). Both sides are sorted by it before comparing, and the
fact that the orders differ is reported as one declared problem. All 999 entries
are still compared field by field. Proved rather than asserted: with one
`reviewedReactions` changed from 2104 to 2105, the diff reports
`[47].reviewedReactions: 2105, java says 2104` and fails.

**A second hole, found on the way.** `compare()` stopped after twelve
differences to avoid printing a novel. `/content/toc` declares 107 intended
differences -- one per subpathway DOI Java drops -- so comparison stopped at the
thirteenth and **everything past it was never compared at all**. A real
difference at the five hundredth pathway could not have been reported. The
ceiling is now 2000 and only the first twelve _undeclared_ differences are
printed. Declared differences must not be able to crowd out undeclared ones.

## D16. Porting an endpoint is how the types get audited

The port's stated value was speed and control. The recurring value is turning
out to be that reimplementing an endpoint forces someone to look at what it
actually returns.

`SimplePerson` in `content-data.service.ts` declared `surname: string;
firstname: string; orcidId: string | null`. Measured across all 9,503 person
entries the three content endpoints return: `firstname` is absent on 619 and
`orcidId` on 3,961, and **neither is ever null** -- the service sets
`spring.jackson.default-property-inclusion=non_empty`, so an empty value is
omitted rather than sent as null.

Three call sites had already worked around it independently, writing
`p.firstname?.toLowerCase()` where the type said `string` -- `?.` on a required
field is dead syntax that says the author trusted the data over the declaration.
The type is now honest and those guards are load-bearing. Nothing was broken by
the old declaration, which is the point: it was wrong for as long as it took
somebody to reimplement the endpoint and look.

## D17. Jackson writes a repeated object once, then refers back to it

`/data/pathways/top/9606` returns 29 pathways that share one Species. Java
serialises that Species in full on the **first** item and emits only its dbId on
the other 28:

    item[0].species[0]  {"dbId":48887,"displayName":"Homo sapiens",...}
    item[1].species[0]  48887

That is the default; the service-wide `includeRef` parameter changes the _form_
of the back-reference to JSOG `{@ref}`, not whether there is one. Node was
emitting the object 29 times, so a caller written against Java would read
`species[0]` as a number on every item but the first.

**Any ported endpoint returning the same object more than once has to do this.**
It is a property of the serialiser rather than of any endpoint, so it will not
appear in a controller's source and does not show up until two responses are
compared field by field.

## D18. Java's collation is case-insensitive and Neo4j's is not

`ORDER BY p.displayName` sorts by code point, so `DNA Repair` came before
`Developmental Biology`. Java's does not. `toLower()` in the ORDER BY, which
`/content/toc` already had and `/data/pathways/top/{id}` did not — the same
mistake twice, once caught and once not, because only one of them was ever
compared.

## D19. A declared difference states the rule, not its symptoms

`/data/person/{id}/authoredReactions` returns an event once per authorship edit;
this returns it once. Declaring that with a `differs` pattern would have meant
swallowing the _consequences_: dropping one row from a 3,310-element list shifts
every row after it, so the comparison reports two thousand differences for one
intended change — and a pattern wide enough to cover them hides a genuinely
wrong row just as well.

So an endpoint may give the harness `normalise`, a function applied to **Java's**
answer before comparing, after which the comparison is exact. The rule is in the
code beside the endpoint and the harness says it applied it.

This is the second time the same shape has come up (D15 was the first, for
ordering). The pattern: when an intended difference has structural consequences,
declare the transformation, never the fallout.

## D20. The endpoints nothing had ever compared

`paths()` expands `{id}` only when the run is given `--ids`, so every
parameterised endpoint was silently absent from every diff. `/data/pathways/top/{id}`
had been merged for weeks and had never once been compared with Java; it carried
D17, D18 and a 404 that node answered as `200 []`.

A diff run that quietly tests fewer endpoints than the table holds is the same
failure this whole harness exists to prevent, one level up. Until the harness
defaults to a sample id per parameterised endpoint, **`--ids` is not optional**
and a green run without it means less than it appears to.

## D21. The reaction layout has no one answer to match

`GET /exporter/reaction/{identifier}/diagram` (T092) returns a reaction's
layout as diagram JSON and graph JSON, made on each request by the
reaction-exporter library. Asking Java the same question twice, 5 Nov 2026,
did not give the same bytes:

- **Ids** come from a counter that runs across requests, so the same node has a
  different `id` each time, and every reference to it (`componentIds`,
  connectors' `edgeId`, the graph's `diagramIds`) changes with it. Over 99
  reactions fetched three times each, every answer varied
  ([spec 018](../018-render-page-reuse/research.md) R7).
- **The order** of the nodes varies for some reactions.
- **The layout itself** sometimes varies. R-HSA-1791144 came back with a
  different arrangement in about one call in six.

FR-001's byte-identity cannot be met against an answer that is not identical
to itself. So, as with D15, the comparison is declared by a transformation
rather than by its symptoms (D19). It applies to this operation only.

- **What stays exact.** The status and the headers are compared byte for byte,
  as for any port. Key order inside each object survives the canonical form,
  which keeps each side's own, and each side's canonical form is compared as
  serialized text, so key order is compared with the content. Number
  formatting and whitespace do not survive parsing: the canonical comparison
  does not see them, and T092 adds a check of them on the raw text.
- **The body's content** is compared after both sides are parsed and put in
  canonical form: `canonicalReaction` (#795), the transformation the site
  already applies. It sorts the lists (compartments, nodes and edges by
  reactomeId, x, y and class; links by class and segments), then numbers the ids in that order and sorts
  what refers to them: connectors and components by their new ids, node
  connectors by edge, type and segments, the graph's nodes and edges by
  dbId. Positions, classes, names and wiring remain values, so a
  wrong one or a missing element still differs. Elements tied on every sort
  key keep their input order, so two equal answers can still compare as
  different: a false difference, never a false match, to be looked at by hand.
- **The layout.** Node's answer is deterministic. Its canonical form must equal
  the canonical form of one of the layouts Java gave for that reaction over at
  least 24 requests, at which a layout Java gives one call in six is missed
  about one time in eighty. A rarer layout is missed more often, so across
  thousands of reactions some misses are expected; each is looked at by hand.
  A reaction whose Java layouts never match node's is a difference, not noise.
- **Node does not copy the variation.** Where node's one layout matches none
  of Java's for a reaction, because the variation's cause is fixed rather than
  reproduced, that is a declared difference (D11), on the reactions it
  affects, recorded with the reason.

The port is not held in Java by FR-005: spec 010's record homes it in node.
What the library does is a layout algorithm (compartments from the GO cellular
component ontology as the graph holds it, then the participants placed around
the reaction), and none of its dependencies is Java-only. Reading the
algorithm, and finding where its variation comes from, is the first step of
T092. Spec 010's rule is amended to allow this (5 Nov 2026). The canonical form
is site code today; the diff harness reaching it (moved to a shared module, or
reimplemented and checked against it) is part of T092's plan.

### Where the variation comes from (read 5 Nov 2026)

The library read is reaction-exporter's main at 9465e2e, the source of the
1.2.9-SNAPSHOT ContentService deploys; the deployed classes were checked
against it. ContentService lays reactions out with its `BOX` style
(`BoxAlgorithm`, `Box`); `BRUTE_FORCE` is not used. Two causes, both within
one running service:

- **Glyph ids from a counter that never resets.** Every glyph takes its id
  from one static `AtomicLong`, shared by all requests and threads, and its
  `equals` and `hashCode` are the id's. The layout's entities, and each
  compartment's children and contained glyphs, are `HashSet`s, which iterate
  in an order set by those ids. That order reaches the answer in these places:
  - the order of the nodes, of the edges' parts and of each compartment's
    components (`ReactionDiagramFactory`);
  - a compartment's child boxes (`Box`). The first two are placed relative
    to each other in set order, and more than two are sorted on keys that
    can tie;
  - sibling compartments' widths, when a name is wider than its content
    (`BoxAlgorithm.size`);
  - entities tied on `LayoutIndex`'s sort keys (number of roles, then, for
    regulators only, negative ones first, then trivial, class, name);
  - the graph's `diagramIds`, harmlessly, since the canonical form sorts them.

  Regulators tied on their x are not among them: they keep the grid's order,
  column then row, which is fixed once the grid is.

- **A participant's roles in a hash set of objects without a hash of their
  own.** `Role` has no `equals` or `hashCode`, so an entity's roles iterate in
  identity-hash order, new on every request. So even a freshly started
  service's first request is not guaranteed to be reproducible. The order
  decides two things:
  - for an entity in two roles that are drawn apart, an output that is also
    a negative regulator say, which role keeps the original glyph and which
    gets a copy (`DuplicateManager`);
  - the order of the connectors of an entity that is both input and
    catalyst.

Not a cause: an entity's places (left, top and so on) are gathered into a
hash set, but merged into `EnumSet`s, in declaration order, before any use
that depends on order.

No single Java answer has the same ids or order every time, so the comparison
stays canonical, as above. **Node** is deterministic. Its glyph ids are
numbered from 1 on each request, and its hash sets iterate as Java's do with
those ids (D22): the order a freshly started service gives its first request,
roles apart. An entity's roles keep the order the query gives. Which glyph is
the original and which the copy, and the order of an entity's connectors, do
not survive the canonical form, which renumbers ids and sorts connectors. So
node's choice there is not checked by the comparison, and needs no match. Where
node's layout matches none of Java's, that is the declared difference above,
with this as its reason.

What else the port carries over:

- **Text widths.** Glyph sizes come from text measured with Java's AWT font
  metrics, at 8 points bold. Entities are measured in the system's `arial`,
  looked up by name, so the fonts installed where Java runs are part of its
  answer: without Arial, Java falls back to its default font. Compartment
  names are measured in an Arial Bold bundled in the library. Neither font
  is freely licensed, so neither comes into this repository. Measured widths
  replace them, generated once from Java as deployed and checked against it.

  Measured 5 Nov 2026, under the OpenJDK 11 the deployed service runs
  (headless, as it runs), with the library's own calls (`stringWidth` and
  `getHeight` on a `BufferedImage`'s graphics):
  - the host's Arial Bold is the same file as the bundled one. Over every
    code point, the two can draw the same 1,191 characters, at the same
    widths;
  - entities are sized by fitting their first name into lines. The
    library's fitting, done again with a table of those widths instead of
    the font, gives the same size for each of release 98's 96,310 distinct
    first names of physical entities;
  - compartments are sized by their name's whole width, without fitting.
    Each of the 455 cellular components' names measures as the sum of its
    characters' widths, as does each entity's first name;
  - a character the font cannot draw measures 6, the missing glyph, and the
    line height is 10. The exceptions are a few combining, format and
    complex-script characters, and the whole of U+E0000 to U+E0FFF (tags,
    variation selectors and unassigned code points). They measure 0, or 12
    for one Thai vowel, and Java lays such scripts out as a whole. No release
    98 name uses any of them.

  So a table of 1,191 widths, with 6 for any other character, reproduces
  Java's measure on the deployed setup for Reactome's names. Java on a host
  without Arial would measure differently; that is a difference in Java's
  setup, not in the port.

- **Compartments.** The compartment tree is built from the graph: GO
  cellular components with their `instanceOf` and `surroundedBy`, plus two
  fixes the library makes. A GO file is bundled too, but only for a source
  ContentService does not use. Ties between equal branches follow the order
  of hash sets keyed by GO id, a string: arbitrary but deterministic, and
  node reproduces it.
- **Inputs assumed stable.** None of these has an `ORDER BY`, and all are
  stable in practice, but Neo4j does not promise any of them:
  - the participants' order from the layout's query (`collect(DISTINCT …)`);
  - which diagram its `LIMIT 1` picks;
  - from the graph's two queries, the order of each graph node's children
    and parents, and of each edge's inputs, outputs, catalysts,
    entity functional statuses, regulations, preceding and following events.
    The canonical form sorts the graph's nodes and edges, but not those
    lists;
  - the order of graph nodes that share a dbId. The node query returns one
    row per species, so an entity of several species (355 in release 98) is
    several nodes, which the canonical form's sort by dbId does not
    separate.

## D22. How the reaction layout is ported (T092)

The port covers the library's `BOX` path (D21), about 5,900 lines of Java
with comments, so it lands in steps, each its own pull request. Java shows
nothing between the graph and its final answer. But each step decides parts
of that answer that later steps do not change. So each step is compared
against Java's answer on those parts alone, and a wrong step is found where
it is made, not three steps later.

1. **Inputs.** The layout's query (`LayoutFactory`) and what each
   participant's glyph shows: name, class, renderable class, drug and dashed
   flags, and its attachments' names. Also merging a participant asked for
   twice (`Layout.setParticipants`), the reaction glyph's own fields, and the
   answer's headers (the diagram's and the graph's ids, names, disease flag
   and species). Last comes the compartment tree from the graph
   (`ReactomeCompartmentFactory`, `GoTreeFactory`), with the fixes that put a
   glyph without a compartment in the root, and the root's removal at the
   end (`removeExtracellular`).
   - Java loads participants lazily, as getters ask, with lists in their
     `order` (relationships by type, then `order`). Node asks the graph for
     the same fields explicitly, in that order.
   - Compared, as sorted lists since nothing is placed yet: each node's
     `reactomeId`, `schemaClass`, `renderableClass`, `displayName` and flags;
     the headers; and each compartment's name with the name of the
     compartment around it.
2. **Sizes.** The width table (D21) and the glyph sizes (`Transformer`): each
   node's width and height, a protein's attachments and how they enlarge it,
   and the reaction's own segments. Compared: those, per node.
3. **Placement and connectors.** The `BOX` algorithm (`BoxAlgorithm`, `Box`,
   the glyph layouts, `Grid`, `PlacePositioner`, `LayoutIndex`) and
   `ConnectorFactory`, which runs inside it: a connector can widen a
   compartment and the layout's bounds, so the two cannot be compared apart.
   This step also decides which compartment holds the reaction, which
   placement can move. Compared: the whole diagram in canonical form.
4. **The graph and the answer.** The graph JSON (`ReactionGraphFactory`) and
   the answer as Java writes it. Compared: the whole answer in canonical
   form, as D21 declares.
5. **Routing.** `/exporter/reaction/{identifier}/diagram` moves to node,
   errors included:
   - an id, stable or a dbId, that is not a reaction-like event is Java's
     400 ("does not correspond to a 'ReactionLikeEvent'");
   - an unknown one is its 404 ("Identifier '…' not found");
   - an entity of a class the library has no renderable class for is its 500.

   `/exporter/reaction/{identifier}.{ext}` follows whatever T090 and T091
   decide for diagrams' images.

**Java's hash sets.** Many of the library's choices follow the iteration
order of a `HashSet` or `HashMap`:

- of GO terms, hashed by their id, a string;
- of glyphs, hashed by an id from the counter (D21).

Node reproduces those orders with its port of JDK 11's `HashMap`
(`java-hashmap.ts`), with glyph ids numbered from 1 in the order Java makes
glyphs. That includes the ids a merged participant or a copied glyph uses
up. Where a set is made from a collection, its first table size follows the
collection's, as Java's does. Roles, which have no hash of their own, keep
the query's order.

**What Java does that node copies.**

- The query marks a normal reaction's participants `crossed`, but
  `LayoutFactory` never sets the flag. So Java never draws them crossed, and
  merges one with the reaction's own participant of the same stable id.
  Node does the same: the answer is Java's, and a fix belongs in a ticket
  for the team.
- A reaction in no pathway with a diagram has the string "null" as its
  diagram's stable id, if the deployed driver reads a missing value as
  that. This is checked at step 4 before it is copied.

**Where the code goes.** The algorithm is a library under
`tools/content-node/reaction-layout/`, one module per part above, imported by
a `reaction-layout-endpoints.ts` family. It imports leaves (`graph`, `domain`,
`java-hashmap` and the like) and itself, never a family, the registry or the
server. Step 1 extends `boundaries.spec.ts` to subdirectories, so the check
holds that rule and the one against reaching outside the image.

**The comparison.** `tools/content-node/reaction-layout-check.ts`, a tool
beside the service like the parity harness, compares node with Java over a
sample of reactions (all of them, for the last run).

- It is spaced for the shared database.
- Each reaction is asked of Java once. Only a reaction that differs is asked
  again, up to D21's 24 times, so a rare Java layout costs extra requests
  only where it matters.
- The run stops after 20 differences in a row: a bug that hits every
  reaction should not cost 24 requests each.
- Each step compares only the parts it has built, as listed above.
- The canonical form is the site's `canonicalReaction`. The service may not
  import site code, so the check has a copy, and a test runs both on the
  same answers and requires the same result.

**One more variation.** Java answers with `Map.of("diagram", …, "graph", …)`,
whose key order is set by a seed chosen when the JVM starts. Over 16 starts
under the deployed JDK, `diagram` came first 12 times. Node writes `diagram`
first, and the comparison does not count the order of those two keys as a
difference.

## What exists already

Branch `content-node-spike`, deliberately off main:

- `graph.mjs` — read-only Neo4j access. Credentials are read from a file
  literally rather than sourced by a shell, because generated secrets contain
  characters the shell eats and it silently produced an empty password.
- `service.mjs` — `/data/database/version`, `/data/database/name`,
  `/data/pathways/top/{id}`, byte-identical to Java.
- `diff.mjs` — the harness of D4.
- `CACHING.md` — the caching policy.

The branch is well behind main and would want rebasing before any further work.

## Open questions, not decided here

- Where node runs in production, and whether it shares the deployment with the
  render service or stands alone.
- Whether `/interactors` (17 operations, 3 used) is worth porting at all, or is
  better left proxied indefinitely.
- What the inventory of external consumers actually is. D3 assumes we cannot
  enumerate them; if that can be improved, the parity constraint could relax.
