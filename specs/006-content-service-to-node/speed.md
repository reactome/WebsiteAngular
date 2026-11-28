# How fast node answers, compared with Java

Measured on 13 November 2026. By then node answered every ContentService
operation that was going to move to it: spec 006 tasks T001–T108. T110 (ORCID)
waits for a later decision.

## In short

- **Node is about three times faster on single requests.** Across 654 requests,
  the geometric mean of node's time over Java's is **0.35**. Node was faster on
  504, about the same (within 10%) on 84, and slower on 66.
- **The biggest gains are where the site spends most of its time.**
  - Loading a pathway in the Pathway Browser (`/data/query/enhanced/v2`) is
    about 3× faster as a rule, and 10–20× on the largest pathways.
  - An event's ancestors, a person's pages, the species lists and schema counts
    are 30–100× faster.
- **Node is slower at search and at the Reacfoam tree.**
  - Search is about 1.3× slower alone, and much slower under load.
  - The Reacfoam tree (`/data/eventsHierarchy`) takes about 155 ms, where
    Java's cached answer takes about 12 ms.
- **Under load, the result depends on search.** With 8 clients at once, node
  answered about 15% fewer requests per second than Java on a mix including
  search. Leave search out, and node answered **47% more requests per second**,
  with a far tighter worst case.

## How it was measured

- **Same machine, same data.** Both services ran on the same machine, against
  the same graph database (release 98). Each request went straight to the
  service's own port, so the network, nginx and the CDN are not in the figures.
- **The requests:** 654 in all.
  - 523 are the requests the site really makes, taken from the end-to-end
    recordings (`e2e/har`).
  - 131 more cover every node route the recordings miss, with ids from Java's
    documented examples, including the heaviest answers.
  - Only requests that both services answer with the same status were kept.
- **Timing.**
  - Each request had one untimed warm-up pair, then five timed pairs, sent
    alternately to Java and node (J, N, J, N…). That way any background load
    falls on both alike.
  - Requests ran one at a time, each on a fresh connection without
    compression, timed to the last byte. The figure for a request is the median
    of its five.
- **Load during the run.** The machine was not idle. A test run was going
  during the timed requests (load average about 1.3–3.1 on 8 cores), and the
  warm-up pass overlapped a full pre-push check. Alternating Java and node
  request by request puts that load on both alike, so it blurs the times more
  than it favours either side. The 20 slowest requests were measured again
  afterwards (load about 1.7–3.0) and 19 gave the same results. The exception
  was a static citation (`/citation/static/29186351`), which took about 4.6 s
  on both the first time and 1.9 s on Java against 0.1 s on node the second:
  it waits on an outside service, so its times say little about either
  implementation.
- **The concurrency test.** 8 clients sent a mix of 10 typical site requests for
  30 seconds to each service in turn, Java first and then node first, and again
  without the two search requests.

## The figures

|                                           | Java    | node    |
| ----------------------------------------- | ------- | ------- |
| A typical request (median of the medians) | 45.5 ms | 10.5 ms |
| The first request (median)                | 89 ms   | 16 ms   |
| All 654 requests, one after another (sum) | 164 s   | 78 s    |
| Geometric mean of node / Java             | —       | 0.35    |
| Of the site's own requests (523)          | —       | 0.29    |

### By family of endpoints

`n` is the number of requests. The times are medians, and p95 is the time 95%
of requests came in under.

| Family                                                | n   | Java       | node   | node / Java | Java p95 | node p95 |
| ----------------------------------------------------- | --- | ---------- | ------ | ----------- | -------- | -------- |
| `/data/query/enhanced/v2/{id}` (the Pathway Browser)  | 210 | 76 ms      | 28 ms  | 0.36        | 950 ms   | 116 ms   |
| `/data/event/{id}/ancestors`                          | 90  | 163 ms     | 4.5 ms | 0.03        | 207 ms   | 6.4 ms   |
| `/data/detail/{id}/locationsInPWB`                    | 46  | 6.7 ms     | 5.2 ms | 0.77        | 24 ms    | 23 ms    |
| `/search/query`                                       | 28  | 50 ms      | 67 ms  | 1.33        | 657 ms   | 867 ms   |
| `/data/query/{id}`                                    | 16  | 11 ms      | 7.9 ms | 0.69        | 23 ms    | 14 ms    |
| `/data/eventsHierarchy/{species}` (Reacfoam)          | 10  | 75 ms      | 169 ms | 2.25        | 900 ms   | 322 ms   |
| `/search/suggest`                                     | 9   | 19 ms      | 24 ms  | 1.22        | 25 ms    | 32 ms    |
| `/exporter/diagram/{id}` (images)                     | 8   | 102 ms     | 9.7 ms | 0.10        | 598 ms   | 36 ms    |
| `/data/person/{id}` and its lists                     | 13  | 195–351 ms | 4–8 ms | 0.01–0.03   |          |          |
| `/data/species/main`, `/all`                          | 2   | ~155 ms    | 1.4 ms | 0.01        |          |          |
| `/data/schema/{class}/count`                          | 3   | 157 ms     | 3.7 ms | 0.02        |          |          |
| `POST /interactors/static/molecules/details`          | 3   | 420 ms     | 54 ms  | 0.13        |          |          |
| `/data/detail/{id}/getSubGraph`                       | 3   | 182 ms     | 157 ms | 0.86        | 9.9 s    | 7.6 s    |
| `/data/pathways/low/diagram/identifier/{id}/allForms` | 2   | 8.1 s      | 1.3 s  | 0.16        |          |          |
| `/exporter/document/event/{id}` (PDF)                 | 2   | 2.7 s      | 1.8 s  | 0.66        |          |          |
| `/data/discover/{id}`                                 | 2   | 26 ms      | 78 ms  | 2.98        |          |          |

