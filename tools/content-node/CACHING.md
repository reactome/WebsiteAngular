# Caching and parameter conformance

The design decision behind how the node content service will be cached, and the
measurements it rests on. Written down because the reasoning is not recoverable
from the code: several of the choices below exist because a probe came back the
opposite of what was expected.

Status: **decided, not yet built.** The work queue is at the bottom.

## The question

The backend is hit heavily by bots. Neo4j is Community Edition, so reads cannot
be scaled horizontally without a database per machine. Caching is the obvious
lever, and the obvious objection is query parameters: the ones we send, and the
ones a bot appends to bust a cache or to probe for an injection.

## What was measured

**Cloudflare caches the site's assets, and none of the API.** Both halves of a
disagreement about this turned out to be true of different traffic:

|                                                |                                                           |
| ---------------------------------------------- | --------------------------------------------------------- |
| `templates/.../citation.png`                   | `cf-cache-status: HIT`, `age: 1510`, `max-age=14400`      |
| Website HTML                                   | `DYNAMIC` — origin sends `no-store, no-cache`             |
| `/ContentService/data/*` (3 paths, twice each) | `DYNAMIC` every time                                      |
| `/AnalysisService/*`                           | `DYNAMIC`                                                 |
| `download.reactome.org`                        | no `cf-cache-status` at all — CloudFront, a different CDN |

The API is uncached for a mechanical reason, not a misconfiguration: Cloudflare
caches a fixed list of static extensions by default and treats everything else
as dynamic unless a Cache Rule says otherwise, and the Java service sends no
`Cache-Control` at all. Two things are missing and both are needed.

**The parameter surface is smaller than the spec suggests.** Of 84 GET
operations, `view` and `includeRef` are declared on all 84 — they are spec-wide
boilerplate. Subtracting them:

|                                         |                         |
| --------------------------------------- | ----------------------- |
| Parameter-free operations               | **50**                  |
| Operations with parameters of their own | 34                      |
| Operations carrying an analysis `token` | 5, plus all 4 exporters |

**Unknown parameters are silently ignored.** Every one of these returned a
byte-identical response to the bare URL:

    ?view=DETAIL   ?junk=1   ?cachebust=<random>   ?id=' OR '1'='1

So injection is not a caching problem: Spring binds only declared parameters,
and declared values reach Cypher as bound parameters. A cache in front of an
injection-proof origin is still injection-proof. But cache-busting works
perfectly — those identical responses would occupy unlimited distinct cache keys.

**Bad values on declared parameters are already rejected.**

    ?page=abc → 400      ?page=-1 → 400      ?offset=99999999 → 400
    ?species=abc → 404

This is the finding the design turns on. Validating declared values is _parity_
with the Java service, not a new contract — so it carries no compatibility risk.
Rejecting _unknown_ parameters would be a contract change, because they return
200 today.

**A parameter that is declared is not necessarily honoured.**

    /data/pathways/top/9606              → 12191 bytes
    /data/pathways/top/9606?species=48887 → identical

`species` matters on some paths and is ignored on others. There is no safe
global rule about which parameters belong in a cache key; it is per endpoint.

**One defect found in passing:** `/data/schema/NotAClass/count` returns **500**,
not a 4xx. The port should fix this rather than reproduce it — a 500 on user
input pollutes error monitoring and hands anyone a cheap exception generator.
This is a deliberate, documented divergence from "Java is the reference".

## The decision

Cloudflare is on the **free plan**, so custom cache keys (Enterprise) are not
available. That ruled out the first design, which was to strip junk parameters
into a canonical cache key at the edge.

The policy adopted instead, in awright's words: _"have the proper urls be cached
and not the ones that don't conform. In this way a user doing the proper thing
would get cached results (fast) and if they don't it would not break but it
would be slower."_

This removes the need for the Enterprise feature entirely. If junk is never
cached, there is nothing to strip, and Cloudflare's **default** cache key —
which includes the query string — becomes exactly correct: conforming URLs with
meaningful parameters get properly separate entries.

Two layers, split by what each can cheaply know:

- **The edge decides eligibility.** A Cache Rule over the API path prefixes, set
  to respect origin TTL. Free supports cache eligibility and Edge TTL; only the
  custom cache key is gated, and it is no longer wanted.
