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
