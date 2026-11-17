# Implementation Plan: ORCID "Claim your work" on the node content service

**Branch**: `spec/orcid-claim` | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/031-orcid-claim/spec.md`

## Summary

Port the old website's ORCID module (sign in with ORCID, claim one's authored and reviewed pathways and reactions as ORCID works, "let us know your ORCID") to the node content service as a family of its own, and give the new site's Person page its controls. The claims keep the old paths, body and answer; the sign-in is rebuilt: `state` (and PKCE if ORCID takes it), the code exchanged on the server in the callback, the token held only in the service's memory behind an opaque cookie, same-origin POSTs, sign-out by POST with revocation, the feature on exactly when its settings are complete, and ORCID's production servers refused without an explicit switch. Built and tested against a stub ORCID; then against ORCID's sandbox on the test site, once the maintainer has the sandbox client. Production is out of scope.

## Technical Context

**Language/Version**: TypeScript on Node 24 (the service runs `.ts` with type stripping, no build: spec 013); Angular for the site.

**Primary Dependencies**: Express 5 (the service), Node's `fetch` and `crypto` (ORCID calls, random identifiers, S256). No new package.

**Storage**: none of its own. Sessions in memory (R3). Claim records to the host's report webapp, if FR-023 decides so (R10).

**Testing**: vitest for the service (stub ORCID on loopback, graph reads replaced as the person specs do); Playwright for the site, with `/ContentService/orcid/**` answered by the test; one whole-flow test of the service and the stub (T026); the sandbox by hand on the test site (quickstart).

**Target Platform**: the content service's container on the host, behind nginx; the site.

**Project Type**: web service family plus site feature, in one repository.

**Performance Goals**: a claim of 3,300 works (34 batches) in under 5 minutes; `authenticated` as cheap as a map lookup.

**Constraints**: no token, code, secret or iD in a log, answer or file (FR-007, FR-024); no request to ORCID from any test (FR-021); no Java; a family imports only shared modules (spec 014); answer types in the contract (spec 016); ratchets do not rise; the repository is public, so redirect URIs and hosts are written with placeholders.

**Scale/Scope**: twelve routes (eleven old endpoints, one served at two addresses, one retired), three shared modules, one stub, the Person page's controls, one site route, one form.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                     | How this plan meets it                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Verify the instrument      | The stub validates every request it receives against [contracts/orcid-works.md](contracts/orcid-works.md) and refuses the rest, so "the stub accepted it" means "it was well formed". C17 proves no test can reach ORCID: a test pointed at the sandbox fails before any request. C4 and C18 scan for the stub's actual token and code strings, not for the word "token". |
| II. Measure in the thing      | The whole flow runs through the real server against the stub (T026), and through the real site on the test site against the sandbox (T027) before the feature is called done. Site controls are asserted by their effect (the redirect's URL, the request sent), not their presence.                                                                                      |
| III. Prove a test fails       | Every check has its breakage named in [contracts/checks.md](contracts/checks.md); each task records seeing it red.                                                                                                                                                                                                                                                        |
| IV. Stable identifiers        | Works carry the stable id as their identifier and in their links; the "Let us know" message names the Person page by its address; the callback's `return` keeps the Person page's address as the reader had it.                                                                                                                                                           |
| V. Comments carry the failure | The comments the port needs are the old module's failures: no `state`, the GET sign-out, the token in the browser, the machine-name gate, the trust-any-certificate client. Each goes beside the code that replaces it, without exploitable detail.                                                                                                                       |
| Quality gates                 | Unchanged; preflight runs them. New code under `tools/` is TypeScript; the stub joins `tools/load.spec.ts`'s `SERVICES` and is importable without side effects.                                                                                                                                                                                                           |
| Curator documents             | `RELEASE-TESTING.md` and `CURATOR-REPORT.md` get rows for the claim flow (T028).                                                                                                                                                                                                                                                                                          |

No violation. Re-checked after Phase 1: still none; one complexity is tracked below.

## Project Structure

### Documentation (this feature)

```text
specs/031-orcid-claim/
├── spec.md
├── plan.md                 # this file
├── research.md             # R1–R13
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── endpoints.md        # the twelve routes, old against new
│   ├── orcid-works.md      # what is sent to ORCID
│   └── checks.md           # C1–C27, each with its breakage
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
projects/contract/
├── orcid.ts                       # OrcidStatus, ClaimingSummary, OrcidWork, OrcidContactText, OrcidError
├── routes.ts                      # + the ORCID JSON routes
└── openapi.json                   # regenerated

tools/content-node/
├── orcid-endpoints.ts             # the family: login, callback ×2, signout, authenticated, claim ×5, works, let-us-know
├── orcid-client.ts                # shared: token exchange, revoke, bulk add, list; host pinning; timeouts
├── orcid-works.ts                 # shared leaf: SimpleEvent → work, the batching, the summary
├── sessions.ts                    # shared: the in-memory store, cookie, limits
├── person-lists.ts                # shared: the Person lookup and four lists, moved from person-endpoints.ts
├── settings.ts                    # + the ORCID settings and the enabled rule
├── report.ts                      # + claim records (if FR-023 decides so)
├── registry.ts                    # + orcidEndpoints
├── fixtures/route-order.json      # + the new routes
└── orcid*.spec.ts                 # the checks

tools/orcid-stub/
└── stub.ts                        # startStubOrcid(): authorise page, token, revoke, works; loopback only

deploy/nginx/
├── common/routes.conf             # + /ContentService/orcid/ and /content/orcid/callback
├── dev.conf, release.conf, production.conf   # + limit_req_zone orcid_rate
└── routes.spec.ts                 # + the zone check
proxy.conf.js                      # + the two routes

projects/website-angular/src/app/
├── orcid/                         # OrcidService (status, sign-in URL, claim, sign-out, contact text)
├── orcid/orcid-callback.component.*   # the /orcid-callback route
├── orcid/orcid-contact.component.*    # "Let us know your ORCID" form
├── content/detail/person-detail/  # the controls
└── app.routes.ts                  # + orcid-callback
e2e/orcid.spec.ts                  # the site's checks
projects/website-angular/content/about/privacy-notice.mdx, documentation/userguide/claim-your-work.mdx
documentation/declared-differences.md
```

**Structure Decision**: one family and three new shared modules in the content service, layered as spec 014 requires: `orcid-works.ts` and `sessions.ts` are leaves; `orcid-client.ts` imports only `settings.ts`; `person-lists.ts` imports what `person-endpoints.ts` imports for its lists today; the family imports these and nothing of another family. The stub is a tool directory of its own because it is a server that both the service's specs and a person running the quickstart start.

## Complexity Tracking

| Complexity                                      | Why needed                                                                                    | Simpler alternative rejected because                                                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Server-side state in a so-far stateless service | The token must not reach the browser (FR-007); the old module kept it in a server session too | A token in a cookie, encrypted or not, sits in the browser and cannot be withdrawn by deleting it on our side                          |
| The store assumes one process                   | The service runs as one process per deployment                                                | A shared store (database, cache) would be a store of long-lived credentials; if the service ever scales out, that decision comes first |
| A stub ORCID                                    | No sandbox credentials yet; tests must never reach ORCID; the stub validates what is sent     | Recording ORCID's answers would need the sandbox first, and would replay answers without checking requests                             |
