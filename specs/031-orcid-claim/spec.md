# Feature Specification: ORCID "Claim your work" on the node content service

**Feature Branch**: `spec/orcid-claim`

**Created**: 2026-11-17

**Status**: Draft

**Input**: Maintainer's decision, 16 Nov 2026: "Keep 'Claim your work': it is an important part of the curation process. Port it to the node content service, never to Java and never with a Java fallback. Reactome is an ORCID member organisation. All development and testing uses ORCID's Sandbox Member API, with its own client id and secret, registered with non-production redirect URIs only; production credentials come later. Until the sandbox key exists, build and test against a stub ORCID. Register both `<site>/content/orcid/callback` and `<site>/ContentService/orcid/callback` on the sandbox client, for the test site and localhost. Credentials live in the host's private settings and are read from the environment, never in the repository."

## Background

"Claim your work" lets a researcher who authored or reviewed Reactome pathways and reactions add them, as works, to their own ORCID record. They sign in with ORCID on their Person page, grant Reactome permission to add works, and press a button; Reactome writes one work per pathway or reaction, through ORCID's Member API, with the pathway's stable id (and its DOI, where it has one) as the work's identifiers. ORCID records these as contributions credited by Reactome, which matters to the volunteers who author and review Reactome's content.

The feature was served by the old website's content pages (data-content's `org.reactome.server.orcid` package). It was ported verbatim to the Java ContentService in May 2026 and reverted three days later "until the team discusses it". Nothing serves it today: the new site's Person page (#99) has no claim buttons, and issue #114 has waited on a backend since August. Spec 006 lists it as its last task, T110. The discussion is settled: the feature stays, and its home is node, by spec 010's rule (it is logic Reactome writes for the website, with no Java library at its core).

Because nothing serves these endpoints, there is no Java answer to compare against, so spec 006's rule that a ported endpoint is byte-identical to Java's cannot apply as it does elsewhere. This spec instead keeps each endpoint's path, method, inputs and success shape as the old module had them wherever that is safe, and declares every change, with its reason, in the [register of declared differences](../../documentation/declared-differences.md).

The old module's security model does not survive a port as it stands. It sent no `state` parameter, so a sign-in could be forced on a visitor; it signed out on a GET; the reverted port returned the whole token record, access token included, to the browser; its outbound connections accepted any certificate; and it was switched on by comparing the server's machine name with a configured one. This spec replaces each of these.

## User Scenarios & Testing _(mandatory)_

The users are Reactome's authors and reviewers (researchers, signed in with ORCID, on their own Person page), the help desk (who receive "let us know your ORCID" messages), and the maintainer (who holds the ORCID client credentials and decides when production switches).

### User Story 1 - Sign in with ORCID from the Person page (Priority: P1)

A researcher opens their Person page, presses "Sign in with ORCID", grants Reactome permission on ORCID's page, and lands back on the same Person page, signed in, with their ORCID iD shown as the signed-in account. They can sign out, and signing out ends the sign-in on Reactome's side.

**Why this priority**: every other story needs a signed-in session; on its own it proves the OAuth round trip, the credentials and the redirect URIs.

**Independent Test**: against the stub ORCID (and later the sandbox), follow the sign-in from a Person page and back; `GET /ContentService/orcid/authenticated` reports signed in with the stub account's iD; sign out; it reports signed out.

**Acceptance Scenarios**:

1. **Given** a visitor not signed in on a Person page, **When** they press "Sign in with ORCID", **Then** the browser goes to ORCID's authorise page with Reactome's client id, scope `/activities/update`, a registered redirect URI and a fresh `state`.
2. **Given** ORCID sends the browser back with a code and the matching `state`, **When** the callback is handled, **Then** the content service exchanges the code for a token itself, the browser never sees the token or the code again, and the visitor lands on `/orcid-callback`, which confirms the sign-in and returns them to the Person page they started from.
3. **Given** ORCID sends the browser back with `error=access_denied` (the researcher declined), **When** the callback is handled, **Then** the visitor sees "You did not grant Reactome access to your ORCID record; nothing was changed" and is not signed in.
4. **Given** a callback whose `state` is missing, unknown, already used or older than ten minutes, **When** it arrives, **Then** no code is exchanged, no session is created, and the visitor sees "The sign-in could not be completed; please try again".
5. **Given** a signed-in visitor, **When** they press "Sign out", **Then** the session is deleted on the server, its cookie cleared, and (subject to FR-016) the access token revoked at ORCID.