**Much the same on both** (0.87–1.06): complexes, the reference mappings,
reference molecules and sequences, diseases and people by name. Some of these
wait on the same external service on both sides (the reference mappings and
static citations), so they don't measure either implementation.

### The largest single gains

| Request                                                           | Java   | node   |
| ----------------------------------------------------------------- | ------ | ------ |
| `/data/pathways/low/diagram/identifier/P60484/allForms?species=…` | 16.0 s | 2.35 s |
| `/data/query/enhanced/v2/R-HSA-5673001` (330 KB)                  | 7.75 s | 0.38 s |
| `/data/query/enhanced/v2/R-HSA-1257604`                           | 5.48 s | 0.27 s |
| `/data/query/enhanced/v2/R-HSA-212436`                            | 1.85 s | 0.17 s |
| `/data/species/main`                                              | 156 ms | 1.4 ms |
| `/data/person/69596/reviewedReactions`                            | 351 ms | 4.0 ms |

### Where node is slower

| Request                                                    | Java   | node   |
| ---------------------------------------------------------- | ------ | ------ |
| `/data/eventsHierarchy/9606?pathwaysOnly=true` (561 KB)    | 12 ms  | 156 ms |
| The same tree with an analysis token (829 KB)              | 55 ms  | 246 ms |
| `/search/query?query=TP53&types=Protein&rows=500` (251 KB) | 1.73 s | 3.01 s |
| `/search/query?query=P04637&types=Icon` (204 KB)           | 15 ms  | 61 ms  |
| `/data/discover/R-HSA-1643685`                             | 20 ms  | 75 ms  |

### Under load: 8 clients for 30 seconds

No errors and no "busy" answers on either side.

| Mix                      | Service | Requests/s | Median | p95        | Worst       |
| ------------------------ | ------- | ---------- | ------ | ---------- | ----------- |
| 10 typical requests      | Java    | 77–79      | 48 ms  | 346–352 ms | 618–652 ms  |
|                          | node    | 65–68      | 53 ms  | 457–497 ms | 972–1186 ms |
| The same, without search | Java    | 92         | 35 ms  | 325 ms     | 569 ms      |
|                          | node    | **134**    | 54 ms  | **126 ms** | 211 ms      |

## What would close the gaps

