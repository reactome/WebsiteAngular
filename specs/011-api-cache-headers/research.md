# Research: Cache headers for the content API

Measured 18 Oct 2026 from the code (`tools/content-node/service.mjs`, line numbers as of `main` at c897ffb6), from Java's published API description, from the recorded e2e traffic (`e2e/har/`), from 4 requests to beta, and from Cloudflare's documentation. Each Cloudflare claim cites its page, and each was checked against it on 18 Oct 2026 (T001).

## R1. Where one labelling step sees every answer

**Decision**: deny by default, upgrade in one place.

1. The first `/ContentService` middleware (the CORS one, ~8053) sets `Cache-Control: no-store` on every response before anything else runs. If the request carries a `token` query parameter, it sets `private, no-store` instead.
2. `answer()` (~8259) upgrades the label to cacheable. Every endpoint answer passes through it, including the URIError handler's second route in. Before `writeResult`, it upgrades only when all of these hold:
   - the method is GET or HEAD;
   - the status is 200;
   - there is no token;
   - the endpoint isn't one that is never cached;
   - the request as sent (`request.originalUrl`) is in standard form for `endpoint.path`.

**Rationale**:

- **Everything else is written without the endpoint in hand,** so it keeps the default:
  - OPTIONS (~8059) and the Tomcat-style 400 (~8068), both written outside `writeResult`;
  - every `springNotFound` (`//`, a raw `;`, the catch-all);
  - the 405s;
  - the deep-query 503 (8246);
  - the last error handler.
- **`/health` (~8104)** isn't under `/ContentService`, and nginx never forwards it.
- **304s keep the label.** Express turns a fresh conditional GET into a 304 inside `send`, after the headers are set.
- **HEAD gets the same label.** Express runs the GET route for HEAD.
- **Streams and redirects:** there are none.
- **`request.originalUrl` is required:** the routing middleware rewrites `request.url` (it decodes letters and re-cases `/query/{id}/STID`). Read through it, non-standard spellings would look standard.

**Alternatives considered**:

- Labelling in `writeResult` (7998): it has the status but not the endpoint. `endpointFor` (4024) is a first-match regex, not the route that answered.
- A `writeHead` hook: it sees 304s as 304, and it fires for the writes outside `writeResult` too. That is more cases to get right, for no gain.

## R2. Header values

**Decision**:

| Label      | `Cache-Control`                           |
| ---------- | ----------------------------------------- |
| cacheable  | `public, max-age=3600, s-maxage=31536000` |
| not stored | `no-store`                                |
| private    | `private, no-store`                       |

The API page roots also get `no-store` (R7). The rule that decided the label goes out in a response header, `X-Cache-Rule` (FR-009).

**Rationale**:

- **`s-maxage` overrides `max-age` in shared caches,** so Cloudflare keeps the answer until the release purge while browsers keep it an hour. ([cache-control](https://developers.cloudflare.com/cache/concepts/cache-control/): "overrides the maximum age specified by either the `max-age` directive or the `Expires` header".)
- **`private`** "must not be stored by a shared cache like Cloudflare".
- **`no-store`:** "Will not cache".
- **`no-cache` is avoided.** Cloudflare's pages disagree on whether it is stored: [cache-control](https://developers.cloudflare.com/cache/concepts/cache-control/) says "caches and always revalidates", while [default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/) says it is not cached.
- **A one-year `s-maxage`:** no maximum is documented for either TTL. If Cloudflare caps it, the cost is a re-fetch, nothing worse. (Free's _minimum_ Edge Cache TTL, 2 hours, applies to a TTL set in a rule, not to ours.)
- **Today's headers:**
  - Node sends no `Cache-Control`, only Express's weak ETag. That stays, and Cloudflare revalidates with it.
  - nginx adds and strips nothing: no `add_header`, `proxy_hide_header`, `expires` or `proxy_cache` in `deploy/nginx`. `gzip` is on without `gzip_vary`.
  - Measured on beta: `/data/diseases` gives 200 with a weak ETag, and the same ETag in `If-None-Match` gives 304.
- **Settings in the Cache Rule itself,** which is not ours to make (added to #527):
  - **Edge TTL:** "Use cache-control header if present, bypass cache if not". The other option, "…use default Cloudflare caching behavior if not", would cache every Java answer, which carries no header, on Cloudflare's default TTLs. "Edge Cache TTL Cache Rules override `s-maxage` and disable revalidation directives if present" ([cache-control](https://developers.cloudflare.com/cache/concepts/cache-control/)).
  - **Browser TTL:** "respect origin". Cloudflare otherwise replaces an origin `max-age` that "is less than the Browser Cache TTL Cloudflare setting", 4 hours by default, so our 1 hour would become 4 ([edge and browser TTL](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/)). "Browsers ignore `s-maxage`."
  - **No "status code TTL"**, which would override the origin.
  - **"Sort query string" on.** On Free it is a cache-key option, so parameter order stops mattering.
- **No Vary is sent.** Cloudflare's key is the URL and "a handful of specific headers", and "a response containing `Vary: *` always bypasses cache" ([vary](https://developers.cloudflare.com/cache/concepts/vary/)), so none is added.
- **HEAD shares the GET's cache entry:** Cloudflare "converts `HEAD` requests to `GET` requests for cacheable requests".

**Alternatives considered**:

- A one-day lifetime with no release step. Rejected by awright: keep until cleared, and purge at each release.
- `no-cache` for "not stored". Rejected because of the documentation conflict above.

## R3. The parameter record

**Decision**: a separate module, `tools/content-node/parameters.mjs`, keyed by node's endpoint path, records for every GET endpoint:

- its path variables, each with its kind;
- its query parameters, each with its type, default, whether it is required, range or values, and whether Java declares it but ignores it;
- a `cache` override where an endpoint is never cached.

It is checked against a snapshot of Java's published API description, taken the way the schema snapshots are.

**Measured**:

- **Java's description:** OpenAPI 3.0.1, at `/ContentService/v3/api-docs`. A copy recorded on 2 Oct sits in the e2e fixtures and is byte-identical to a live fetch.
- **No ranges:** the description gives no minimum or maximum for any parameter, so ranges come from the code.
- **Matching:** 73 of node's 81 GETs match a documented operation. The other 8 have no operation:
  - three are `/query/{id}/{attributeName}` forms that take no parameters;
  - five are undocumented controllers: `detail/{id}/locationsInPWB`, `search/diagram/summary`, and the three `citation/*`.
- **Parameter names agree:** on every documented operation, node reads exactly Java's set. The one exception is `types` on `search/diagram/{d}/occurrences/{i}`, which Java binds and never uses.
- **Endpoints without parameters:** 46 endpoints take none of their own.
- **`view` and `includeRef`:**
  - Declared on every GET; they do something on 11.
  - Java accepts any value: `view=DETAIL` means flatten, and `includeRef=foo` is false.
  - The site sends them where they do nothing (e.g. `event/{id}/ancestors`), so the record keeps them as declared-but-ignored.
- **Parameter names with spaces:** `Start row` and `Force filters` contain a space, as Java declares them and as the site sends `Start%20row`.
- **A correction to the spec:** `species` on `/data/pathways/top/{id}` is not declared there (the species is the path variable). CACHING.md's example is an undeclared parameter, which this policy labels "not stored".

**Rationale**: a module of its own keeps `service.mjs` (8,300 lines) from growing, and lets the validators be unit-tested. Checking it against Java's description keeps it from inventing or missing a parameter (FR-006).

**Alternatives considered**: reading the e2e fixture as the source. Rejected: it is a test recording, not a snapshot with a generator.

## R4. Standard forms

**Decision**: standard forms are no looser than what Java answers, and admit at most a bounded number of spellings per answer. Error statuses are never stored, so the record only has to stop aliases of a successful answer.

| Kind                             | Standard form                                                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Object id (stId or dbId)         | `R-[A-Z]{3}-[1-9]\d*`, optionally with a version of up to 3 digits; or a dbId `[1-9]\d{0,18}` in ASCII, within a Java long; or `REACT_[1-9]\d*` without a version |
| taxId (path or `species`)        | `[1-9]\d*`                                                                                                                                                        |
| Person                           | a dbId, or an ORCID `\d{4}-\d{4}-\d{4}-\d{3}[\dX]`                                                                                                                |
| Class name                       | an exact name from the schema snapshot                                                                                                                            |
| Attribute                        | an exact field name from the schema snapshot                                                                                                                      |
| Resource                         | an exact reference-database name, with no regular-expression characters                                                                                           |
| Accession or external identifier | `[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}`                                                                                                                                |
| GO id                            | `GO:\d{7}`                                                                                                                                                        |
| Icon id                          | `R-ICO-\d+`                                                                                                                                                       |
| PubMed id                        | `[1-9]\d*`                                                                                                                                                        |
| Query value: boolean             | `true` or `false`                                                                                                                                                 |
| Query value: integer             | `0` or `-?[1-9]\d*`, within the range Java accepts (e.g. `page` ≥ 1); no upper cap                                                                                |
| Query value: enum                | one of its values, exactly                                                                                                                                        |
| Query value: text                | anything (search terms)                                                                                                                                           |

- **Trailing slash:** never standard. A GET or HEAD for a node endpoint with a trailing slash is a `301` to the same URL without it, query string kept (R10).
- **Repeats:** a parameter may appear once, except a list parameter (`types`, `species` on search, `fields`, `compartments`, `keywords`), which may repeat.
- **Parameter order:** free. Bounded, and "Sort query string" removes it entirely.
- **Not standard** (answered, not stored):
  - padded, encoded or Unicode-digit ids, and dbIds with a version;
  - `Homo+sapiens` in a path;
  - Spring's other boolean spellings (`on`, `yes`, `1`);
  - hex or `+` integers.

**Measured** (how node resolves ids today, which these forms must not exceed):

- `resolveId` (4411) trims, cuts a version unless the id contains `:`, maps `REACT_` ids, and reads digits from any script as a dbId.
- `springPathLong` (5746) accepts whitespace, `+`, leading zeros and hex.
- The species in `pathways/top/{id}` is decoded twice.
- Padded ids can change the answer, not only repeat it: `needsIncoming` (5589) reads the raw id, so a padded id on the `enhanced` endpoints changes what it fetches.

**Decided by awright, 18 Oct 2026**:

- Versioned stable ids, with up to 3 version digits, are standard. So are `REACT_` ids.
- Page sizes (`rows`, `pageSize`, `rowCount`) have no cap: any value valid to Java is standard. Search terms are already unbounded (next point), so a cap would not keep the set finite.
- Search answers are cacheable for any search term.
- Only list parameters may repeat.

## R5. Endpoints never cached, whatever the URL

**Decision**: the record marks these `cache: 'never'` (or `'private'`):

| Endpoint                                     | Why                                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interactors/psicquic/resources`             | Re-read from an outside registry every 5 minutes (2278–2285).                                                                                       |
| `citation/static/{id}` and `citation/export` | Live Europe PMC data. On a Europe PMC failure, `citation/export` answers an empty 200 (3077), which would otherwise be cached until the next purge. |
| `citation/pathway/{id}`                      | Its `dateAccessed` is echoed into the body, and the site sends a new date every day, so caching it costs one entry per day for little reuse.        |
| `exporter/diagram/{id}`                      | Takes `token`, so `private`. It is not routed to node today.                                                                                        |

**Rationale**:

- **Release-bound data:** everything else is graph or Solr data, which changes only at a release.
- **No other inputs:**
  - No GET reads `Accept`, a cookie or the host for a 200 body. The host appears only in error bodies (`javaError`, 7189), which are never stored.
  - The search no-result report fires only on 404s, so caching 200s loses no report.

## R6. Parity on invalid inputs

**Decision**: extend the parity tooling with a corpus of invalid inputs for every declared parameter. It covers:

- a non-number where a number is expected, a negative or zero page, an offset past the end, and out-of-range numbers;
- an unknown enum value, an empty value, and an unknown species;
- Spring's alternative boolean spellings.

The corpus is run sequentially and spaced, a few hundred requests at most per run, against node on its own port and against Java.

**Rationale**: the label is only safe if node's answer to a bad value is Java's (FR-008). Today the harness walks only happy paths. The graph database is shared and has been overloaded by parity runs before, hence small, spaced runs.

## R7. The API page roots

**Decision**: `/ContentService` and `/AnalysisService`, with or without the slash, get `Cache-Control: no-store` from the site server (`serve-prod.js`, for the `API_PAGE` paths only). The Cache Rule's expression also leaves them out (#527).

**Measured**:

- nginx (`routes-core.conf` ~502–505) sends the four exact paths to the site.
- `proxy.conf.js`'s `API_PAGE` bypass, and `serve-prod.js`'s app fallback, serve them with `no-cache`.
- Node never sees them, so node can't label them.

## R8. The site's own requests

**Decision**: a passive `context.on('request')` classifier in the e2e fixture (`e2e/support/backend.ts`). It reports every ContentService request the site makes that isn't in standard form, without failing the run, like the existing `undeclared` check (~690–701). Each finding is then fixed in the site, or listed with its reason.

**Measured**:

- **Recorded traffic:** 413 recordings hold 3,953 ContentService requests, 473 of them distinct, covering 85 endpoint shapes.
- **Found so far:**
  - `enhanced/v2/{id}` is sent with two different parameter orders and sets (`data-state.service.ts:247–256`, `database-object.service.ts:31`).
  - The search component sends `fields=%20DB_ID`, with a leading space (`search.component.ts:324`).
  - `/search/fireworks/` is built with a trailing slash (`search.component.ts:276`).
  - Citations send today's date (`citation.service.ts:59`).
  - There are no cache-busters anywhere.
- **Excluded:** the `.api.json` sidecars are test probes, not site traffic, so they are left out.

## R9. Release day: purge and warm-up

**Decision**:

- At each release, Cloudflare's cache is purged by prefix, `/ContentService/`. Purge by prefix is on Free ([purge](https://developers.cloudflare.com/cache/how-to/purge-cache/): "URL, Hostname, Tag, Prefix, and Purge Everything").
- A warm-up script, `tools/content-node/warm.mjs`, then requests a fixed list of about 150–250 standard-form URLs once each, sequentially:
  - the species lists;
  - the content lists;
  - per species, the top-level pathways and the events hierarchy;
  - per top-level human pathway, the site's own `enhanced/v2` and `ancestors` requests, in the site's exact spelling.
- Smart Tiered Cache, which is on Free ([tiered cache](https://developers.cloudflare.com/cache/how-to/tiered-cache/)), lets that one warm-up fill the shared upper tier for every data centre.
- The step is written in `RELEASE-TESTING.md`'s "Post-release" section, as what to do, not how the release itself runs.

**Rationale**: there is no record of popularity in the repo, so the list is built from the site's own request shapes and the release's top-level pathways.

**Alternatives considered**: purging only what changed. Set aside, because a release changes the graph broadly (spec, Assumptions).

## R10. Trailing slash: one URL per answer

**Decision** (awright, 18 Oct 2026): a GET or HEAD for a node endpoint whose path ends in `/` is answered `301 Moved Permanently`, to the same path without the slash and with the query string kept as sent.

- **The redirect is never stored** (`no-store`, rule `redirect`; private with a token). Standard form cannot tell whether the URL a redirect points to exists, since any id of the right shape passes, so a stored redirect would be one cache entry per id anyone asks for (review of #532). A redirect costs node no query to answer again. Nor is a URL redirected whose `Location` would be another request: one with a raw `#`, which would become a fragment, or a malformed escape, which would be re-encoded. Those are answered as before, never stored.
- **POST is never redirected,** because some clients turn a redirected POST into a GET and lose its body. A POST is answered as today and never stored.
- **Where:** in node, before routing, and only for paths that match a node endpoint. nginx still sends the slashed form to node (spec 006 T006), and its routing test is unchanged. Paths Java still answers keep Java's behaviour until they are ported.
- **The site:** it sends two slashed URLs, `/search/fireworks/` (`search.component.ts:276`) and `/interactors/psicquic/resources/`. Both are changed to the unslashed form, so the site never pays the extra round trip.

**Rationale**: Java answers `/x` and `/x/` identically, so caching both would give one answer two entries. A redirect leaves one. This is a declared difference from Java, as the raw-`;` 404 is (#526): the slash means nothing.

**Alternatives considered**:

- Caching both forms: two entries per answer.
- Redirecting `/x` to `/x/`: Java's API description and the site use the unslashed form almost everywhere.
- Refusing the slash with a 404: it would break clients that add one, where a redirect costs a round trip.

## R11. The record on the site's own traffic (measured 18 Oct 2026)

The record takes a documented endpoint's query parameters from Java's description rather than restating them, so the two cannot drift. Run over every distinct ContentService GET that node answered 200 in the recorded e2e traffic, 388 of 412 are standard form. The other 24 are the site's, all for US5:

| Rule                | Count | What the site sends                                                                                                   |
| ------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| `form`              | 6     | `/search/fireworks/` and `/interactors/psicquic/resources/`, with a trailing slash                                    |
| `parameter:cluster` | 8     | `cluster=true` on `/search/facet_query`, which does not declare it                                                    |
| `parameter:diagram` | 4     | `diagram=…` on `/search/diagram/{diagram}`, which does not declare it (the spread parameters in the search component) |
| `parameter:scope`   | 4     | `scope=…` on `/search/diagram/{pathwayId}/flag`, which does not declare it                                            |
| `parameter:fields`  | 2     | `fields=%20DB_ID`, with a leading space                                                                               |

## R12. Invalid inputs against Java (run 18 Oct 2026)

**The corpus** (`tools/content-node/invalid-inputs.mjs`) had 328 requests: every declared parameter of every GET endpoint not marked never stored.

- **Values tried:** values Java would not take as written, plus an unknown species and integers past Java's `int` range.
- **Required parameters:** every request carries the endpoint's other required parameters, so the parameter being tried is reached. A first run left them out, and 138 of its requests stopped at the missing `query` or `page` (review of #530).
- **Objects:** real ones only.
- **Run:** against node on its own port and against Java, sequentially, in three batches with 30 seconds between.

| Verdict                              | Count |                                                                                                                                                                                                                                  |
| ------------------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Byte-identical                       | 309   |                                                                                                                                                                                                                                  |
| `query/enhanced/v2` in a nested view | 9     | The declared difference (routes-core.conf): identical as data, with getter-only keys in the JVM's order of the day. Jackson's `@id` numbers follow that order. The valid sample differs the same way, so no bad value causes it. |
| A Solr failure's 500                 | 10    | Declared in `fromSolr`. Java's message repeats Solr's internals: its server address, and the parameters it was sent. Node's says only "Solr exception occurred". Same status, and never stored.                                  |

No fix was needed (T007).

## R13. Where Java gives one answer to many spellings (reviews of #530)

Standard form narrows these past their declared type, because each would otherwise be a stored copy of one answer. The graph names it relies on are snapshotted in `graph-names.json` by `snapshot-graph-names.mjs`; a release adds names only when it is run again, and until then their URLs are answered but not stored.

- **`species`:** the taxId of a known species, on `/data/pathways/low/**`, `/data/mapping/**` and `/data/schema/{id}[/count|/min]`.
  - Java reads it leniently: a name in any case, `_` for a space, digits of any script, and a Species dbId as well as a taxId.
  - On `/pathways/low`, one it cannot find filters nothing. Measured on Java, `?species=1` and `?species=nosuchspecies` are byte-identical to no species, and `?species=48887` (the human Species dbId) to `?species=9606`.
- **The mapping resource:** a reference-database name exactly as the graph has it, encoded as `encodeURIComponent` writes it, e.g. `COSMIC%20(genes)`. Java finds it ignoring case.
  - `/data/complexes` uses its resource as a case-sensitive pattern, so another case is another answer; it keeps the plain pattern-free form.
- **GO ids:** `GO:\d{7}` for the GO resource on `/mapping/.../pathways`. Java cuts any identifier starting `go` to its digits.
- **`maxDepth`:** `-1` (no limit) or 1 to 10.
  - Every negative means no limit, and 0 means 1.
  - A depth past an object's own tree gives `-1`'s answer again, so larger depths are answered but not stored.
- **`attributes`:** one of the lists the site asks for, `species,compartment` (the default) or `species,compartment,referenceEntity`. Java joins the names into a relationship pattern, where an unknown name, another case or another order matches what the list without it matches.
- **`types` on `/search/diagram/{d}/occurrences/{i}`:** refused. Java binds it and never reads it.
- **Value encoding:** a value must be one encoding of what it decodes to, either strict or Angular's HttpParams, which leaves `@ : $ , ; = ? /` bare, exactly as Angular's `STANDARD_ENCODING_REPLACEMENTS` does. `%31` for `1`, `+` for a space, or `%21` for `!`, is not standard.
- **List items:** a list's item may not be given twice.

**Still bounded aliases, accepted:**

- `view` and `includeRef` where Java ignores them: the site sends them there (e.g. `ancestors`), and there are 3 × 2 spellings.
- A default given explicitly (`includeRef=false`).
- A list given as one value or repeated (`types=A,B`, `types=A&types=B`), and its order.