---

### User Story 2 - Claim your works (Priority: P1)

A signed-in researcher whose ORCID iD matches the Person page's ORCID presses "Claim all your works" (or one of the four narrower buttons: pathways authored, pathways reviewed, reactions authored, reactions reviewed), confirms the number of works to be added, and sees a summary: how many were sent, how many ORCID added, how many were already in their record, and how many failed.

**Why this priority**: this is the feature. Story 1 alone adds nothing to anyone's record.

**Independent Test**: against the stub ORCID, sign in as a stub account mapped to a fixture Person, claim all; the stub received one bulk request per 100 works, each work built as [contracts/orcid-works.md](contracts/orcid-works.md) says, and the summary's counts equal the stub's tallies.

**Acceptance Scenarios**:

1. **Given** a signed-in researcher on their own Person page, **When** they claim all, **Then** each pathway and reaction they authored or reviewed is sent once: as author, as reviewer, or as both when they did both, in batches of at most 100.
2. **Given** some of those works are already in their ORCID record from an earlier claim, **When** they claim again, **Then** ORCID reports those as conflicts, no duplicates are created, and the summary counts them as "already in your record".
3. **Given** a signed-in researcher on **another** person's page, **When** a claim is sent for that page (by the button being shown in error, or by a hand-made request), **Then** it is refused with 403 and nothing is sent to ORCID.
4. **Given** a Person page with no ORCID recorded in Reactome, **When** a claim is sent for it, **Then** it is refused with 403 and the page offers "Let us know your ORCID" instead (Story 3).
5. **Given** ORCID rejects the token partway through (revoked by the researcher on ORCID's site), **When** the next batch is sent, **Then** the claim stops, the session ends, and the researcher is told to sign in again; what was already added stays added and is reported.
6. **Given** a claim is running for a session, **When** a second claim is sent for the same session, **Then** it is refused with 409 until the first finishes.

---

### User Story 3 - Let us know your ORCID (Priority: P2)

A signed-in researcher whose Person page has no ORCID recorded (or a different one) is offered "Let us know your ORCID". It opens a short help-desk form, pre-filled with a subject and a message that carry their signed-in ORCID iD and the Person page they are on, protected by the site's human check, and sent through the content service's contact endpoint.

**Why this priority**: it is how a contributor's ORCID iD reaches Reactome's records so that Story 2 can work for them at the next release; useful, but not needed for the researchers whose iD is already recorded.

**Independent Test**: signed in as a stub account on a fixture Person with no ORCID, open the form; it carries the stub iD and the page's address; sending it reaches `POST /ContentService/contact` with those fields (the mail sender replaced, as the contact specs replace it).

**Acceptance Scenarios**:

1. **Given** a signed-in researcher on a Person page without an ORCID, **When** they open "Let us know your ORCID", **Then** the subject is "[ORCID] Please add my orcid into Reactome" and the message names their ORCID iD and the Person page's address.
2. **Given** a visitor who is not signed in, **When** the form's text is requested, **Then** the answer is 401 and the site offers "Sign in with ORCID" first.

---

### User Story 4 - The test site uses ORCID's sandbox; nothing touches production ORCID (Priority: P2)

The maintainer installs the sandbox client's id and secret in the test site's private settings. The test site then signs in against ORCID's sandbox and writes works to sandbox accounts only. No automated test, on any machine, ever calls ORCID's production servers, and a deployment cannot be pointed at production ORCID by accident.

**Why this priority**: it is the gate between "built against a stub" and "known to work with ORCID", and the guarantee that testing never writes to a real researcher's record.

**Independent Test**: on the test site, with sandbox settings, sign in as a sandbox account and claim; the works appear in that sandbox record. With the production authorise address configured and no explicit production switch, the feature reports itself disabled.

**Acceptance Scenarios**:

1. **Given** no ORCID settings, **When** the content service starts, **Then** the ORCID endpoints answer as disabled (FR-019) and the site shows no ORCID buttons.
2. **Given** settings that name ORCID's production servers but not the explicit production switch, **When** the content service starts, **Then** the feature is disabled and the start-up log says why (without any secret).
3. **Given** the test suites, **When** they run, **Then** every ORCID call goes to the stub, on the loopback interface; a call to any other ORCID address fails the test.

---

### User Story 5 - Reactome keeps a record of what was claimed (Priority: P3)

After each claim, the stable ids of the works ORCID added, with the ORCID iD and ORCID's put-codes and dates, are recorded where the team's claim reports read them, as they were before. No access token is recorded anywhere.

**Why this priority**: the team's claim reports depend on it, but a claim succeeds for the researcher without it.

**Independent Test**: with the record store replaced by a stub, a claim of three works that ORCID adds sends one record per added work, with the fields in [data-model.md](data-model.md), and nothing else; with the store down, the claim still answers its summary.

**Acceptance Scenarios**:

1. **Given** a claim where ORCID added 3 works and reported 2 conflicts, **When** it finishes, **Then** 3 claim records are sent, each with stable id, ORCID iD, put-code, created and last-modified dates.
2. **Given** the record store is unreachable, **When** a claim finishes, **Then** the researcher's answer is unaffected and the failure is logged by code, without the ORCID iD.

---

### Edge Cases

- **A person with thousands of works.** A curator with about 3,300 authored reactions means 34 bulk requests. The claim runs them in sequence, within ORCID's rate limit, and the site shows progress as "working" until the summary arrives (FR-012's time budget).
- **An event that is both authored and reviewed** by the same person is sent once, as both, never twice.
- **An event listed once per edit.** The node person lists already list an event once, at its latest edit (a difference spec 006 declares); the claim uses them as they are.
- **A pathway with a DOI** gets the DOI as a second identifier; a reaction never does, as before.
- **An event with no edit date** is sent without a publication date.
- **ORCID's answer to a batch is an error for the whole batch** (400, 500, timeout): the claim stops; earlier batches stand; the summary says how many were added and that the rest were not attempted.
- **The sign-in is older than its limit** (FR-008): the next request answers 401 and the site offers sign-in again.
- **The content service restarts**: every session is gone, and visitors sign in again (FR-007).
- **The return address in `login`** is anything but a path on this site (`//evil.example`, `https://…`, `javascript:`): it is replaced by the site's home page, never followed.
- **Two tabs**: a sign-in started in one tab and finished in another works, since `state` is checked against the session cookie, not the tab.
- **Cookies refused by the browser**: the callback cannot match `state` and fails with "sign-in could not be completed"; the site's message mentions cookies.
- **A sandbox ORCID iD on the test site** can never equal a real Person's recorded iD, so Story 2 cannot be shown on the test site without a test-only mapping (FR-022, and the open question there).

