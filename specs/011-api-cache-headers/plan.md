# Implementation Plan: Cache headers for the content API

**Branch**: `spec/011-api-cache-headers` | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/011-api-cache-headers/spec.md`

## Summary

The node content service labels every answer under `/ContentService/` with a caching instruction, and changes nothing else about it.

- **Not stored, by default.** Every answer starts as `no-store`, or `private, no-store` if it carries a token.
- **One upgrade point.** A single step in the funnel every endpoint answer passes through (`answer()`) upgrades to `public, max-age=3600, s-maxage=31536000`. It does so only for a 200 to a GET or HEAD whose URL, exactly as sent, is in standard form for its endpoint.
- **Standard form** comes from a per-endpoint parameter record, checked against Java's published API description.

Cloudflare does all the caching: it keeps an answer until the release purge, while browsers keep it an hour. There is no cache on our server.

The work runs in this order:

1. the parameter record and parity on invalid inputs;
2. the labelling;
3. the API page roots;
4. the trailing-slash redirect, and the audit of the site's own requests;
5. the release-day warm-up.

## Technical Context

**Language/Version**: JavaScript (ES modules) on Node 24, in `tools/content-node`. TypeScript for the e2e classifier.

**Primary Dependencies**: Express 4.22 (already used), Playwright (e2e, already used). Nothing new.

**Storage**: none. The record is code, and Java's API description is snapshotted as a JSON file beside the other snapshots.

**Testing**: vitest (unit, with a stand-in graph as in the existing specs). The parity harness runs against Java (live, light load). Playwright e2e uses `E2E_PORT=4330`.

**Target Platform**: the node content service in its container behind nginx, then Cloudflare.

**Project Type**: web service (headers only).

**Performance Goals**: labelling adds no database work and no measurable latency: a regular-expression check per request.

**Constraints**:

- Bodies and statuses stay byte-identical to Java.
- The shared graph database takes only small, spaced, sequential parity runs.
- The repository is public: no internal hostnames, paths or release-process detail.

**Scale/Scope**: 81 GET endpoints and 6 POST endpoints; about 30 query parameter names.

## Constitution Check

| Principle                                       | How this plan meets it                                                                                                                                                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Verify the instrument                        | Headers are read from real responses: beta with `curl --resolve`, and node on its own port, which is checked free first. Cloudflare's behaviour is checked against its documentation (T001), and again with `cf-cache-status` once the rule is on. |
| II. Measure in the thing                        | Endpoint parameters come from Java's published description and node's own endpoint list. The site's requests come from the e2e run, not from reading code.                                                                                         |
| III. Prove a test fails                         | Every validator and label test is shown to fail on a mutation, for example a validator that accepts a padded id, or an upgrade that ignores the status.                                                                                            |
| IV. No unstable identifier left with the reader | Unaffected: labels change no body or URL.                                                                                                                                                                                                          |
| V. Comments carry the failure                   | Comments say why a case is not stored (an outside registry, a Europe PMC outage cached until purge), not how the check works.                                                                                                                      |

Quality gates as usual: `scripts/preflight.sh` and the pre-push hook. The lint and dead-code ratchets do not rise. `nginx -t` runs if `deploy/nginx` is touched (it isn't expected to be).

**Result**: passes. Nothing to justify.

## Project Structure

### Documentation (this feature)

```text
specs/011-api-cache-headers/
├── spec.md
├── plan.md               # this file
├── research.md           # R1–R9
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cache-labels.md
│   └── parameter-record.md
└── tasks.md              # next: /speckit-tasks
```

### Source Code (repository root)

```text
tools/content-node/
├── parameters.mjs              # new: the per-endpoint record and its validators
├── parameters.spec.mjs         # new: record covers every GET, agrees with Java; validators
├── openapi-snapshot.json       # new: Java's published description, snapshotted
├── snapshot-openapi.mjs        # new: its generator, like the other snapshot-*.mjs
├── cache-label.mjs             # new: label(request, endpoint, status) → header + rule
├── cache-label.spec.mjs        # new: every row of contracts/cache-labels.md
├── service.mjs                 # default label in the first /ContentService middleware; upgrade in answer()
├── warm.mjs                    # new: release-day warm-up
└── CACHING.md                  # points to spec 011 as built

projects/website-angular/src/scripts/serve-prod.js   # no-store on the API page roots
e2e/support/backend.ts                                # passive classifier of the site's ContentService requests
projects/pathway-browser/src/…                        # fixes the audit finds (parameter order, ' DB_ID')
RELEASE-TESTING.md                                    # post-release row: purge, then warm up
```

**Structure decision**: new modules beside `service.mjs` in `tools/content-node`, as the `domain.mjs`, `jsoup-text.mjs` and snapshot modules already sit. `service.mjs` gains two call sites only.

## Decisions (awright, 18 Oct 2026)

1. **Versioned stable ids** (`R-HSA-69620.5`) are standard with a version of up to 3 digits. Old `REACT_` ids are standard too.
2. **Trailing slash:** a GET or HEAD with one is a `301` to the URL without it (research R10). The site's two slashed URLs are changed. POST is left alone.
3. **Repeated parameters:** only list parameters may repeat.
4. **Page sizes:** no cap. Any value Java accepts is standard.
5. **Search answers** are cacheable for any search term.
6. **Never cached:**
   - `interactors/psicquic/resources` and `citation/static|export`, which use outside services;
   - `citation/pathway`, because of the daily `dateAccessed`;
   - the diagram exporter, `private` because it takes a token (not routed to node today).

## Complexity Tracking

None.
