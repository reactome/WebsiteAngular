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
  The comparison stops sooner when Java answers the same four times (D22),
  so a layout Java gives one call in six is missed about half the time
  there: such a stop is reported to be looked at by hand, or asked again
  with 24, D21's rate.
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
stays canonical, as above. **Node** is deterministic given where its glyph ids
start, and its hash sets iterate as Java's do with those ids (D22). The service
starts at 1, the order a freshly started service gives its first request, roles
apart; the comparison starts where Java's answer shows Java started. An
entity's roles keep the order the query gives. Which glyph is the original and
which the copy, and the order of an entity's connectors, do not survive the
canonical form, which renumbers ids and sorts connectors, though the ids they
take can decide a tie in placement. Where node's layout matches none of Java's,
that is the declared difference above, with this as its reason.

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
   and species, and the diagram's stable id). Then the compartment tree from
   the graph (`ReactomeCompartmentFactory`, `GoTreeFactory`) and each
   entity's compartment, the first of its own. Last, in the order
   `BoxAlgorithm` runs them: the copies `DuplicateManager` makes of an
   entity in roles drawn apart, then the fixes that put a glyph without a
   compartment in the root, and the root's removal at the end
   (`removeExtracellular`).
   - Java loads participants lazily, as getters ask, with lists in their
     `order` (relationships by type, then `order`). Node asks the graph for
     the same fields explicitly, in that order.
   - Compared, as sorted lists since nothing is placed yet: each node's
     `reactomeId`, `schemaClass`, `renderableClass`, `displayName` and flags,
     with the name of the compartment holding it; the headers; and each
     compartment's name with the name of the compartment around it.
   - A reaction in no pathway with a diagram is checked here for its
     diagram's stable id: the string "null" if the deployed driver reads a
     missing value as that, which node then copies.
2. **Sizes.** The width table (D21) and the glyph sizes (`Transformer`): each
   node's width and height, a protein's attachments and how they enlarge it,
   and the reaction's own segments. Compared: those, per node.
3. **Placement and connectors.** The `BOX` algorithm (`BoxAlgorithm`, `Box`,
   the glyph layouts, `Grid`, `PlacePositioner`, `LayoutIndex`) and
   `ConnectorFactory`, which runs inside it: a connector can widen a
   compartment and the layout's bounds, so the two cannot be compared apart.
   Placement can move the reaction into another compartment, the one change
   of containment after step 1. Compared: the whole diagram in canonical form.
   - Done in #831 (replacing #830). Every position is compared, within the
     declared tolerance below. Jackson's part, which
     null and empty fields it leaves out and the order it writes fields in,
     is step 4's: node's nulls and empty lists are dropped and keys sorted
     before the comparison.
   - A connector's end shape is drawn by diagram-reader when its type is set
     (`ConnectorImpl.setPointer`, `ShapeBuilder`). That code is not in the
     library's source: it was read from the bytecode of the deployed
     diagram-reader 1.2.5, and its values were checked against that jar run
     under JDK 11. `atan` gives Java's bits (Java's goes through StrictMath,
     fdlibm, as Node's does), but `sin` and `cos` do not: on x86-64 HotSpot
     uses its own table-driven routines, whose last bit differs from Node's
     on about 3.5% of arguments. Diagonal catalyst, inhibitor and activator
     lines, and fans of nine or more regulators, can come out a bit apart
     (0.35% of 20,000 random connector ends). Decided 5 Nov 2026 (awright),
     a declared difference (D11): the comparison takes two numbers as equal
     when they are within a billionth of Java's value's size, or within
     1e-9 of it when that value is below 1 in size (`1e-9 * max(1, |java|)`).
     Java's own bits would change on
     another platform, so they are not a stable target, and no drawing can
     show the difference.
   - A reaction moved into a child compartment is held by the child, but
     keeps the outer compartment as its own (`Box.moveReactionTo`). Its cell
     is then sized and checked as the outer compartment's.
   - A box stretched to the height of a taller sibling places its children
     again, each at row 2, column 2. Of two side by side, the second takes
     the first's cell, and keeps its own old one: the first is lost, and the
     second is placed and drawn twice. Node does the same.
   - An entity with two roles of one type is listed, placed and wired once per
     role. A connector given a type twice draws its end twice; a catalyst's
     last segment is shortened twice.
   - Which glyph of an entity drawn twice keeps which role follows the roles'
     random order (D21), so the order of the edge's parts can differ while
     the canonical diagram does not. The comparison asks Java again for an
     order that differs, as for a layout.
