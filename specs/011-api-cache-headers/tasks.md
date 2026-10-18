# Tasks: Cache headers for the content API

**Input**: design documents in `specs/011-api-cache-headers/` (plan.md, spec.md, research.md R1–R10, data-model.md, contracts/, quickstart.md)

**Tests**: required. The constitution (III) asks for every behaviour to be tested, and each test shown failing first: undo the change, or mutate the code, and watch it fail.

**Every phase ends the same way**:

1. adversarial review;
2. CI green, then merge;
3. deploy to beta: `docker compose build -q content-node nginx`, `nginx -t`, `up -d`;
4. confirm the build on `/health`;
5. check the headers on beta with `curl --resolve beta.reactome.org:443:127.0.0.1`.

The pull request that completes a task ticks it here, with its number.

**[dashboard]** marks a step that needs people with Cloudflare dashboard access. It is tracked in issue #527, not done in this repository.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup

- [x] T001 [P] Check each Cloudflare claim in research.md R2 and R9 against its page; correct research.md where a quote differs. The claims: `s-maxage` overrides `max-age`; `private` and `no-store` are not stored; Browser TTL takes the higher value; Vary is ignored; HEAD becomes GET; Free has purge by prefix and Smart Tiered Cache. Record anything the documentation leaves open, such as a maximum edge TTL, in `specs/011-api-cache-headers/research.md`.
- [x] T002 [P] Write `tools/content-node/snapshot-openapi.mjs`. Like `snapshot-schema.mjs`, it fetches Java's published API description from `/ContentService/v3/api-docs` once and writes `tools/content-node/openapi-snapshot.json`, sorted and stable, with the server URL dropped. Add the JSON to `.prettierignore` if it is generated unformatted.

---

## Phase 2: Foundational (blocks every story)

- [ ] T003 Write `tools/content-node/parameters.spec.mjs` before the record exists. It checks:
  - the record's keys equal node's GET endpoint paths (`endpoints` from `service.mjs`);
  - each entry with `java` has exactly that operation's query parameter names, types and defaults from `openapi-snapshot.json`;
  - each `java: null` entry has `why`;
  - each path variable has a kind;
  - each validator accepts its standard forms and refuses each alias.

  The aliases come from contracts/parameter-record.md: padded and encoded ids, Unicode digits, leading zeros, `+`, hex, `on`/`yes`/`1`, a version past 3 digits, a regex resource, and a repeated non-list parameter. Run it and see it fail.

- [ ] T004 Write `tools/content-node/parameters.mjs`:
  - the record for all 81 GET endpoints, following research R3–R5 and the decisions in plan.md;
  - the shared `VIEW`, `VIEW_IGNORED`, `INCLUDE_REF` and `INCLUDE_REF_IGNORED`;
  - one validator per kind and type;
  - `standardForm(endpoint, originalUrl) → { ok } | { ok: false, rule }`, reading the URL as sent.

  It is done when T003 passes. Mutate three validators, one at a time, and see T003 catch each.

- [ ] T005 Mark the never-cached endpoints in `tools/content-node/parameters.mjs` (research R5):
  - `cache: 'never'` on `interactors/psicquic/resources`, `citation/static/{id}`, `citation/export` and `citation/pathway/{id}`;
  - `cache: 'private'` on `exporter/diagram/{id}`.

  Add a test to `parameters.spec.mjs` that names each one.

- [ ] T006 Build an invalid-input corpus from the record, in `tools/content-node/invalid-inputs.mjs`. For every declared parameter of every GET endpoint:
  - a non-number for a number, `-1` and `0` for a page, an offset past the end;
  - an unknown enum value, an empty value, an unknown species;
  - `on` for a boolean.

  Each endpoint uses a sample id from its `sample`.

- [ ] T007 Run the corpus against node (its own port, checked free first) and Java: sequentially, spaced, and at most 300 requests per run. Record the verdicts. Fix every difference in `tools/content-node/service.mjs` so node matches Java byte for byte, apart from an error body's `url`, with a handler-level test for each fix, shown failing first. Note the run in research.md R6.
- [ ] T008 Review, CI, merge and tick T001–T007. No beta check is needed: nothing is served differently yet.

**Checkpoint**: the record exists and agrees with Java's description. Node answers bad input as Java does.

---

## Phase 3: Labelling: US1, US2 and US3 (MVP; they ship together)

**Goal**: every answer node writes under `/ContentService/` carries a `Cache-Control` and an `X-Cache-Rule`, as contracts/cache-labels.md says. Only standard-form GET and HEAD 200s are public. Tokens are private. The API page roots are `no-store`.

**Independent test**: for a standard URL, an unknown parameter, a padded id, a 404, a POST, an OPTIONS and a `token` request, each header is as the contract says. Every body is unchanged under the parity harness.

### Tests first

