# Caching and parameter conformance

The design decision behind how the node content service will be cached, and the
measurements it rests on. Written down because the reasoning is not recoverable
from the code: several of the choices below exist because a probe came back the
opposite of what was expected.

Status: **built** (spec 011, `specs/011-api-cache-headers`), but caching nothing yet: the labels are on every answer node gives, and Cloudflare stores nothing until its Cache Rule is on (#527). What each answer carries, and why: [contracts/cache-labels.md](../../specs/011-api-cache-headers/contracts/cache-labels.md). The work queue is at the bottom.

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
not a 4xx. The port kept it: every ported endpoint answers byte-identically
to Java, errors included, and a 500 is `no-store` like any other error.

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

### Four constraints on it

1. **`token` is never cacheable**, however well-formed the URL. Analysis results
   are per-user; a shared-cache HIT serves one person's submission to another.
   Those get `private, no-store` unconditionally.
2. **No cache on our server.** Cloudflare does the caching; node only says,
   per response, whether it may be stored (decided by awright, 18 Oct 2026).
   An origin-side cache was considered, so a bot appending `?x=<random>`
   would cost a hop instead of a query; it is not worth the moving part.
   Deliberate busting is the rate-limiting rule's job (below). What an edge
   cache needs instead is a way to drop the previous release's answers: a
   `max-age` no longer than the time between releases allows, or a purge on
   release day -- to be settled when the headers are built.
3. **Our own client must emit canonical URLs** — stable parameter order, nothing
   extraneous — or the app itself lands on the slow path. The Angular services
   have not been audited for this yet.
4. **The bare roots are the site, not the API.** `/ContentService`,
   `/ContentService/`, `/AnalysisService` and `/AnalysisService/` serve the
   application's API page (its `index.html`, sent `no-cache`). A cache rule over
   `/ContentService/*` must respect the origin there rather than set an edge
   TTL, or it stores the application shell under an API address and serves a
   page whose scripts no longer exist after the next deploy.

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

### A path has one form

The query string is tolerated, because real links carry `?utm_source=` and the
like. The path is not: a matrix parameter (`/data;jsessionid=x/diseases`) is
Spring's 404, though Java would drop it and answer. Nothing sends one on
purpose -- `jsessionid` was how old Java servers tracked a session without
cookies, and this API has no sessions -- and every way of writing a path is
one more URL to cache or to bust it with. Decided by awright, 18 Oct 2026
(spec 006 T008). An encoded `;` (`%3B`) is part of an id, as it is to Java.

### Rejected, and why

- **Rejecting unknown parameters with a 400.** Breaks consumers we cannot
  enumerate. The likeliest casualties are not bots but shared links carrying
  `?utm_source=` or `?fbclid=`, and whatever FIViz, ReactomeGSA or a curator's
  script appends. The failure would be silent for months. Strip-and-serve gets
  the same benefit with none of the risk.
- **A cache on our server** -- constraint 2 above.
- **A Cloudflare plan upgrade.** If edge caching with per-path allowlists turns
  out to matter, paid **Workers** ($5/month,
  10M requests) buys custom cache keys — a rounding error against the EC2 bill,
  and a smaller step than an Enterprise plan.
- **Neo4j being the bottleneck because it "only does one query at a time".**
  It does not; Community Edition is multi-threaded. What it lacks is clustering
  and read replicas. The constraint is horizontal read scaling, which is what
  makes the edge cache and precomputed files the high-leverage moves.

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

1. ~~**Parameter schema** per endpoint~~ — `parameters.mjs`, held to Java's
   published description (#530).
2. ~~**Invalid inputs against Java**~~ — `invalid-inputs.mjs`; 309 of 328
   identical, the rest declared (#530).
3. ~~**`Cache-Control` headers**~~ — `cache-label.mjs` (#531); one URL per answer
   (#532); the site's own requests in standard form (#533); release day: purge,
   then `warm.mjs`.
4. **Cloudflare**: the rate-limiting rule first (no origin change needed), then
   URL normalization, incoming and to origin (#527), then the Cache Rule once
   the origin emits headers.
