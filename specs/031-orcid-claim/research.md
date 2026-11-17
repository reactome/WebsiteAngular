# Research: ORCID "Claim your work" on the node content service

Decisions taken in writing this spec, each with what was considered. Sources: data-content's `org.reactome.server.orcid` package and its pages (the Person page's claim buttons, the callback page, the error handler); the reverted May 2026 ContentService port and its revert; the class and field names of the host's report webapp (no data read); ORCID's public documentation as known when writing, to be checked where marked **verify** (T003). No request was made to ORCID or to any Reactome service.

## R1. Home: node, one family

**Decision**: a family module `tools/content-node/orcid-endpoints.ts`, with shared modules beneath it: `orcid-client.ts` (every call to ORCID), `sessions.ts` (the session store and its cookie), and the Person lists' query moved out of `person-endpoints.ts` into a shared module so that two families can read it (a move, proved by `scripts/check-move.mjs`).

**Why**: spec 010's rule (logic Reactome writes for the website, no Java library at its core) and the maintainer's decision of 16 Nov 2026. Spec 014's layout: a family imports only shared modules and leaves; `boundaries.spec.ts` holds it.

**Rejected**: the Java ContentService (decided against); a separate service (a second process, image and nginx upstream for twelve routes, and a second reader of the Person lists).

## R2. Endpoint shapes: keep the old where safe, declare the rest

Nothing serves these endpoints, so there is no live answer to be byte-identical to. The claims (paths, method, body, `ClaimingSummary`) and sign-out's body are kept, because the site's code and the user guide describe them and nothing about them is unsafe. Changed: the callback (finishes the exchange itself), `token` (retired), sign-out (POST), `authenticated` (says whether the feature is on, and who is signed in), `works` (narrowed), `let-us-know-your-orcid` (no token, no captcha key), error statuses. Each is a row in the register of declared differences, added with this spec.

## R3. Sessions: server-side, in memory, opaque cookie

**Decision**: a `Map` in the content service's memory from a 256-bit random identifier to the session; cookie `reactome_orcid` (`HttpOnly`, `Secure` except on a loopback development address, `SameSite=Lax`, `Path=/`), holding only the identifier. Pending sign-ins live in the same store for ten minutes. Idle limit 30 minutes, absolute 8 hours. At most 10,000 sessions; past that, the least recently used goes (measured need is a handful at a time: the old feature's claims were counted in a daily digest).

**Why**: the token is a bearer credential for writing to a researcher's ORCID record, valid for years. Kept on the server, a script injected into the site cannot read it; kept in memory, it never reaches a disk, a backup or another service. A restart signs everyone out, which costs a researcher one more sign-in.

**`Path=/`**: the callback is served at `/ContentService/orcid/callback` and `/content/orcid/callback` (FR-002); a cookie scoped to either prefix would not reach the other. The cookie's name is the family's own, and nothing else on the site reads it.

**`SameSite=Lax`, not `Strict`**: ORCID's redirect back to the callback is a cross-site top-level navigation; `Strict` would withhold the cookie there and fail every sign-in.

**Rejected**: Express's session middleware (a dependency for one map, and its defaults would need overriding one by one); a signed or encrypted cookie holding the token (the token would then sit in the browser, encrypted or not, and could not be revoked by deleting it on our side); a database (a store of long-lived credentials is the thing to avoid).

**One process**: the service runs as one process per deployment today. If that changes, sessions need a shared store first; the plan's Complexity Tracking names it.

## R4. `state` and PKCE

**`state`**: required. 32 random bytes, base64url, bound to the cookie's pending sign-in, compared in constant time, deleted on first use, ten minutes. The old module sent none, so a visitor could be signed in to an account of someone else's choosing (login CSRF), and could then claim works into it.

**PKCE (S256)**: ORCID's OAuth server is an implementation of the standard authorisation-code flow; whether its Member API token endpoint accepts and checks `code_verifier` for a confidential client is to **verify** on the sandbox (T003). If it does, send it: it binds the code to this sign-in even if the code leaks. If ORCID ignores it, sending it is harmless but proves nothing, and the spec's protection rests on `state`, the client secret and the server-side exchange. The stub checks it either way, so the code is ready.

**OpenID Connect `nonce`**: not used. Reactome requests `/activities/update`, not `openid`; the iD comes back in the token answer.

## R5. Token lifetime and revocation

ORCID's access tokens are long-lived (the old module's own comment shows an `expires_in` of about 20 years). Reactome uses a token only within the session that obtained it.

**Revocation**: ORCID documents a revocation endpoint for member clients (`/oauth/revoke`, client credentials and the token; **verify** on the sandbox, T003). The recommendation in FR-016 is to call it, best effort, at sign-out and at expiry, so that no grant outlives the session. The alternative, keeping the grant, only makes sense if Reactome will later write to records unprompted (for instance to update claimed works when an event changes), which nothing does or plans; that is the open question.

**Refresh tokens**: never used; discarded on receipt.

## R6. ORCID Member API version

The old module called v2.1. ORCID's current Member API is v3.0, and ORCID has been retiring v2.x (**verify** dates, T003). The port uses v3.0. The names change (`type` `data-set`, lower-case contributor roles and sequences, the `application/vnd.orcid+json` media type, put-codes and dates in the same places); what is sent does not ([contracts/orcid-works.md](contracts/orcid-works.md)). The bulk limit stays 100 works per request (**verify**).

**Roles kept as they were**: a reviewer is written as contributor role `assignee`, sequence `additional`, as the old module wrote it. ORCID's role vocabulary has no "reviewer" for works; changing the mapping would make re-claimed works differ from those already in researchers' records. A change is a separate decision.

## R7. `{orcid}/works`