- [ ] T009 [P] [US1] Write `tools/content-node/cache-label.spec.mjs` from every row of contracts/cache-labels.md, as a pure function test of `label({ method, endpoint, originalUrl, status })`. Run it and see it fail.
- [ ] T010 [P] [US2] Add handler-level tests in `tools/content-node/cache-headers.spec.mjs`, with a stand-in graph as in `contained-events.spec.mjs`. They cover:
  - a standard GET → `public, max-age=3600, s-maxage=31536000` and `standard`;
  - HEAD → the same;
  - `?utm_source=x` → `no-store` and `parameter:utm_source`;
  - a padded id → `path:id`;
  - a 404 → `status`;
  - POST → `method`;
  - OPTIONS, the Tomcat 400, `//` and a raw `;` → `default`;
  - a 304 for a standard GET keeps `public`;
  - `?token=x` → `private, no-store`.

  Each body must equal the body without the feature. Run it and see it fail.

### Implementation

- [ ] T011 [US1] Write `tools/content-node/cache-label.mjs`. `label()` returns `{ cacheControl, rule }` per data-model.md, using `standardForm` from `parameters.mjs`. T009 passes.
- [ ] T012 [US2] In `tools/content-node/service.mjs`, set the default `Cache-Control: no-store` and `X-Cache-Rule: default` in the first `/ContentService` middleware (the CORS one), before OPTIONS is answered. Set `private, no-store` and `token` when the raw query has a `token` parameter.
- [ ] T013 [US1] In `answer()` in `tools/content-node/service.mjs`, after the handler's result and before `writeResult`, set `result.headers` from `label()`. It reads `request.originalUrl`, never `request.url`, and takes the endpoint from `answer()`'s own argument. T010 passes.

  Then prove it with these mutations, each shown to fail:
  - reading `request.url`;
  - ignoring the status;
  - ignoring the method;
  - dropping the default middleware.

- [ ] T014 [P] [US3] In `projects/website-angular/src/scripts/serve-prod.js`, send `Cache-Control: no-store` for the `API_PAGE` paths (`/ContentService`, `/ContentService/`, `/AnalysisService`, `/AnalysisService/`) only. Add a test to `serve-prod.spec.ts`, shown failing first.
- [ ] T015 [US2] Run the parity harness over its full corpus with the labels on. Zero status or body differences against the run before (SC-003), checked by verdicts and sizes.
- [ ] T016 Review, CI and merge. Then deploy node, nginx and the site to beta. Check with `curl --resolve beta.reactome.org:443:127.0.0.1 -D -`:
  - `/ContentService/data/diseases` → public and `standard`;
  - `?utm_source=x` → `no-store`;
  - `/ContentService/data/query/R-HSA-0000001` → `no-store`;
  - `/ContentService/` → `no-store`;
  - a Java-served URL → unchanged (no `Cache-Control`).

  Tick T009–T016.

**Checkpoint**: the MVP is live. Labels do nothing at Cloudflare until the Cache Rule is on (T030), so this can't change what visitors receive.

---

## Phase 4: One URL per answer (FR-013)

- [ ] T017 [US1] Add tests to `tools/content-node/cache-headers.spec.mjs`, each shown failing first:
  - a GET to `/ContentService/data/diseases/?a=1` → `301`, `Location: /ContentService/data/diseases?a=1`, `public, max-age=3600, s-maxage=31536000` and `redirect`;
  - HEAD → the same;
  - a POST to `/ContentService/data/query/ids/` → answered as today, not redirected;
  - a path that matches no node endpoint, with a slash → Spring's 404, not a redirect;
  - `/ContentService/data/query/R-HSA-1%2Fx/` → not decoded in `Location`.
- [ ] T018 [US1] Implement the redirect in `tools/content-node/service.mjs`. It goes in the `/ContentService` middleware, after the path checks and before routing; only for GET and HEAD, and only when the path without its slash matches a node endpoint. The `Location` is built from the raw path and query as sent. T017 passes.
- [ ] T019 [P] [US5] Change the site's two slashed URLs to the unslashed form: `/search/fireworks/` in `projects/pathway-browser/src/app/viewport/search/search.component.ts` (~276), and `/interactors/psicquic/resources/` (find where it is built). Update the e2e HARs that hold them by re-recording only those specs; follow the e2e port rule.
- [ ] T020 Update `deploy/nginx/routes.spec.ts` and the dev proxy test, if any test asserts that node answers the slashed form with a 200. nginx still routes it to node (spec 006 T006), and node now redirects. Review, CI, merge, deploy. On beta, check that `/ContentService/data/diseases/` → `301` to `/ContentService/data/diseases`. Tick T017–T020.

---

## Phase 5: US5, the site gets the fast path (P2)

**Goal**: every ContentService request the site makes is in standard form, or is on a reviewed list.

**Independent test**: the e2e run's classifier report lists no non-standard request except the reviewed ones.

