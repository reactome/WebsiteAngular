---
description: 'Tasks for spec 031: ORCID "Claim your work" on the node content service'
---

# Tasks: ORCID "Claim your work" on the node content service

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

This spec replaces spec 006's T110, which now points here.

**Every task**:

- Is one pull request, with its own adversarial review, and ticks this file with its PR number in that same pull request.
- Shows each new check failing before it is trusted (constitution III); [contracts/checks.md](contracts/checks.md) names the breakage, and the tick records that it was seen red.
- Sends no request to ORCID (only the stub, on loopback), to the graph database or to Reactome services from a test.
- Puts no real person's name, ORCID iD, record or token in code, fixtures, logs, test output, commit messages or pull request descriptions; no host name, path or credential either (the repository is public).
- Never lets the lint, dead-code, loose-value or known-problems counts rise.
- Keeps the register of declared differences current: a row's status moves from "spec only" as its task lands.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup (the maintainer's part, and what ORCID's documentation says)

- [ ] T001 [US4] The maintainer registers the sandbox client through ORCID's "Register a client application: Sandbox Member API" form, with only the four non-production redirect URIs in [quickstart.md](quickstart.md) §3, and installs its id and secret in the test site's private settings. Nothing goes in the repository; the tick says only that it is done.
- [ ] T002 The maintainer answers the spec's three open questions (FR-016 revocation, FR-022 sandbox Person, FR-023 claim records); the answers replace the `[NEEDS CLARIFICATION]` markers in [spec.md](spec.md) and are recorded in [research.md](research.md) (R5, R11, R10), and the register's open-decision entries are closed.
- [ ] T003 Read ORCID's current public documentation (no request from code or tests) and record in research: whether the Member API checks PKCE for a confidential client (R4), the revocation endpoint and its parameters (R5), v3.0's bulk-add limit and v2.x's retirement (R6), whether `/activities/update` reads the works Reactome added (R7), and the Member API's rate limits (R9). Correct [contracts/orcid-works.md](contracts/orcid-works.md) where it differs.

## Phase 2: Foundational (types, settings, the stub, shared modules)