## Requirements _(mandatory)_

### Functional Requirements

#### The endpoints

- **FR-001**: The node content service MUST serve the ORCID family under `/ContentService/orcid/`, as one family module, with each endpoint's behaviour as [contracts/endpoints.md](contracts/endpoints.md) gives it. Every route takes a trailing slash, as Spring's did. None is ever answered by Java, as a fallback or otherwise.
- **FR-002**: The callback MUST also be served at `/content/orcid/callback`, the old module's address, with identical behaviour, so that either redirect URI registered with ORCID works and production can switch without registering a new one.
- **FR-003**: `/orcid/token` MUST NOT be served (a 404, as any unknown route): the code is exchanged by the callback on the server, and never reaches the site.
- **FR-004**: The five claim endpoints MUST keep the old module's paths (`/orcid/claim/all|pa|pr|ra|rr`), method (POST), body (the Person's dbId or ORCID iD, as plain text) and success answer (`ClaimingSummary`'s five counts, same names, same meaning).
- **FR-005**: Each answer's JSON shape MUST be a type in `projects/contract/` (spec 016), written through it by the service and read through it by the site, with a row in `routes.ts` and the regenerated OpenAPI description.

#### Sign-in and sessions

- **FR-006**: Sign-in MUST use OAuth 2.0's authorisation-code flow with a confidential client, a single-use random `state` (at least 128 bits) bound to the visitor's session cookie and good for ten minutes, and PKCE (S256) if ORCID's Member API accepts it (research R4); the code is exchanged on the server, with the client secret, once.
- **FR-007**: The access token, and everything ORCID returns with it, MUST be kept only in the content service's memory, in a server-side session the browser knows only by an opaque random identifier. The browser never receives the token, the refresh token or the code. Nothing writes them to disk, a database, another service or a log.
- **FR-008**: A session MUST end after 30 minutes without a request, 8 hours after sign-in, at sign-out, when ORCID rejects its token, or when the service restarts. The session identifier MUST be replaced at sign-in (no fixation).
- **FR-009**: The session cookie MUST be `HttpOnly`, `Secure` (except on a loopback development address), `SameSite=Lax` (so it reaches the callback, a top-level navigation from ORCID), path `/` (the callback has two addresses under different prefixes, research R3), and carry no data but the identifier.
- **FR-010**: Every POST in the family MUST be refused (403) unless its `Origin` header is the site's own; sign-out MUST be a POST.
- **FR-011**: The `login` endpoint MUST accept a return path and send the visitor back to it after sign-in only if it is a path on this site (begins with a single `/`, no scheme, no host, no backslash); otherwise the site's home page.

#### Claiming

- **FR-012**: A claim MUST read the person's authored and reviewed pathways and reactions with the same queries as the Person page's four lists (`/data/person/{id}/…`), send an event both authored and reviewed once as both, build each work as [contracts/orcid-works.md](contracts/orcid-works.md) gives it, send at most 100 works per request to ORCID's Member API v3.0, in sequence, each with a 30-second limit, and answer within 5 minutes or stop and say how far it got.
- **FR-013**: A claim MUST be refused unless the session's ORCID iD equals the Person's recorded ORCID iD (case-insensitively, as before): 404 when there is no such Person, 403 when the Person has no ORCID iD or a different one. The ORCID iD a claim writes to is always the session's, never one from the request.
- **FR-014**: At most one claim MUST run per session at a time (409 for another).
- **FR-015**: Errors MUST be answered in the family's envelope (the old module's `ResponseError` keys) with a `user-message` fit to show and an `error-code` the site can branch on; never with ORCID's own developer text, a token, or a stack trace.