- [ ] T021 [US5] Add a passive classifier to `e2e/support/backend.ts`: a `context.on('request')` listener that runs `standardForm` on every `/ContentService` request (stubbed ones included). It writes a report, and never fails the run, like the `undeclared` check (~690–701). Leave out the `.api.json` probes. A unit test feeds it one standard URL and one non-standard URL, and is shown failing first.
- [ ] T022 [US5] Run `E2E_PORT=4330 npm run e2e` once, and record the report in `specs/011-api-cache-headers/research.md` R8.
- [ ] T023 [P] [US5] Make the `enhanced/v2/{id}` requests one spelling: the same parameter set and order in `projects/pathway-browser/src/app/services/data-state.service.ts` (~247–256) and `projects/pathway-browser/src/app/services/database-object.service.ts` (~31). Check that the answers the pages use are unchanged, with the existing specs and an e2e run.
- [ ] T024 [P] [US5] Fix `' DB_ID'` (a leading space) in `projects/pathway-browser/src/app/viewport/search/search.component.ts` (~324) to `'DB_ID'`, with a test.
- [ ] T025 [US5] For every other finding in the report: fix it in the site, or add it with its reason to a list in `specs/011-api-cache-headers/research.md` R8. `citation` requests are expected on the list (never cached by design).
- [ ] T026 Review, CI, merge, deploy. On beta, load a pathway page in Playwright with `beta.reactome.org` mapped to 127.0.0.1. Every `/ContentService` response it receives from node carries `x-cache-rule: standard`, apart from the listed ones. Tick T021–T026.

---

## Phase 6: US4, release day (P2)

**Goal**: after a release the edge serves the new data, refilled quickly.

**Independent test**: after a test purge, the warm-up requests its list and every URL comes back `standard`.

- [ ] T027 [US4] Write `tools/content-node/warm.mjs <origin>`. It builds the list at run time from:
  - `/data/species/main`;
  - each species' `/data/pathways/top/{taxId}` and the events hierarchy, in the site's exact spelling;
  - the content lists (`toc`, `doi`, `contributors`), `database/version` and `schema/model`;
  - each top-level human pathway's `enhanced/v2` and `event/{id}/ancestors` requests, in the site's exact spelling (after T023).

  It requests each URL once, sequentially, with a small pause, and fails if any answer is not 200 with `x-cache-rule: standard`. Add a test of the list builder with a stand-in fetch, shown failing first, in `tools/content-node/warm.spec.mjs`.

- [ ] T028 [P] [US4] Add a row to `RELEASE-TESTING.md`'s "Post-release" table: "Content API edge cache cleared (purge by prefix `/ContentService/`), then `node tools/content-node/warm.mjs <site>` run". State only what to do, nothing about how the release itself runs. Add a matching line to the note on browser cache headers.
- [ ] T029 [P] Update `tools/content-node/CACHING.md`: status "built (spec 011)", the work queue ticked, and a pointer to contracts/cache-labels.md.
- [ ] T030 **[dashboard]** People with Cloudflare dashboard access, issue #527:
  - URL normalization, incoming and to origin;
  - Smart Tiered Cache;
  - then the Cache Rule on `/ContentService/*`, leaving out the four roots: eligible for cache, Edge TTL from the header, Browser TTL "respect origin", no status-code TTL, query string sorted;
  - then the rate-limiting rule.
- [ ] T031 After T030: request a standard URL twice through the public site and expect `cf-cache-status: HIT` the second time. Request one with `?utm_source=x` twice and expect it never to be a HIT. Then run a purge and the warm-up once, and check the second pass is HIT (SC-005). Tick T027–T031.

---

## Phase 7: Polish

- [ ] T032 [P] Add every new module to the dead-code and lint ratchets as they stand, without raising either count.
- [ ] T033 Re-read spec.md's success criteria SC-001–SC-007 and tick each with the task or check that met it. Add the notes to `specs/011-api-cache-headers/checklists/requirements.md`.

---

## Dependencies

- **Phase 1 → Phase 2:** T002's snapshot feeds T003 and T004.
- **Phase 2 → Phases 3–6:** they all need `standardForm`.
- **Phase 3 (the MVP) before Phase 4:** the redirect uses the label's `redirect` rule.
- **Phase 5:** needs Phase 3 to measure against. T019 belongs to Phase 4.
- **Phase 6:** T027 needs T023's single spelling. T031 needs T030 (dashboard).
- **Order:** within each phase, tests come before implementation.

## Parallel opportunities

- T001 ∥ T002.
- T009 ∥ T010 ∥ T014 (different files).
- T019 alongside T017–T018.
- T023 ∥ T024.
- T028 ∥ T029.

## Implementation strategy

1. **MVP:** Phases 1–3. Every node answer is labelled and nothing else changes, so it is safe on beta with no Cloudflare rule.
2. **Phase 4** removes the duplicate slashed URLs.
3. **Phase 5** makes the site's own traffic cacheable.
4. **Phase 6** prepares release day.
5. **The dashboard step (T030)** comes last. It is when anything actually starts being cached, and it needs people outside this repository.
