# Feature Specification: Cache headers for the content API

**Feature Branch**: `spec/011-api-cache-headers`

**Created**: 2026-10-18

**Status**: Draft

**Input**: User description: "Cache headers for the node content service, so Cloudflare can cache the ContentService API (tools/content-node). Policy and measurements are in tools/content-node/CACHING.md. Cloudflare does all the caching; there is NO cache on our server. Node only labels each response: a request in its canonical form gets `Cache-Control: public, max-age=…`; anything else is still answered exactly as Java answers it but gets `Cache-Control: no-store`, so the set of cached URLs stays finite. Anything carrying an analysis `token` is `private, no-store` always. The bare roots must not get an edge TTL. Bodies stay byte-identical to Java; only headers change. Needs a per-endpoint parameter schema, parity on invalid inputs, a decision on release invalidation, and an audit of our own client's URLs. Out of scope: the Cloudflare dashboard changes, any server-side cache, GraphQL, the AnalysisService."

## Background

The content API (`/ContentService/…`) is read heavily, much of it by bots, and every answer costs a graph-database query. Cloudflare sits in front of the site but caches none of the API today. By default it caches only static files, and our server sends no instruction either way: it sends no `Cache-Control` header, only a weak ETag (measured on beta, 18 Oct 2026).

The decision (tools/content-node/CACHING.md, awright) is that Cloudflare does all the caching, and our server only says, per answer, whether it may be stored. A request written the proper way is cacheable. Anything else is still answered, but never stored. That keeps the set of cached URLs finite, so bots can't fill the cache with random spellings: "a user doing the proper thing would get cached results (fast) and if they don't it would not break but it would be slower."

What is served today: the node content service answers 87 endpoints (81 GET, 6 POST), reading about 30 different query parameters among them. Java still answers what node hasn't ported, and stays as it is.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A proper request is labelled cacheable (Priority: P1)

A visitor or a script asks the content API for something in its standard form: an endpoint's own path with a well-formed identifier, and only the query parameters that endpoint declares, each with a valid value. The answer carries an instruction that a shared cache may store it, and for how long. Once the Cloudflare rule is switched on (outside this feature), a second request for the same URL is served from Cloudflare without reaching the database.

**Why this priority**: this is the whole benefit. Without it, nothing can be cached.

**Independent Test**: request a sample of standard-form URLs for every GET endpoint and check that each answer is labelled cacheable with the agreed lifetime, and that its body is unchanged byte for byte.

**Acceptance Scenarios**:

1. **Given** a GET endpoint and a standard-form URL for it, **When** it is requested and the answer is a success, **Then** the answer is labelled cacheable by shared caches, with the agreed lifetime.
2. **Given** an endpoint with declared query parameters, **When** it is requested with a subset of them, each with a valid value, **Then** the answer is labelled cacheable.
3. **Given** any request, **When** it is answered, **Then** the body and status are exactly what they were before this feature.

---

### User Story 2 - Anything else is answered but never stored (Priority: P1)

A request that isn't in standard form still gets the same answer it gets today, but labelled "do not store". That covers a request carrying an unknown query parameter (`?utm_source=…`, `?x=<random>`), a badly formed value, an identifier written in a padded or unusual form (leading zeros, surrounding spaces), and any error answer. It never takes a cache entry, so there is no limit to the requests a bot can send, but a fixed limit to what can be cached.

**Why this priority**: without it, labelling anything cacheable lets bots fill the cache with endless variants. Story 1 must not ship without it.

**Independent Test**: for each GET endpoint, request it with an unknown parameter, a malformed value and a padded identifier. Check that each answer is labelled "do not store" and is byte-identical to the answer without this feature.

**Acceptance Scenarios**:

1. **Given** a standard-form URL, **When** an unknown query parameter is added, **Then** the answer is the same as before and labelled "do not store".
2. **Given** an endpoint with a declared numeric parameter, **When** it is given a value outside its valid range or of the wrong type, **Then** the answer is Java's answer (including its error status) and labelled "do not store".
3. **Given** an identifier with leading zeros or surrounding spaces, **When** it is requested, **Then** the answer is what Java gives and is labelled "do not store".
4. **Given** any answer with an error status (4xx or 5xx), **Then** it is labelled "do not store".

---

### User Story 3 - Private and site answers are never shared (Priority: P1)

Some answers must never be stored by a shared cache:

- **Anything carrying an analysis token.** Those are one person's results, and a shared cache could hand them to someone else.
- **The bare roots `/ContentService` and `/AnalysisService`.** These serve the site's API documentation page. If that page were stored at the edge, it would outlive the next site deploy and serve a page whose scripts no longer exist.
- **Answers to POST requests.**

**Why this priority**: getting this wrong leaks one user's data to another or breaks a page. It must hold from the first release of the feature.

**Independent Test**: request each kind and check the labels: private-and-do-not-store for anything carrying a token, and never cacheable at the edge for the roots and for POST answers.

**Acceptance Scenarios**:

1. **Given** a request carrying an analysis token, in its path or its query, **When** it is answered, **Then** it is labelled private and "do not store", however well-formed the URL.
2. **Given** a request for `/ContentService` or `/AnalysisService`, with or without a trailing slash, **Then** the answer is not labelled cacheable by shared caches.
3. **Given** a POST request to any endpoint, **Then** its answer is labelled "do not store".

---

### User Story 4 - Cached answers don't outlive a release (Priority: P2)

Reactome publishes a new release of its data a few times a year; the data does not change in between. Cloudflare keeps a cacheable answer until it is deliberately cleared, and the cache is cleared at each release (decided by awright, 18 Oct 2026). A visitor's browser, which cannot be cleared from our side, keeps an answer only briefly. Right after the clearing, a warm-up can request the most-used URLs so they are cached before visitors ask for them. Otherwise the first days after a release send more requests to our server.

**Why this priority**: the cost of getting this wrong is stale data after a release, which is noticeable but recoverable. It doesn't block labelling, but the release-day step must exist before the Cloudflare cache rule is switched on.

**Independent Test**: check that a cacheable answer tells shared caches to keep it indefinitely and browsers to keep it for no more than the browser lifetime. After a test purge, check that the warm-up leaves its list of URLs cached.

**Acceptance Scenarios**:

1. **Given** a cacheable answer, **Then** shared caches are told to keep it until cleared, and browsers to keep it no longer than the browser lifetime.
2. **Given** a release has been deployed and the Cloudflare cache cleared, **When** an answer is requested, **Then** it is the new release's answer. A visitor's own browser shows it within the browser lifetime.
3. **Given** the cache has just been cleared, **When** the warm-up runs, **Then** every URL on its list is requested once and is cached afterwards. The list is the site's own standard-form requests (Story 5) plus the most-used pathways.

---

### User Story 5 - Our own site gets the fast path (Priority: P2)

The Reactome website is the content API's most important client. Every request it makes should be in standard form, so its visitors get cached answers and not the slow path.

**Why this priority**: a site whose own requests are all labelled "do not store" gets none of the benefit. It depends on stories 1 and 2 existing to measure against.

**Independent Test**: run the site's end-to-end suite with a recorder that classifies each content-API request the site makes, and report every one that isn't in standard form.

**Acceptance Scenarios**:

1. **Given** the site's end-to-end suite runs, **When** every content-API request it makes is classified, **Then** every request is in standard form, or is listed with the reason it can't be.

---

### Edge Cases

- **Parameter order and defaults:** a declared parameter repeated, or given its default value explicitly (`?page=1`), is still standard form. The cache key then has a few more entries, but a bounded number, since each endpoint declares only a handful of parameters.
- **A parameter declared but ignored by Java on that path** (`species` on `/data/pathways/top/{id}`, measured in CACHING.md): it counts as declared. The answer is the same either way, so caching it is safe.
- **An empty value** (`?species=`) is not a valid value, so the answer is "do not store".
- **Identifier forms:**
  - Standard: a stable id, a stable id with its version, and a database id written without padding.
  - Not standard: lowercase stable ids, Unicode digits, encoded characters in an id, and an id past Java's numeric range.
  - These forms keep Java's answer, whatever it is.
