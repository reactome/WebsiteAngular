# Research: Cache headers for the content API

Measured 18 Oct 2026 from the code (`tools/content-node/service.mjs`, line numbers as of `main` at c897ffb6), from Java's published API description, from the recorded e2e traffic (`e2e/har/`), from 4 requests to beta, and from Cloudflare's documentation. Each Cloudflare claim cites its page; the quotes came through a summariser, so they are checked again before anything relies on them (T001).

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
- **A one-year `s-maxage`:** no maximum is documented. If Cloudflare caps it, the cost is a re-fetch, nothing worse.
- **Today's headers:**
  - Node sends no `Cache-Control`, only Express's weak ETag. That stays, and Cloudflare revalidates with it.
  - nginx adds and strips nothing: no `add_header`, `proxy_hide_header`, `expires` or `proxy_cache` in `deploy/nginx`. `gzip` is on without `gzip_vary`.
  - Measured on beta: `/data/diseases` gives 200 with a weak ETag, and the same ETag in `If-None-Match` gives 304.
- **Settings in the Cache Rule itself,** which is not ours to make (added to #527):
  - **Edge TTL:** "use cache-control header if present". An Edge TTL override would override `s-maxage`.
  - **Browser TTL:** "respect origin". Cloudflare otherwise "respects whichever value is higher" of its own Browser TTL, 4 hours by default, and our `max-age` ([edge and browser TTL](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/)).
  - **No "status code TTL"**, which would override the origin.
  - **"Sort query string" on.** On Free it is a cache-key option, so parameter order stops mattering.
- **Vary is ignored by Cloudflare** "by default" ([vary](https://developers.cloudflare.com/cache/concepts/vary/)), so none is sent.
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
| Query value: integer             | `0` or `-?[1-9]\d*`, within the endpoint's range                                                                                                                  |
| Query value: enum                | one of its values, exactly                                                                                                                                        |
| Query value: text                | anything (search terms)                                                                                                                                           |

- **Trailing slash:** both forms are standard. The site sends both, and it adds at most one more spelling per answer.
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

**Defaults to confirm with awright** (listed in the plan):

- the versioned-stId bound;
- `REACT_` ids;
- the caps on `rows` and `pageSize`;
- that free-text search answers are cacheable.

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