#### Tokens at ORCID

- **FR-016**: At sign-out and at session expiry, the service MUST [NEEDS CLARIFICATION: revoke the access token at ORCID, or leave Reactome's grant in place? Recommendation: revoke, best effort, with ORCID's revocation endpoint (research R5). Reactome never uses a token after the session, so a long-lived grant (ORCID's tokens last about 20 years) is risk with no use; a future feature that updates works would ask the researcher again.]

#### Disabled, sandbox and production

- **FR-017**: The ORCID client id, client secret, ORCID's authorise and API base addresses, the site's origin and the redirect URI MUST be read from the environment (the host's private settings); none is in the repository, a log, or an answer.
- **FR-018**: The feature MUST be enabled exactly when those settings are complete and valid. This replaces the old machine-name gate.
- **FR-019**: When disabled, `GET /orcid/authenticated` MUST answer `{"enabled":false,"signedIn":false}`, every other ORCID endpoint 404 in the family's envelope, and the site MUST show no ORCID control.
- **FR-020**: Settings naming ORCID's production servers MUST leave the feature disabled unless an explicit production switch is also set; this spec does not set it anywhere.
- **FR-021**: No automated test MUST send a request to any ORCID server; tests use a stub on the loopback interface, and a request elsewhere fails the test.
- **FR-022**: On the test site, a sandbox ORCID iD MUST be matched to a Person by [NEEDS CLARIFICATION: how? Recommendation: a test-only setting that maps one sandbox iD to one Person's dbId, honoured only when the sandbox or stub is configured (never with production settings), naming a Person whose owner has agreed to it; the alternatives are a synthetic Person in the test graph only, or no claim test on the test site.]

#### The record of claims

- **FR-023**: After each claim, the service MUST [NEEDS CLARIFICATION: send one record per work ORCID added (stable id, ORCID iD, put-code, created and last-modified dates) to the host's report webapp, which keeps owning the record and its reports — or keep its own, or none? Recommendation: the report webapp, through its existing claim-register call, fire-and-forget as `report.ts` already reports searches, sending claims only and never a token; the old module's separate sign-in record is not sent.]

#### Privacy and logging

- **FR-024**: The service MUST NOT log access tokens, refresh tokens, codes, `state`, session identifiers, cookies, names or ORCID iDs. Failures are logged by error code and counts. The web server's access log MUST NOT record the callback's query string.
- **FR-025**: Every answer in the family MUST carry `Cache-Control: no-store`; the callback's redirect MUST carry `Referrer-Policy: no-referrer`.
- **FR-026**: Tests, fixtures and recordings MUST use placeholder people and ORCID iDs from the stub or the sandbox only: no real person's name, iD, record or token in the repository, logs or test output.
- **FR-027**: The site's privacy notice MUST say what the ORCID sign-in keeps (the session in memory for at most 8 hours; the claim records, per FR-023) before the feature is offered on the test site, in wording the maintainer approves.

#### Rate limits

- **FR-028**: The web server MUST budget the family per client address (its own zone, as the contact form has), and the service MUST stay within ORCID's published request rate for its own calls.

#### The site

- **FR-029**: The Person page MUST show, when the feature is enabled: "Sign in with ORCID" to a visitor not signed in; when signed in as the page's person, "Claim all your works" and the four narrower claim buttons beside their lists, each with a confirmation that states how many works will be added; the signed-in iD and "Sign out"; and, when signed in on a page whose Person has no or another ORCID iD, "Let us know your ORCID".
- **FR-030**: The site MUST have an `/orcid-callback` route that shows the sign-in's outcome (success, declined, failed) in words, and returns to the Person page the sign-in started from.
- **FR-031**: The site MUST show each claim error's `user-message`, and on 401 offer sign-in again.

### Key Entities

- **Sign-in session**: what the service holds for one signed-in browser: the ORCID iD, the name ORCID returned, the access token and its scope and expiry, the sign-in time and last use. In memory only.
- **Pending sign-in**: a sign-in started and not finished: the `state`, the PKCE verifier, the return path, the start time. In memory only, ten minutes.
- **Work**: one pathway or reaction as an ORCID work: title, type, short description, publication date, the stable id and DOI as identifiers, Reactome addresses, and the contributor role.
- **Claiming summary**: the five counts a claim answers.
- **Claim record**: one work ORCID added, for the team's reports: stable id, ORCID iD, put-code, created and last-modified dates.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On the test site with sandbox credentials, a sandbox account completes sign-in, a claim of all its mapped Person's works, and sign-out, and the works appear in the sandbox record, with no duplicates after a second claim.
- **SC-002**: Every row of [contracts/checks.md](contracts/checks.md) is a test that has been shown failing against a broken implementation before it passed (constitution III).
- **SC-003**: A search of the repository, the service's logs from the test run and the test output finds no access token, code, client secret or real ORCID iD.
- **SC-004**: With no ORCID settings, or with production addresses and no production switch, no ORCID control appears on any Person page and every ORCID endpoint but `authenticated` answers 404.
- **SC-005**: A claim of 3,300 works against the stub completes, in batches of at most 100, within the 5-minute budget.
- **SC-006**: Every difference from the old module is a row in the register of declared differences.

## Assumptions

- The sandbox client is registered by the maintainer with only non-production redirect URIs (`https://<test-site>/content/orcid/callback`, `https://<test-site>/ContentService/orcid/callback` and the same two under `http://localhost:<port>`); its id and secret are installed in the test site's private settings by the maintainer.
- The content service runs as one process per deployment, so an in-memory session store is shared by every request. If it ever runs as several, sessions move to a shared store first (plan, Complexity Tracking).
- The site and the content service are served from the same origin (nginx routes `/ContentService/` on the site's host), so a cookie the service sets is sent with the site's requests.
- Scope `/activities/update` is what Reactome requests, as before; nothing else.
- Out of scope: production credentials, switching production on, updating or deleting works already claimed, and claiming from any page but the Person page.