- [ ] T004 [P] Add `projects/contract/orcid.ts` with `OrcidStatus`, `ClaimingSummary`, `OrcidWork`, `OrcidContactText`, `OrcidError` and `OrcidErrorCode` ([data-model.md](data-model.md)); rows in `projects/contract/routes.ts` for the JSON routes; regenerate `projects/contract/openapi.json` with notes written from [contracts/endpoints.md](contracts/endpoints.md) (Java's documentation has none for these).
- [ ] T005 [P] [US4] Add the ORCID settings to `tools/content-node/settings.ts` and the enabled rule (R8): on only when every setting is present and valid; production hosts refused without `ORCID_PRODUCTION=1`; loopback refused without `ORCID_STUB=1`; one start-up line naming a missing setting, never a value. C16.
- [ ] T006 [P] Add `tools/orcid-stub/stub.ts`, exporting `startStubOrcid()` (no side effect on load; joins `tools/load.spec.ts`'s `SERVICES`): the authorise page (approve, decline, a chosen placeholder account), token (checks client, secret, redirect URI, code, single use, and `code_verifier` when a challenge was sent), revoke, works GET and bulk POST (validates every body against [contracts/orcid-works.md](contracts/orcid-works.md), answers conflicts for works it already holds, keeps tallies), and failure modes on demand (401, 500, a slow answer). Listens on loopback only. A spec of its own shows a malformed work refused.
- [ ] T007 [P] Placeholder fixtures: the stub's accounts (`Placeholder Researcher`, iDs from ORCID's documented examples or the stub's reserved range) and fixture Persons with placeholder names and free text, with a check over `tools/content-node/fixtures/orcid*` and `e2e/**/orcid*` that every iD and name is on an allowlist. C27.
- [ ] T008 Add `tools/content-node/orcid-client.ts`: token exchange, revoke, bulk add, works list; HTTPS verified by name; refuses any host but the configured ones before sending; 30-second limits; no logging of bodies. C17.
- [ ] T009 [P] Add `tools/content-node/sessions.ts`: the store (R3), pending sign-ins, cookie writing and reading, idle and absolute limits on an injected clock, identifier rotation, the 10,000 cap, and the family's `Cache-Control: no-store` helper. C6, C7, C22.
- [ ] T010 Move the Person lookup (`personWhere`) and the four lists' query out of `person-endpoints.ts` into `tools/content-node/person-lists.ts`, so the ORCID family can read them without importing another family; `scripts/check-move.mjs` must report a pure move, and the person answers stay byte-identical (parity run before and after).

**Checkpoint**: nothing is routed yet; every shared piece has its checks.

## Phase 3: User Story 1 - Sign in with ORCID (P1)

- [ ] T011 [US1] Add `tools/content-node/orcid-endpoints.ts` with `login`, register the family in `registry.ts` and `fixtures/route-order.json`, and keep `boundaries.spec.ts` green. C1, C5.
- [ ] T012 [US1] The callback at both addresses: `state` check, server-side exchange, new session, the 302 to `/orcid-callback` with `outcome`, `Referrer-Policy: no-referrer`; `/orcid/token` stays unserved. C2, C3, C4.
- [ ] T013 [US1] `authenticated` (with `enabled`), `signout` (POST, same-origin, revocation per T002), and the family-wide `Origin` check for POSTs. C8, C15.

**Checkpoint**: sign-in and sign-out work against the stub through the service.

## Phase 4: User Story 2 - Claim your works (P1)

- [ ] T014 [US2] Add `tools/content-node/orcid-works.ts`: `SimpleEvent` → work ([contracts/orcid-works.md](contracts/orcid-works.md)), the authored-and-reviewed intersection, batching by 100, and the summary from ORCID's bulk answers. C11.
- [ ] T015 [US2] The five claim routes: checks in the order of [contracts/endpoints.md](contracts/endpoints.md), one claim per session, ORCID's 401 ending the session, 502 and 504 naming how many were added, the 5-minute budget. C9, C10, C12, C13, C14.
- [ ] T016 [US2] Log audit: run the whole ORCID suite with the service's log captured and fail on any of the stub's secrets, codes, tokens, `state`s, session ids, iDs or names. C18.

**Checkpoint**: a claim against the stub produces the right works and the right summary.

## Phase 5: User Stories 3 and 5 - Let us know, works, and the record of claims

- [ ] T017 [US5] Claim records, as T002 decides FR-023: if the report webapp, add the claim-register call to `report.ts` (fire and forget, Java's codes in the log, never the iD), one record per added work, no token and no sign-in record. C19.
- [ ] T018 [P] [US3] `let-us-know-your-orcid` with the optional `person`. C20.
- [ ] T019 [P] [US2] `{orcid}/works`, narrowed to Reactome-sourced works. C21.

## Phase 6: Routing

- [ ] T020 [US4] nginx: the two locations in `deploy/nginx/common/routes.conf` (budget `orcid_rate`, `access_log off` on the callback, 330-second read timeout on claims), the zone in each environment file, the dev proxy's two entries, `routes.spec.ts` for the zone and the agreement; run `deploy/nginx/test-config.sh`. C23.

## Phase 7: The site

- [ ] T021 [US1] The `/orcid-callback` route: each outcome's words (signed in; declined; failed, with the cookie hint for `reason=state`), and the return to the Person page only when `return` is a site path. C25.
- [ ] T022 [US1] [US2] The Person page's controls (FR-029), driven by `authenticated` and the page's ORCID iD; nothing when disabled. C24.
- [ ] T023 [US2] Claim confirmation with the count, the working state, the summary dialog (with a link to the researcher's ORCID record), and each error's `user-message`; 401 offers sign-in again. C26.
- [ ] T024 [US3] "Let us know your ORCID": the form (name, e-mail, the pre-filled subject and message, Turnstile) posting to `POST /ContentService/contact`.
- [ ] T025 The privacy notice's paragraph on the ORCID sign-in (FR-027), for the maintainer's approval before the feature is offered on the test site; the user guide's `claim-your-work.mdx` text for the redirect flow (screenshots wait for the curator's).

## Phase 8: The whole flow, and the sandbox

- [ ] T026 A whole-flow test: the real server and the stub, a cookie-keeping client following every redirect from `login` through the stub's authorise page and the callback to a claim, a second claim (all conflicts) and sign-out.
- [ ] T027 [US4] After T001 and T002: deploy on the test site with the sandbox settings and walk [quickstart.md](quickstart.md) §3 (SC-001); record the outcome here, without iDs, names or host names. Check also that the old works' links (`/content/detail/{stId}`, `/PathwayBrowser/#/{stId}`) open the right pages on the new site.
- [ ] T028 Close out: tick spec 006's T110 with this spec's PRs; register rows to "live on beta"; `RELEASE-TESTING.md` and `CURATOR-REPORT.md` rows for the claim flow (**auto** naming T026's and the site's specs, **human** for the sandbox walk).

## Dependencies

- T001 and T002 gate T027 only; everything else is built against the stub. T002 decides the substance of T013's revocation, T017 and the `ORCID_TEST_PERSON` part of T005.
- T004–T010 before Phase 3. T011 → T012 → T013. T014 before T015. T015 before T016, T017, T019. T011 before T020. Phase 7 needs only T004 (it answers the service's routes itself), so it can run beside Phases 3–6.
- T026 after T020; T027 after everything but T028.

## Parallel opportunities

T004, T005, T006, T007 and T009 touch different files. T018 and T019 likewise. The site's tasks (T021–T025) can run beside the service's once T004 is in.

## Out of scope

Production credentials (an update of the existing production client's secret, by the maintainer), switching production on, updating or deleting works already claimed, claiming from pages other than the Person page, and replacing the report webapp.