4. **The graph and the answer.** The graph JSON (`ReactionGraphFactory`) and
   the answer as Java writes it. Compared: the whole answer in canonical
   form, as D21 declares.
   - Done in #833 (replacing #832). The graph's two queries are Java's, unchanged. graph-core
     maps their rows into diagram-reader's `EntityNodeImpl` and
     `EventNodeImpl` by field name (`ReflectionUtils.build`, read from the
     deployed bytecode): a Long with no value is 0, a list with none is
     empty. So every event's `speciesID` is 0, the query returning no
     `speciesId`, and its `inhibitors`, `activators` and `requirements` are
     always empty: the query's `regulations` match no field and are dropped.
     Node does the same. An entity of the graph the layout does not draw has
     no `diagramIds`.
   - The answer is written as ContentService's mapper writes it: Jackson
     2.13, NON_EMPTY (null, empty text and empty lists left out; 0 and false
     written), Doubles as JDK 11's `Double.toString`. Each class's field
     order was read by writing it, every field set, with the deployed jars,
     and a test holds node's text to Jackson's for a whole answer written
     that way. `Double.toString` under JDK 11 is not always the shortest
     form. Of 300,000 random doubles, node's `javaDouble`, which then wrote
     JavaScript's shortest form, wrote 225 differently. This note said they
     were all 10^16 or more; that was wrong. A double with few significant
     bits differs far below that: JDK 11 writes 2^-44 as
     `5.6843418860808015E-14`, not the shortest `5.684341886080802E-14`, and
     2^-24 as `5.9604644775390625E-8`, not `5.960464477539063E-8`. Every
     ported endpoint writes its doubles through `javaDouble`, so since #853
     it follows JDK 11's algorithm (`java-double.ts`). It was
     compared with JDK 11 on 21,667,178 doubles and none differ; 128,360 of
     them are not written in the shortest form. None lies between 10^-3 and
     10^7, where Java writes plain decimals, and none is a decimal of one to
     three fraction digits up to 10,000 or a sum or difference of two. Writing
     it found `-0.0`, which the service's `javaDouble` wrote `0.0`; fixed there.
   - **Another order set when the JVM starts.** An event's
     `entityFunctionalStatus` and `speciesID` are named by getters that match
     no field, so Jackson writes them after the rest, in the order the JVM
     lists the class's methods. HotSpot orders those by where their names
     sit in memory, so the order follows what was loaded before: in a
     program that wrote an `EntityNodeImpl` first, `speciesID` came first;
     the deployed service writes `entityFunctionalStatus` first. Node writes
     the deployed order, and the comparison does not count the order of
     those two as a difference. Elsewhere such properties are alone in their
     object or never set: a node's `needDashedBorder`; a compartment's
     `componentIds` (its `needDashedBorder` is never set); a diagram's
     `cpicture`, never set.
   - **The raw text** (D21) is compared once the canonical forms, the ids
     and the orders agree, when node has made Java's glyphs with Java's ids:
     the two texts must then be the same character for character, but for
     the two top keys' order, the order of the two fields above in the
     graph's events (`.graph.edges[n]`) and nowhere else, and numbers within
     the declared tolerance (step 3: a billionth of Java's value's size, or
     1e-9 below 1), which must still be written as Java writes a double.
     Node's members are put in Java's top-key order only once node's own text
     is shown to be `{`, its members joined by `,`, and `}`, with nothing
     else between or around them and no key twice: so its own framing is
     still compared. What is compared are JavaScript strings, Java's as
     `response.text()` decodes it and node's as the service makes it in
     process; the bytes and the charset sent over HTTP are step 5's. A number of the same value written another way (`1` for
     `1.0`, `0.0001` for `1.0E-4`, `0.0` for `-0.0`), a space, a key out of
     order or a field left out is a difference. Mutating node's writer
     (a Double written as an integer, two fields swapped, a 0 left out)
     makes the live comparison fail.
   - The orders compared now include each node's connectors' types: an
     entity both input and catalyst has its connectors in its roles' random
     order (D21), so such a reaction is asked again like any other order.
     Java draws the same while that order varies, and it varies unevenly
     (one way on four requests of six, for one such entity), so neither
     Java's drawing nor its connectors' order coming back the same says
     node cannot match: stopping on those stopped three reactions of 425
     that a later attempt would have matched. So an answer whose orders
     alone differ is asked again up to REACTION_LAYOUT_ATTEMPTS times
     (default 24) only while nothing but the order of some node's
     connectors differs. Any other order node makes
     from Java's own ids and should match at once: once Java has drawn the
     same REACTION_LAYOUT_STEADY times, such a reaction is reported to be
     looked at by hand, as a drawing that differs is. A mutation reversing
     node's compartment components stopped so on the fourth request.
   - One more input assumed stable (D21): the order of the graph query's
     rows, which is the graph's node order, and which the raw text compares.