The old endpoint passed ORCID's whole works list through, which carries every work in the record, from every source, and nothing in the old site called it. The new answer keeps the same checks but narrows to the works Reactome's client added (`source-client-id` equals the client id), as `OrcidWork`: what the site needs to mark "already in your ORCID record". Whether `/activities/update` lets Reactome read its own works whatever their visibility is to **verify** (T003); ORCID's documentation says a source can read the items it added.

## R8. Turning the feature on and off

The old gate compared the server's machine name with a configured one, so a copy of the configuration on another machine was off, and on the production machine it was on whatever the credentials. The replacement: on exactly when all settings are present and valid (`ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET`, `ORCID_AUTH_BASE`, `ORCID_API_BASE`, `ORCID_REDIRECT_URI`, `SITE_ORIGIN`, `WORK_SITE_ORIGIN`), and off, with one start-up line naming the missing setting (never its value), otherwise. ORCID's production hosts are refused unless `ORCID_PRODUCTION=1` is also set, which nothing in this spec sets. The stub's loopback address is accepted only with `ORCID_STUB=1`, which only tests set.

## R9. Rate limits

**Our side**: an nginx zone `orcid_rate`, per client address: 30 requests a minute, burst 10. A sign-in is three requests (login, callback, authenticated); a claim one; a page view one (`authenticated`). Applied to `/ContentService/orcid/` and the old callback address.

**ORCID's side**: ORCID publishes per-client limits for the Member API (of the order of tens of requests a second, with a burst; **verify**, T003). A claim's batches are sent in sequence, one at a time, so a single claim cannot approach them; FR-014's one-claim-per-session and nginx's zone bound the total.

## R10. The record of claims, and what is not recorded

The old module sent two things to the host's report webapp, fire-and-forget: each claim's added works (stable id, ORCID iD, put-code, created and last-modified dates), and a record of each sign-in. The report webapp keeps them (its classes `OrcidClaim`, keyed by stable id and iD; a sign-in class; `OrcidDigester`, a per-person count) and mails a daily and weekly claiming digest to the team (`OrcidReportScheduler`).

**Recommendation** (FR-023, open question): send the claim records to the report webapp through the same call the old module used, as `report.ts` already sends search reports there (its address and credentials are settings the service already has); send **no** sign-in record: the reports do not need one, and the sign-in carries the access token, which leaves the service's memory for nowhere. The report webapp's digest keeps working on claims. Replacing the report webapp, or the store it keeps, is not this spec's.

**Alternatives**: node keeps its own record (a second store of the same facts, and the digest would not see it); no record (the team loses its claiming reports).

## R11. Sandbox accounts and the Person check

A claim is allowed only when the session's iD equals the Person's recorded iD. ORCID's sandbox issues its own iDs; none equals a real contributor's. So on the test site, with the real graph, no sandbox account can claim anything unless something maps one to a Person (FR-022, open question).

**Recommendation**: a test-only setting, `ORCID_TEST_PERSON=<sandbox iD>:<dbId>`, honoured only when the stub or the sandbox is configured, and refused at start-up alongside production settings; it names a Person whose owner has agreed (for instance, a team member's own record), in the host's private settings, never in the repository. The works then go to a sandbox record, which ORCID's sandbox exists for.

**Alternatives**: a synthetic Person in the test graph only (needs a change to the graph the test site serves, which is a release image); no claim on the test site (Story 2 would be proved against the stub only).

## R12. The site

- **Full-page redirect, not a popup**: the old page opened ORCID in a popup and reloaded the opener. Popups are blocked by default in many browsers, and the opener dance needs script on both pages. The new flow navigates away and back, carrying the Person page as `return`.
- **`/orcid-callback`** shows the outcome and navigates to `return` (checked again on the site side: a path on this site) after a short pause, or at once on a click.
- **Claim controls** on the Person page only, as before: "Claim all your works" in the header, the four narrower buttons beside their lists, each with a confirmation stating the count, the summary in a dialog with a link to the researcher's ORCID record.
- **"Let us know your ORCID"** opens a small form (name, e-mail, the pre-filled subject and message, the Turnstile widget) that posts to `POST /ContentService/contact`, the content service's help-desk endpoint (spec 006 D23), so the human check, limits and mail path are the ones already reviewed.
- **The user guide** (`documentation/userguide/claim-your-work.mdx`) describes the popup; T025 updates its words. Its screenshots wait for the curator's new ones.

## R13. Privacy

What the feature handles: researchers' ORCID iDs and names (from ORCID's token answer), their access tokens, and which Reactome events they claimed.

| Data                         | Where                                   | How long                                       | Who can read it                           |
| ---------------------------- | --------------------------------------- | ---------------------------------------------- | ----------------------------------------- |
| Access token, iD, name       | Content service memory (session)        | ≤ 30 minutes idle, ≤ 8 hours, ends at sign-out | No one: never answered, logged or written |
| iD, name                     | The signed-in browser (`authenticated`) | The page's life                                | That browser                              |
| Claim records (no token)     | Report webapp (if FR-023 decides so)    | As the report webapp keeps them today          | The team, via its reports, as today       |
| Callback query (code, state) | Nowhere: nginx logs off for it          | —                                              | —                                         |

The privacy notice already covers contributors' names and iDs for credit attribution; T025 adds a paragraph on the sign-in, for the maintainer's approval (FR-027).

**Tests and fixtures**: the stub's accounts are placeholder people (`Placeholder Researcher`) with iDs from ORCID's documentation examples (`0000-0002-1825-0097`, ORCID's fictitious example researcher) or issued by the stub from a reserved range it documents, never a contributor's. The fixture Persons are placeholders too, under the repository's fixture rule (placeholder all people and the free text that cites them).