- **The origin decides conformance, per request.** Node validates against the
  parameter schema and says so in the response:
  - conforming → `Cache-Control: public, max-age=…` → stored, later requests HIT
  - non-conforming → `Cache-Control: no-store` → served correctly, never stored

Right thing is fast; wrong thing still works and is slower. It is self-enforcing
without breaking anyone into compliance.

### Three constraints on it

1. **`token` is never cacheable**, however well-formed the URL. Analysis results
   are per-user; a shared-cache HIT serves one person's submission to another.
   Those get `private, no-store` unconditionally.
2. **Keep an origin-side cache anyway.** A bot appending `?x=<random>` bypasses
   the edge _by design_ here, so the policy alone does not shield Neo4j from
   deliberate busting. If node normalises internally and answers from its own
   cache while still telling Cloudflare not to store, the slow path costs one
   hop rather than one database query. Edge cache for conforming, origin cache
   for everything, Neo4j for neither. Stamp entries with the release number
   (`/data/database/version`, already ported) so they self-invalidate and no
   purge step is needed on release day.
3. **Our own client must emit canonical URLs** — stable parameter order, nothing
   extraneous — or the app itself lands on the slow path. The Angular services
   have not been audited for this yet.

### What this does not fix

Volume. Bot load is overwhelmingly requests to _valid_ URLs — crawling every
stId — and validation removes none of them; a 400 still costs a connection, a
TLS handshake and a thread. That is what the free plan's single **rate-limiting
rule** is for, aimed at the API paths. Rate limiting protects the box;
validation and caching protect Neo4j. They are independent, and the rate-limit
rule needs no origin changes, so it is available today.

Also worth using on Free, in descending value: Bot Fight Mode, and 3 legacy Page
Rules (`Cache Everything` + `Ignore Query String`) spent on the busiest
parameter-free prefixes.

### Rejected, and why

- **Rejecting unknown parameters with a 400.** Breaks consumers we cannot
  enumerate. The likeliest casualties are not bots but shared links carrying
  `?utm_source=` or `?fbclid=`, and whatever FIViz, ReactomeGSA or a curator's
  script appends. The failure would be silent for months. Strip-and-serve gets
  the same benefit with none of the risk.
- **A Cloudflare plan upgrade.** If edge caching with per-path allowlists turns
  out to matter after the origin cache is in place, paid **Workers** ($5/month,
  10M requests) buys custom cache keys — a rounding error against the EC2 bill,
  and a smaller step than an Enterprise plan.
- **Neo4j being the bottleneck because it "only does one query at a time".**
  It does not; Community Edition is multi-threaded. What it lacks is clustering
  and read replicas. The constraint is horizontal read scaling, which is what
  makes an origin cache and precomputed files the high-leverage moves.

### Still open

- **GraphQL vs the 1:1 REST port** is undecided. Everything above is the layer
  either would sit on, so it is not blocked on that choice.
- **Precomputing enumerable data to the bucket** — top-level pathways per
  species, event hierarchies, diagram JSON. `download.reactome.org` is
  CloudFront, already correctly cached, and a file has no query string to bust.
  Strictly better than caching a query, for anything stable between releases.
- **Production access logs.** This host is `dev.reactome.org`; production API
  traffic never reaches it, so how bots actually shape their query strings is
  unmeasured. Those logs contain client IPs — awright to pull or point at them.
- **Verify in the Cloudflare dashboard**: whether a Cache Rule already exists
  for some path pattern, whether the API paths are deliberately excluded, and
  that respect-origin-TTL is settable on Free.

## Work queue

1. **Parameter schema** per endpoint — name, type, range, default — seeded from
   the OpenAPI spec.
2. **Extend `diff.mjs` to invalid inputs** (`page=abc`, `page=-1`,
   `offset=99999999`, `species=abc`). Parity on the error paths has to be proven
   before the conformance decision can be trusted; today the harness only walks
   happy paths.
3. **`Cache-Control` layer** driven by the schema, with the `token` exclusion.
4. **Origin response cache**, keyed on the normalised parameters and stamped
   with the release number.
5. **Cloudflare**: the rate-limiting rule first (no origin change needed), then
   the Cache Rule once the origin emits headers.
6. Fix the `schema/{className}` 500.

Nothing here touches beta. Endpoints go live only when listed in
`CONTENT_NODE_PATHS` in `proxy.conf.js`, which is empty.