5. **Routing.** `/exporter/reaction/{identifier}/diagram` moves to node,
   errors included:
   - an id, stable or a dbId, that is not a reaction-like event is Java's
     400 ("does not correspond to a 'ReactionLikeEvent'");
   - an unknown one is its 404 ("Identifier '…' not found");
   - any other failure is its 500, answered by Java's exception handler: a
     `NullPointerException` with the fixed "Something unexpected happened
     and the error has been reported.", an exception with no handler of its
     own with its message. A null message is written `"messages":[null]`.
     The paths known from reading are:
     - an entity of a class with no renderable class, "No Schema class
       defined for [dbId:displayName]";
     - an entity whose list of names is null (the fixed text) or empty
       ("Index 0 out of bounds for length 0", if the list is an `ArrayList`;
       Java's empty list says "Index: 0");
     - a compartment given two parents;
     - an entity with no compartment copied by `DuplicateManager`, which
       runs before the fixes;
     - a null disease flag on an entity that is not dashed;
     - a failed layout query, which the library catches and returns as no
       layout, so the answer is the fixed text;
     - an unsupported case in `Transformer`, with no message.

     The comparison reports any 500 it meets, so node's answer can be
     checked against Java's.

   - Done in #834. A family of its own, `reaction-layout-endpoints.ts`,
     answers it, routed to node in nginx (`routes-core.conf`) and the dev
     proxy; the image, `/exporter/reaction/{identifier}.{ext}`, is not
     matched. The id is read as graph-core's `findById` reads it
     (`resolveId`: trimmed, a version cut, a dbId, a pre-2016 `REACT_` id),
     with its two 500s, an id of dots and a dbId past a long, and the error
     answers name the id as sent. Compared with Java live: every error kind
     byte for byte but for the `url` field's host, and the layouts in
     canonical form (and `reaction-layout-check.ts` over 225 reactions, all
     identical, 23 on a later attempt). The Content-Type's media type is
     Java's; its parameter is written as node writes it on every other
     ported endpoint (`charset=utf-8`, where Java writes `charset=UTF-8`).
   - **Stored at the edge**, as any graph answer is (spec 011): node's
     answer is one per reaction per release, laid out from glyph id 1 every
     time, so the variation that would have made Java's uncacheable is not
     there. `view` and `includeRef`, which Java declares and never reads,
     are left out of the standard form, so a URL carrying them is answered
     the same and not stored. One consequence, from the review of 6 Nov:
     the answer is node's own computation, so a change to the layout code
     between releases is not seen at the edge until the release-day purge.
     A pull request that changes what the library lays out purges
     `/ContentService/exporter/reaction/*/diagram` when it is deployed.
   - A name the graph lacks (a compartment's or an entity's) is measured as
     Java measures it, a `NullPointerException`, so the answer is Java's
     500 rather than a failure of node's own (#850).
   - The parity harness compares the error path alone (a pathway's 400):
     it compares answers as data, and Java's layout is not the same twice.
     The layouts are `reaction-layout-check.ts`'s.

   `/exporter/reaction/{identifier}.{ext}` follows whatever T090 and T091
   decide for diagrams' images.

**Java's hash sets.** Many of the library's choices follow the iteration
order of a `HashSet` or `HashMap`:

- of GO terms, hashed by their id, a string;
- of participants, keyed by "stable id:crossed:dashed", and of compartment
  glyphs, keyed by their bare accession: both strings, so these orders
  decide which glyphs are made first, and the GO ids the tree is built from;
- of glyphs, hashed by `Objects.hash(id)`, which is 31 more than the id from
  the counter (D21). The 31 shifts every bucket, so it matters to the order.

Node reproduces those orders with its port of JDK 11's `HashMap`
(`java-hashmap.ts`). The port gains an initial size: a set made from a
collection starts with the table Java gives it, not 16 grown later:
`HashSet(Collection)` sizes it for n/0.75 + 1 entries, so 16 buckets up to 11
entries, 32 from 12 to 23, and so on. A set filled one by one grows instead on
its 13th entry, as the port already does. Glyph ids are numbered in the order
Java makes glyphs, the reaction's first. That includes the ids used up by a
merged participant that is discarded, by a copy, and by each attachment of
either. Roles, which have no hash of their own, keep the query's order, one of
the orders Java can give; two roles of one type stay two.

**Starting where Java started.** Java's counter starts each request wherever
earlier requests left it, and the bucket a glyph lands in depends on that
start. So a fixed start would match Java only on those requests that happen to
start in step with it. Java's answer shows its start: the reaction is the first
glyph made, so the edge's id is the request's first id. Node's library takes
the first id as an argument. The service starts at 1. The comparison runs the
library in process from the edge id Java's answer shows, so the two should
agree on everything but what roles' order decides. Where they still differ,
Java is asked again, as below. Ids depend on the order of the participant rows
too, which Neo4j does not promise (D21): node reads the same query, so its rows
are expected in Java's order. Glyphs Java makes but never shows (attachments, a
discarded merged participant, the removed root) leave gaps in its ids, so a gap
alone proves nothing. An answer whose ids are not the ids node gives the same
glyphs, started from the edge's id, was interleaved with another request, and
is asked again. Interleaving that only shifts the ids of the copies'
attachments cannot be seen, and does not matter: attachments are listed, never
hashed.

**What Java does that node copies.**

- The query marks a normal reaction's participants `crossed`, but
  `LayoutFactory` never sets the flag. So Java never draws them crossed out
  or faded, wires them into the reaction like its own, and merges one with
  the reaction's own participant of the same stable id and dashed flag. Node
  does the same: the answer is Java's, and a fix belongs in a ticket for the
  team.

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
  again, up to REACTION_LAYOUT_ATTEMPTS times (default 24, D21's) while
  Java's answers vary, so a rare Java layout costs extra requests only where
  it matters. Once Java has drawn the same REACTION_LAYOUT_STEADY times
  (default 4) it stops, a node bug costing four requests, not 24, and such a
  reaction is reported to be looked at by hand. Not when all that differs is
  the order of some node's connectors, which follows the roles' random order
  however Java draws (step 4): that is asked to the limit.
- The run stops after 20 differences in a row, so a bug that hits every
  reaction costs at most 20 × REACTION_LAYOUT_ATTEMPTS requests: a run of
  connector-order differences goes to the limit each time, other differences
  stop at REACTION_LAYOUT_STEADY.
- A reaction Java fails with its 500 must meet one of the library's Java
  exceptions in node, and the message the service answers it with (step 5)
  must be Java's.
- Each step compares only the parts it has built, as listed above.
- The canonical form is the site's `canonicalReaction`. The service may not
  import site code, so the check has a copy, and a test runs both on the
  same answers and requires the same result.

**One more variation.** Java answers with `Map.of("diagram", …, "graph", …)`,
whose key order is set by a seed chosen when the JVM starts. Over 16 starts
under the deployed JDK, `diagram` came first 12 times. Node writes `diagram`
first, and the comparison does not count the order of those two keys as a
difference.

## D23. The contact form: Java's form, Turnstile's check, mail through SES (T085)

**Decided** by awright, 6 Nov 2026, for `POST /contact`
(ContactController): Java's parameters and refusals, and four things not
done as Java does them -- the human check, how the mail is sent, whom the
message is from, and the reader's copy.

**What is Java's, unchanged.** The parameters, read from the query and from a
URL-encoded or multipart form body, as Tomcat reads them; a text/plain body
is not read (measured). The first missing required parameter is Spring's 400
in the envelope, in the method's order. A blank token is the 400 text
`captcha verification failed`, then a blank address, subject or message the
400 text `missing required field`. The message keeps Java's subject (the
reader's) and Java's body: `From: name <address>` -- the address when no
name is given -- a blank line, and the message. The answer is an empty 200.
Java's answers before sending were
measured against the deployed service on 6 Nov 2026; no request it would
accept was sent to it, since it would send mail.

**Different: the human check.** Java verified an hCaptcha token, through an
HTTP client that trusted any certificate and checked no host name. Node
verifies a Cloudflare Turnstile token, with the secret and the siteverify
address the site's own gate uses (`human-gate.js`), over a verified
connection, and anything but `success: true` fails: a network error, a
timeout, an answer that is not JSON. The token's parameter is
`cf-turnstile-response`, the field Turnstile's widget adds to a form, in
place of `h-captcha-response`; missing, it is Spring's 400 naming it. An
hCaptcha token cannot be checked by Turnstile, so a caller still sending one
is refused as an unverified one is. The site's own form needed no change: it
already asks with Turnstile, and posts to the site's own route.

**Different: how the mail is sent** (awright, 6 Nov 2026, replacing the
SMTP sending of #835 and #836). Java logged in to an SMTP server with a
stored user name and password, over STARTTLS it did not require, checking
the certificate without the host name (JavaMail 1.6's defaults). Node sends
through Amazon SES's API, `SendEmail` (v2), with `@aws-sdk/client-sesv2`,
signed with the credentials the SDK's default chain finds: on the host, the
instance's role, through the instance metadata service. Why:

- No password is stored: there is nothing to keep secret, rotate or leak,
  and the permission is the role's, one statement an administrator grants
  and can withdraw (`ses:SendEmail`, conditioned on `ses:FromAddress` being
  the support address).
- The SMTP credentials the Java configuration holds are refused (535), so
  that path was not available anyway; the servers it names are SES's.
- The server's identity: the SDK speaks HTTPS to SES's regional endpoint and
  verifies it as Node verifies any HTTPS server, against the system's
  authorities and by name. Nothing here gives it an agent or turns that
  off (tested: the client's configuration is the region, one attempt and
  the timeouts, and the module names no agent and no verification switch).

The one attempt has five seconds to connect and ten to answer, and the
whole send is abandoned after fifteen, so a reader's request is never held.
There is no retry: an answer that comes late may come from a message SES
has sent, and a retry would send it twice. A failure -- credentials not found, permission
refused, SES unreachable -- is the 500 below, logged by the error's name and
HTTP status alone, never its message, which can carry the role's or the
reader's details.

The message is a simple one: SES writes the headers from the from, to and
reply-to addresses and a UTF-8 subject, and the text body. The addresses
are given as text, so they are written here so that they cannot break a
header. A display name and the subject are made one line first: every
control character (C0, DEL, U+0085) and the Unicode line and paragraph
separators become spaces. Then a display name of printable ASCII is a
quoted string; any other is RFC 2047 encoded words, each at most 75
characters, split between characters, separated by spaces (tested, and on
the request the SDK would send).

**For the deployment:** the role's permission above; and the instance
metadata service within reach of the container. With host networking, as
compose runs the content service today, the instance's default hop limit
of 1 is enough; a bridged container -- the plan once the graph is a
container (D13) -- is one hop further and needs a hop limit of at least 2.

**Different: whom the message is from, and no copy** (awright, 6 Nov 2026,
replacing #835's Java shape). Java sent the help desk's message from the
reader's own name and address, and, when `sendEmailCopy` was `on` or
`true`, a copy from the support address to the reader. Node sends one
message, from the support name and address (`CONTACT_SUPPORT_NAME`,
`CONTACT_SUPPORT_ADDRESS`) to the support address, with the reader as its
Reply-To, so a reply from the help desk reaches them. A message from the
reader's address, sent by a server that domain does not name, is refused
or filed as spam by receiving mail checks (SPF, DMARC); one from the site's
own address is not. No copy goes to the reader: it would send mail to any
address someone types, a Turnstile pass apiece. `sendEmailCopy` is still
taken, as an optional parameter as Java declares it, and ignored.

**Open, for awright to decide later:** whether the site's search-page form
(its own `/contact` route, which sends through the local mail transfer
agent) moves onto this endpoint, so there is one mail path. Both stay for
now.

**Limits** (from the review of #836 and #838). Java read any body Tomcat
would; node had read up to 10MB, and its decoder re-read the whole body for
each of the six parameters, a Buffer for every character: about 1.5 s of a
1MB body, the whole service waiting, before Turnstile or the 503 was
reached. Now:

- The body is held to 64KB: nginx's `client_max_body_size 64k` on the route,
  and node's own limit (the endpoint's `bodyLimit`), past which node stops
  keeping what it reads and answers 413 in the envelope, before parsing.
- The query and a URL-encoded body are each parsed once, in one linear pass
  over bytes (spring.ts, `servletParameters`), giving what the old decoder
  gave on every input (compared on 5,000 random ones, malformed escapes and
  lone surrogates among them); the other endpoints that read parameters
  share it. 64KB parses in a few milliseconds, 1MB in about 15.
- The fields are capped, a 400 in the envelope before Turnstile is asked:
  `contactName` and `subject` at 200 characters, `message` at 20,000. A
  message of 20,000 characters past ASCII is more than 64KB once
  URL-encoded, so for one of those the body's limit comes first.
- The reader's address is one plain address: a dot-atom local part (no dot
  leading, trailing or doubled), without `%` or `!`, not starting `=?`, and
  a domain of two or more labels of letters, digits and hyphens, none at a
  label's ends.

**Open, not done here:** checking Turnstile's answer for the action and the
hostname the token was made for -- no widget of the site's posts here yet,
so there is nothing to name; parameters taken from the query string as well
as the body, as Java takes them; and nginx's rate limit, keyed on the whole
address, which gives an IPv6 client a key per address of its /64.

**What Java never answered.** In its envelope: 503 `SERVICE_UNAVAILABLE` when
the deployment cannot send (no support address, a region that is not one,
or no Turnstile secret), before Cloudflare is asked
anything; 400 `BAD_REQUEST` for an address that is not one plain address
(Java's `InternetAddress` refused those with a 500 naming the exception), so
the Reply-To is never a list; 400 for a field past its cap and 413 for a
body past 64KB (Limits, above); and 500 `The message could not be sent`,
without SES's own words, when the mail could not be handed on (Java's
500 carried the exception's message).

**The library: Amazon's SES client** (`@aws-sdk/client-sesv2`, Apache-2.0,
as are its AWS and Smithy dependencies; one more, `bowser`, is MIT). Pinned
exactly, at a release two weeks old when it was added, and installed into
the content service's image from the root lockfile, as express and the
graph driver are; about 7 MB more in the image. nodemailer, which #835 and
#836 used for SMTP, is removed.

**Settings**, in the environment or the credentials file:
`CONTACT_SUPPORT_ADDRESS` (Java's cnf.mail.support.address),
`CONTACT_SUPPORT_NAME` (cnf.mail.support.name), `CONTACT_SES_REGION` (the
SES region, `us-east-1` by default), and Turnstile's `CLOUDFLARE_SECRET_KEY`,
the site's gate's name for it. No credentials: the role supplies them.

**A budget.** Each request that passes sends a message, so nginx gives
the route its own limit, six a minute per address with a burst of three
(`contact_rate`), in each deployment; local, which has no limits, routes it
without one.

## D24. ContentService's images: node answers, the render service draws (T090–T092)

**Decided** by awright, 8 Nov 2026: ContentService's image URLs,
`/exporter/diagram/{identifier}.{ext}` and `/exporter/reaction/{identifier}.{ext}`,
are answered by node, which has the render service draw them. Java's
exporter is no longer used for them, and callers never see the render
service: from outside there is one ContentService (#273, "Decided"). There is
no log scan first: the decision overrides the scan #273 had made a gate.
Each figure is in the website's look, not the old pathway browser's: a
declared difference.

**What stays Java's**: each URL's PowerPoint, `/exporter/{diagram,reaction}/{identifier}.pptx`,
another of Java's exporters (PptxExporterController), whose pattern names its
extension; nginx and the dev proxy leave a lower-case `.pptx` to Java. Spring
matches it by case, so `.PPTX` was always the image controller's 500, and is
node's.

### A reaction's image (T092)

`reactionImage`'s answers, in Java's order, each measured against Java on
7 Nov 2026 and kept byte for byte but for the `url` field's host:

1. The parameters as Spring converts them, in its order (quality, flg,
   flgInteractors, sel, title, margin, diagramProfile, token, analysisProfile,
   resource, expColumn): a value that is not an Integer or a Boolean is
   Spring's 400.
2. The id as `getReactionLikeEvent` reads it: an id of dots or a dbId past a
   long is a 500, no object a 404, an object that is not a ReactionLikeEvent a
   400, named as sent.
3. `.pdf`, in any case: the 500 "Unsupported file extension pdf".
4. The layout, which Java made before anything else was drawn: the library's
   Java exceptions are the handler's 500s (D22, step 5). Node lays the reaction
   out here too, then lets the render page fetch the layout again.
5. A quality outside 1–10: the 500 "quality must be in the range [1-10]"
   (RasterArgs). A blank quality is the default, 5.
6. An extension DiagramRenderer does not draw (png, jpg, jpeg, gif and svg
   are drawn): the 500 "Unsupported file extension" with the extension trimmed
   and in lower case, `.BMP` as `bmp`. Spring marks it
   `Content-Disposition: inline;filename=f.txt` where it does not trust the
   extension, as on every node answer (`server.ts`).
7. The figure: Java's Content-Type, `image/` and the extension in lower case
   (`svg+xml` for svg, `jpg` kept as `jpg`), `;charset=UTF-8`, and no
   Content-Disposition. Nothing of the render service's headers is passed on.

The figure is the render service's reaction view (`layout=reaction`), drawn
from node's own layout of the reaction (D22). Each of Java's parameters:

| Java's parameter                    | What node does                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ext`                               | png, jpg and jpeg (jpeg to the render service), svg, gif: a still, one frame, as Java's gif without an expression analysis                                                                                                                                                                                                    |
| `quality` (1–10, default 5)         | The render service's `scale`: Java's factor of the layout's size (RasterArgs: 0.1 at 1, 1 at 5, 3 at 10), within what the render service draws, 0.25 to 2. Qualities 1 and 8–10 are drawn at the nearest it allows. An SVG is the layout's size whatever the quality, where Java's was scaled                                 |
| `flg`, `flgInteractors`             | Accepted, not drawn: the render service draws no flags. Java searched for the flagged entities and, on a search failure, answered the search's error; node does not search                                                                                                                                                    |
| `sel`                               | Accepted, not drawn: the reaction view marks no selection                                                                                                                                                                                                                                                                     |
| `title` (default true)              | Accepted, not drawn: the render service draws no caption under the figure                                                                                                                                                                                                                                                     |
| `margin` (0–20, default 15)         | Accepted, not drawn: the render page sets its own margin. Java clamped any Integer to 0–20                                                                                                                                                                                                                                    |
| `diagramProfile`, `analysisProfile` | Accepted, not drawn: there is one look, the website's. Java took any name, an unknown one as its default                                                                                                                                                                                                                      |
| `token`, `resource`, `expColumn`    | Accepted, not drawn: the reaction view is never coloured by an analysis (the render page's own rule), so node does not pass the token on. Java checked the token, and answered a 500 for one expired or unknown ("Token has expired: …", "Token not valid: …"); node does not read it, so such a token is a figure, not a 500 |

Accepting is what keeps callers working: each of these was a figure in Java
and is a figure now, the same reaction, where a refusal would break a caller
for an option that changes only how the figure looks. The difference is
declared (`documentation/declared-differences.md`) rather than detectable in
the answer.

**Fixed in the render page**, which the reaction image needs: the reaction
view's `.jpeg` was a PNG with a transparent background (encoded as JPEG only
through the diagram, which the view does not have, and the instance's own
`jpg()` writes PNG where a layer is added), and its `.gif` failed, with no
frame to capture. The render service's cache key moves to v13, so no reaction
`.jpeg` cached as a PNG is served.

**Routed** under the render budget in `routes.conf` (every deployment), without
it in `local.conf`, and in the dev proxy.

**Stored at the edge** (spec 011) in standard form: an `oid` with one of the
five extensions, and `quality` alone, so one figure per reaction, format and
quality per release. A URL naming any parameter node does not draw is
answered the same and never stored, so the unbounded profile and flag values
cannot fill the cache; one with a token is private, as every answer with
one. The figure is the render service's, so a change to how the render page
draws a reaction is not seen at the edge until the release purge: a pull
request that changes it purges `/ContentService/exporter/reaction/*` when it is
deployed, as one that changes the layout does (D22, step 5).

### A diagram's image (T090, T091)

`diagramImage`'s answers, in Java's order, measured against Java on 8 Nov
2026 and kept byte for byte but for `url` (#479 had them; these runs
confirmed them):

1. The parameters as Spring converts them, in its order (quality, flg,
   flgInteractors, sel, title, margin, ehld, diagramProfile, token, resource,
   analysisProfile, expColumn): Spring's 400s.
2. graph-core's DiagramService resolves the id to the diagram that draws it
   and the events to select there: a pathway with a diagram is itself, a
   subpathway is its parent's diagram with its reactions, a reaction is the
   diagram that holds it with itself. No result (nothing found, or no event)
   is the 400 "'X' is not an event", whatever else is wrong.
3. `.pdf`: 500 "Unsupported file extension pdf".
4. A blank quality (Java unboxes it for its raster budget) and a blank ehld:
   the service's generic 500.
5. A quality outside 1–10: 500 "quality must be in the range [1-10]".
6. An extension it does not draw: 500 "Unsupported file extension xyz", with
   Spring's `f.txt` where it marks one. (#479's note that Java answered an
   empty 200 here did not hold on the deployed service.)
7. The figure: Java's Content-Type, no Content-Disposition.

Each of Java's parameters:

| Java's parameter                                       | What node does                                                                                                                                                                                                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ext`                                                  | png, jpg and jpeg, svg, gif: a still without an expression analysis, the animation with one, as Java's                                                                                                                                                                 |
| `quality`                                              | The render service's `scale`, as for a reaction                                                                                                                                                                                                                        |
| `sel`                                                  | Drawn: added to the resolved events, as Java's `toSelect.addAll(sel)`, and marked on the whole diagram (`highlight`). An id that names nothing selects nothing, as in Java                                                                                             |
| `token`                                                | Passed to the render service, which colours the diagram, illustration or overview with the result and waits for it; a result it cannot read is its 500 naming why ("the analysis result is gone…"), where Java answered "Token has expired: …" or "Token not valid: …" |
| `ehld` (default true)                                  | Accepted, not drawn: the render page draws a pathway's illustration whenever it has one, so `ehld=false` is the illustration too. Java drew the diagram                                                                                                                |
| `sel` or a resolved selection on an illustration       | Not drawn: the render page marks no selection on an illustration, so the figure is the illustration without it (#479 refused it with a 400)                                                                                                                            |
| `flg`, `flgInteractors`                                | Accepted, not drawn. Java's flag search swallowed its own failure (#273), so nothing is lost there                                                                                                                                                                     |
| `title`, `margin`, `diagramProfile`, `analysisProfile` | Accepted, not drawn, as for a reaction                                                                                                                                                                                                                                 |
| `resource`, `expColumn`                                | Accepted, not drawn: the render page colours by the resource the result settles on, and animates every column of an expression analysis                                                                                                                                |

#479 refused every parameter it did not draw at a value other than its
default, so a figure could not leave out what was asked for without saying
so. The decision of 8 Nov 2026 is that callers keep working: the refusals
are gone, and what is not drawn is declared instead.

**The site's own caller**: the content pages' detail diagram asks for
`/exporter/diagram/{stId}.svg`. It is now the render service's SVG, in the
site's own look, stored at the edge once drawn; a first request waits for a
render (seconds) where Java answered at once.

**Stored at the edge** in standard form: an `oid` with one of the five
extensions, and `quality` alone. `sel` is drawn, but any text is a figure,
so a URL with it is answered and never stored; a token makes it private.

### The PowerPoints (T109)

**Decided** by awright, 8 Nov 2026: node answers `/exporter/diagram/{identifier}.pptx`
and `/exporter/reaction/{identifier}.pptx` too, through the render service's
PowerPoint export. Spring matches `.pptx` by case, so only a lower-case one is
PptxExporterController's; `.PPTX` stays the image exporter's 500.
PptxExporterController's answers, measured against Java on 8 Nov 2026:

- **A diagram's**: graph-core resolves the id as for its image; an id that
  resolves to nothing is a NullPointerException, the generic 500 (no download
  guard: the pattern names `.pptx`). The file is the diagram that holds the
  event, with `sel` and the resolved events marked (none on an illustration).
- **A reaction's**: Java resolved the id's diagram first and read it only to
  flag, so with `flg` an id that resolves to nothing is the generic 500; then
  getReactionLikeEvent's 404, 400 and 500s, and the layout's Java exceptions;
  then the reaction's own layout.
- **Both**: `application/vnd.openxmlformats-officedocument.presentationml.presentation;charset=UTF-8`
  and `Content-Disposition: attachment; filename="[stId] displayName.pptx"`
  (ExportManager.getPPTXFileName: the diagram's stable id for a diagram,
  the stable id alone when there is no display name), kept as Java writes it.
- `diagramProfile`, `flg`, `flgInteractors` and a reaction's `sel` are accepted
  and not drawn; a URL naming one is not stored at the edge.

**The species overview** now accepts the options it does not draw, as
diagrams and reactions do, instead of refusing them (#613's 400s): its token
is drawn, the rest are accepted. A `.gif` of it is still refused, a format
the genome-wide view cannot capture.

## D25. The events hierarchy: the AnalysisService's sizes, snapshotted at release (T103)

`GET /data/eventsHierarchy/{species}` is what the Pathway Browser's Reacfoam
draws (`reacfoam.service.ts`): always `pathwaysOnly=true`, by taxId, with an
analysis `token`, `resource` and `interactors` when one is shown. Measured
11 Nov 2026 against release 98.

**Two trees.** With `pathwaysOnly`, Java answers from analysis-core's
in-memory `PathwayHierarchy`, which the AnalysisService's data file holds: its
names and types come from that file, and siblings sit in a `TreeSet` ordered by
species, `hasEvent` order (a top-level pathway's is its place among
`toLower(displayName)`), then name by `String.compareTo`, so equal siblings
merge. The full form is graph-core's event hierarchy (node already parses it,
`parseHierarchy`), each pathway's sizes looked up by stId and every other event
`0/0`. Without a token, both are deterministic; `interactors`, `resource` and
`importableOnly` change nothing.

**The sizes.** `totalEntity` is, per pathway, the distinct
`(main resource, identifier)` pairs of the physical entities its reactions
reach, its subpathways' included; `totalEntityAndInteractors` adds each
interaction partner's identifier under the target's resource. Computed from the
graph (`analysis-sizes.ts`, T103a), `totalEntity` matches Java for every
pathway of all 16 species Java has a hierarchy for (3,067 human tree nodes);
`totalEntityAndInteractors` matches 14 species exactly. The others are 79 human
tree nodes (76 pathways), each 1 to 6 higher in node (50 by one, 14 by two, 12
by three to six), and 8 yeast pathways, each 1 higher. analysis-core's
InteractorsBuilder keys interactors by upper-cased identifier in one radix map
that holds their aliases too, so a partner whose identifier is another's alias
is merged into whichever was made first: in human, Q6NSH3 (CT45A5) into P0DMU9
(CT45A10), which lists it as a secondary identifier; in yeast, P04838 into the
polyubiquitin P0CG63. Distinct entries in the graph, often near-identical
paralogues that once shared one.

**Decision: node computes the sizes from the graph, once per species while it
runs, and the 84 pathways are a recorded difference.** The gap is a handful of
entities on pathways holding hundreds or thousands (Signal Transduction 10,318
against 10,316), far below anything a reader of the Reacfoam can see, and the
alternative -- a Java step at each release reading the data file with
analysis-core -- adds a library build the project is not set up to keep
current. The 84 are listed with both values in
`fixtures/analysis-size-differences.json`, and `analysis-sizes-check.ts` fails
on any other difference, or on one of them gone. The cause is reported to
analysis-core (reactome/analysis-core#13), to be fixed with a Reactome release;
once it is, Java's numbers become node's and the record goes. The
`pathwaysOnly` tree is built from the graph by the analysis hierarchy's rules.
Rejected: a release-time snapshot of the data file (exact, but a Java library
step to maintain); reading the totals from an analysis of every identifier
(`result.json`, 134 MB, a hack).

**The overlay.** With a token, Java adds `llp`, `entities` and `reactions` to
each node the stored result names. Node reads them through the analysis
gateway: `/download/{token}/result.json` carries per-pathway TOTAL and
per-resource statistics, and `/token/{token}?importableOnly=true` the
importable ones. Java collects a hit node's children into a HashSet of identity
hashes, so its own order below a hit changes from one request to the next:
token answers are compared without regard to that order.

**Errors to keep:** an unknown species, or one with no hierarchy, is a 500
("Something unexpected happened…"); `pathwaysOnly` reads a taxId, dbId or name,
the full form treats a number as a taxId and an exact name ends in a
StackOverflowError 500; a bad boolean is Spring's 400; a bad token a 500 "Not
Found"; every 200 carries `Content-Disposition: inline;
swaggerDownload="attachment"; filename="{species}.json"`.

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