- **Search under load.** Node sends at most two requests to Solr at once
  (`SOLR_CONCURRENCY`, default 2, in `tools/content-node/solr.ts`) and queues
  the rest. Under load, its search suggestions went from 23 ms to a median of
  about 400 ms, where Java's stayed near 18 ms. Raising that limit is the likely
  fix; it was not tested here. (It helped: see
  [search under load, since](#search-under-load-since-952).)
- **The Reacfoam tree.** Node keeps each species' tree in memory, but appears to
  write the 561 KB answer afresh on each request. Java serves a cached answer.
  Keeping the written answer would likely close the gap. (It was not the
  cause: see [the Reacfoam tree, since](#the-reacfoam-tree-since-952).)
- **The light endpoints under load.** Node's light endpoints rise evenly to a
  median of about 38–60 ms under 8 clients, a sign of queueing in its single
  process. Running more than one process would spread that.

## Since then

### The Reacfoam tree, since (#952)

Node already kept the written answer, per species, from the first request
(T103b, T103d). The time went on a question asked before it: whether the
species has a top-level pathway at all. The graph answers that by walking every
`species` edge into the species, about 150 ms for human. That answer is now
kept per species too, for as long as the trees are (until the service
restarts, which the release switch does), at most one boolean per species: 97
in release 98.

Measured on 27 November 2026, as above (requests straight to a node started on
its own port, each on a fresh connection without compression), before and after
the change. Load average about 1.5–2.2 on 8 cores.

| `/data/eventsHierarchy/…`, one at a time (20 each) | Before median | p95    | After median | p95    |
| -------------------------------------------------- | ------------- | ------ | ------------ | ------ |
| `9606?pathwaysOnly=true` (561 KB)                  | 155 ms        | 176 ms | **7.3 ms**   | 9.2 ms |
| `10090?pathwaysOnly=true`                          | 155 ms        | 172 ms | 5.7 ms       | 6.9 ms |
| `9606?pathwaysOnly=true&token=…` (an analysis)     | 208 ms        | 222 ms | 60 ms        | 65 ms  |
| `9606`, the full tree (3.9 MB)                     | 175 ms        | 191 ms | 27 ms        | 34 ms  |

Java took about 12 ms for the first and 55 ms with a token (above).

| 8 clients, 20 seconds                    | Requests/s    | Median      | p95          | Worst        |
| ---------------------------------------- | ------------- | ----------- | ------------ | ------------ |
| The tree alone (three species)           | 25 → **270**  | 316 → 28 ms | 404 → 41 ms  | 633 → 69 ms  |
| 10 typical requests, the tree among them | 100 → **150** | 15 → 14 ms  | 313 → 270 ms | 421 → 381 ms |

In the mix, the tree itself went from a median of 306 ms to 17 ms; what is left
of the mix's p95 is search (below). No errors in any run.

**The same answers.** 375 requests — every species by taxId, by dbId and by
name, both forms of the tree for each species that has one, the errors (no
species, a number past a long, a bad Boolean, no top-level pathway) and 14
with analysis tokens — gave the same status, `Content-Type`,
`Content-Disposition`, `Cache-Control`, `X-Cache-Rule`, `ETag`,
`Content-Length` and body (by SHA-256) before and after, both on the first
request and from the cache.

**What is left.** Writing the kept answer costs about 1.3 ms a request for the
561 KB tree: encoding it to UTF-8 bytes and Express's ETag over them. Keeping
the bytes as well would change the path every answer is written by, for about
a millisecond, so it was left.

### Search under load, since (#952)

Node asks Solr at most `SOLR_CONCURRENCY` requests at once and queues the rest
(at most 64; past that, a 503 to retry). The limit keeps a burst of typing, or
of clients, from landing on the shared Solr all together: the search box asks
on every keystroke, and each suggestion is one request to Solr plus one per
collation. It was two, as Java's client holds. It is now **eight**.

Measured on 27 November 2026, after the change above, against a node started on
its own port with each limit in turn, runs a minute or more apart: one request
at a time (20 each), then 8 clients for 15 seconds asking for suggestions
alone (15 different prefixes), then 8 clients for 20 seconds on a mix of 10
typical requests, two of them search. The first run at 2 had the machine at a
load of about 7 (other work); it was run again at about 2, as the others were,
and those are the figures below. No errors, no 503s and no timeouts in the
service's log at any limit. One request in the first run at 8 came back other
than 200, unnamed by that version of the script; the run repeated with each
failure named had none, and the figures for 8 are the repeat's.

| `SOLR_CONCURRENCY` | Suggest alone (median) | Suggest, 8 clients: req/s, median, p95 | Mix: req/s | Suggest in the mix: median, p95 | `/search/query` in the mix: median, p95 |
| ------------------ | ---------------------- | -------------------------------------- | ---------- | ------------------------------- | --------------------------------------- |
| 2 (before)         | 24 ms                  | 142, 57 ms, 79 ms                      | 154        | 178 ms, 307 ms                  | 206 ms, 335 ms                          |
| 4                  | 24 ms                  | 168, 47 ms, 70 ms                      | 193        | 91 ms, 154 ms                   | 139 ms, 209 ms                          |
| **8**              | 20 ms                  | 176, 45 ms, 67 ms                      | **196**    | **76 ms**, 125 ms               | 134 ms, 179 ms                          |
| 16                 | 22 ms                  | 185, 43 ms, 62 ms                      | 196        | 78 ms, 121 ms                   | 131 ms, 172 ms                          |

- **Eight is where it levels off.** From two to eight, the mix served about a
  quarter more requests a second, and the suggestions in it waited less than
  half as long. Sixteen did no better on the mix, so the smaller of the two
  keeps more of the queue's protection.
- **Alone, a search is no faster or slower** at any limit (20–24 ms for a
  suggestion, about 67 ms for `/search/query`): Solr itself was not slowed by
  more at once, as far as node's own times show. Solr's own metrics need
  credentials this measurement did not use.
- **The gap to Java is smaller, not closed.** Java's suggestions stayed near
  18 ms under its mix; node's are now about 76 ms in this one. The rest of
  node's mix rises too (a median of about 20 ms), the queueing of its single
  process noted above.
- **Set where the other settings are:** the default is in
  `tools/content-node/settings.ts`; `SOLR_CONCURRENCY` in the environment or
  the credentials file still overrides it, 1–16.

## Caveats

- **Caching.** Java's Spring caches probably explain its fast Reacfoam tree.
  Node caches some answers too: the database name and info, the content pages'
  contents, the PSICQUIC resources, the Reacfoam trees and the expression data.
  The timed requests all came after a warm-up, so both sides were warm; a cold
  start shows only in the single first request.
- **Few requests in some families.** Many families rest on one to three
  requests, so their figures are indications, not measurements.
- **The image exporters don't make the same files.** Node's images are drawn
  differently (for R-HSA-177929, its PNG is 3.5 MB against Java's 0.56 MB), so
  those timings don't compare like with like.
- **Requests left out.** Thirteen requests were left out because the two
  services answered with different statuses: Java doesn't serve
  `/expression/{id}` or `/openapi.json`, and node redirects the Reacfoam image
  exports.