- **Encoded letters in a fixed part of the path** (`/search/icon/qu%65ry`): not standard form here. Once Cloudflare's URL normalization is on (#527), Cloudflare rewrites them before they arrive, so they get the fast path anyway.
- **A raw `;` in the path** is already a 404 (#526), and a 404 is "do not store".
- **Endpoints still answered by Java:** out of scope. Java sends no caching instruction, so Cloudflare doesn't store them, which is today's behaviour.
- **HEAD requests** carry the same label as the GET they mirror.
- **Answers that depend on something besides the URL:** if any are found, they are "do not store" until shown otherwise. Examples would be a request header that changes the body, or a body that names the host it was served from (a 404 body's `url`).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The node content service MUST label every answer it gives with a caching instruction. No answer is left unlabelled.
- **FR-002**: A successful answer to a GET in standard form MUST be labelled cacheable by shared caches, with the agreed lifetime (FR-010).
- **FR-003**: Every other answer MUST be labelled "do not store". That covers:
  - any answer with an error status;
  - any request with an undeclared parameter, or a declared parameter with an invalid value;
  - any identifier not written in a standard form;
  - any POST.
- **FR-004**: Any request carrying an analysis token MUST be labelled private and "do not store", whatever else is true of it.
- **FR-005**: The bare roots `/ContentService` and `/AnalysisService`, with or without a trailing slash, MUST NOT be labelled cacheable by shared caches.
- **FR-006**: Standard form MUST be decided per endpoint, from a written record of each endpoint's declared parameters: each one's name, type, valid range or values, and default. The record is checked against Java's published API description and node's own endpoint list, so that no endpoint is missing from it and no parameter is invented.
- **FR-007**: Labelling MUST NOT change any answer's status or body. Every ported endpoint stays byte-identical to Java, errors included.
- **FR-008**: Before labelling is trusted, node's answers to invalid inputs MUST be shown to match Java's for every declared parameter of every endpoint. At a minimum: a non-number where a number is expected, a negative page, an offset past the end, and an unknown species.
- **FR-009**: The labelling decision MUST be visible to tests and to an operator for any request: which rule made it cacheable or not.
- **FR-010**: A cacheable answer MUST tell shared caches to keep it until cleared, and browsers to keep it no longer than a short browser lifetime (about an hour). The release process MUST include clearing the Cloudflare cache, written down where the release steps are kept.
- **FR-010a**: There SHOULD be a warm-up that requests a list of standard-form URLs once, run right after the cache is cleared.
- **FR-011**: The site's own content-API requests MUST be audited against standard form. Each one that isn't MUST either be changed to standard form or be listed with the reason.
- **FR-012**: There MUST be no cache of answers on our own server. Caching is Cloudflare's alone.

### Key Entities

- **Endpoint parameter record**: for each endpoint, the query parameters it declares, each with its type, its valid values or range, and its default. It also records which parts of the path are identifiers, and which identifier forms are standard.
- **Caching label**: the instruction attached to each answer. It is one of three: cacheable by shared caches for a lifetime; "do not store"; or private and "do not store". It also carries the reason it was chosen.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Every GET endpoint node answers has a written parameter record, and a test fails if an endpoint is added without one.
- **SC-002**: Labels are checked for every endpoint on a sample covering:
  - standard-form URLs, every one labelled cacheable;
  - unknown parameters, invalid values, padded identifiers and error answers, every one labelled "do not store";
  - token-bearing requests, every one labelled private.
- **SC-003**: Zero answers change in status or body across the parity harness's full corpus: the same byte-identical results as before the feature.
- **SC-004**: Node matches Java on every invalid-input case of FR-008.
- **SC-005**: Once the Cloudflare cache rule is on (outside this feature), a repeat request for a standard-form URL is served by Cloudflare. A repeat request for a non-standard one still reaches our server.
- **SC-006**: Every content-API request made during the site's end-to-end suite is in standard form, or is on the reviewed list of exceptions.
- **SC-007**: After a release and the clearing of the cache, no visitor receives a previous release's answer from Cloudflare. A browser shows the new answer within the browser lifetime.

## Assumptions

- Cloudflare's dashboard changes are made by people with dashboard access and are outside this feature:
  - the Cache Rule that respects the origin's instruction;
  - the rate-limiting rule;
  - URL normalization (#527).
- Until the Cache Rule is on, the labels have no effect on Cloudflare, so the feature can be deployed and checked safely before it is switched on.
- The edge cache key is Cloudflare's default (full URL including the query string), because the free plan doesn't allow a custom key.
- Cloudflare caches separately in each of its data centres, so a warm-up from one machine fills only the nearest one unless Cloudflare's Tiered Cache is on. Tiered Cache is a dashboard setting, added to #527 and outside this feature.
- Clearing only what a release changed was considered and set aside: a release changes the graph broadly (counts, dates, summaries, rebuilt lists), so working out which answers stayed the same would cost more than it saves.
- The AnalysisService and the endpoints Java still answers are unchanged. GraphQL is out of scope.
- Deliberate cache-busting (random parameters) is answered, not stored, and is the rate-limiting rule's job to slow down.
