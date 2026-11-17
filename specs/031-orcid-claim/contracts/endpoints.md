# Contract: the ORCID endpoints

Every path is under `/ContentService` unless it starts with `/content`, and each takes a trailing slash. "Old" is data-content's `org.reactome.server.orcid` package as read on 17 Nov 2026 (the May 2026 ContentService port, reverted, differed only where noted). Nothing serves any of them today, so every change below is a declared difference (rows in `documentation/declared-differences.md`, added with this spec), not a parity break.

**The family's error envelope** is the old module's `ResponseError`, all five keys always written:

```json
{
  "response-code": "403",
  "developer-message": null,
  "user-message": "You can claim works only on your own Person page.",
  "error-code": "orcid.person-mismatch",
  "more-info": null
}
```

Old: `user-message` only, the other four `null`, from `GlobalExceptionHandler.toJsonResponse`; a missing session was a bare 401 with no body. New: `response-code` is the status, `error-code` is one of the codes below, and the 401 has the envelope too. The type is `OrcidError` in `projects/contract/orcid.ts`.

**Every answer** carries `Cache-Control: no-store`.

## Summary table

| #   | Method, path                                         | Old                                                                                                                                                                     | New                                                                                                                                                                                                     | Same shape?            |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | GET `/orcid/login`                                   | 302 to ORCID authorise; no `state`; redirect URI built from the request's host (https only on the production host)                                                      | 302 to ORCID authorise with `state` (and PKCE, R4); redirect URI from settings; optional `?return=<site path>`                                                                                          | Same (302); new inputs |
| 2   | GET `/orcid/callback`, GET `/content/orcid/callback` | Old: a page that called `/orcid/token?code=…` from script, then closed its popup. Reverted port: 302 to `/orcid-callback?ok=true&code=…`                                | Checks `state`, exchanges the code on the server, creates the session, 302 to `/orcid-callback?outcome=signed-in&return=…` (or `outcome=declined` / `outcome=failed`); the code never leaves the server | Changed (security)     |
| 3   | GET `/orcid/token?code=`                             | Exchanged the code; set the session; `true`, or 401 with ORCID's error description                                                                                      | **Not served** (404): folded into the callback                                                                                                                                                          | Retired (security)     |
| 4   | GET `/orcid/signout`                                 | Invalidated the session; `success` (text)                                                                                                                               | **POST** `/orcid/signout`, same-origin only; deletes the session, clears the cookie, revokes the token (FR-016); 200 `success` (text). GET answers 405                                                  | Same body; method POST |
| 5   | GET `/orcid/authenticated`                           | `true` / `false`                                                                                                                                                        | `{"enabled":bool,"signedIn":bool,"orcid"?:string,"name"?:string}`: `orcid` and `name` only when signed in, only to that session                                                                         | Changed (design)       |
| 6   | POST `/orcid/claim/all`                              | Body: person id (text). Checks session, person, iD match; sends authored, reviewed and both, ≤100 per call, ORCID API v2.1; records the put-codes; `ClaimingSummary`    | Same body, same answer; ORCID API v3.0; statuses per below                                                                                                                                              | Same                   |
| 7   | POST `/orcid/claim/pa`                               | Pathways authored; as 6                                                                                                                                                 | As 6                                                                                                                                                                                                    | Same                   |
| 8   | POST `/orcid/claim/pr`                               | Pathways reviewed; as 6                                                                                                                                                 | As 6                                                                                                                                                                                                    | Same                   |
| 9   | POST `/orcid/claim/ra`                               | Reactions authored; as 6                                                                                                                                                | As 6                                                                                                                                                                                                    | Same                   |
| 10  | POST `/orcid/claim/rr`                               | Reactions reviewed; as 6                                                                                                                                                | As 6                                                                                                                                                                                                    | Same                   |
| 11  | GET `/orcid/{orcid}/works`                           | Checks session and that `{orcid}` is a Person whose iD is the session's; passes ORCID's v2.1 works list through (`Works`)                                               | Same checks; answers the works **Reactome added** to the record, narrowed: `[{putCode, stId, title, type, url, createdDate, lastModifiedDate}]` (R7)                                                    | Changed (design)       |
| 12  | GET `/orcid/let-us-know-your-orcid`                  | A page: the contact form pre-filled (subject, message with the iD), with the captcha key. Reverted port: JSON `{title, subject, message, tokenSession, captchaSiteKey}` | JSON `{title, subject, message}`; optional `?person=<id>` adds the Person page's address to the message; never the token (the reverted port returned it) and no captcha key (the site has its own)      | Changed (security)     |

Twelve rows for the old module's eleven endpoints: the callback is served at two addresses (FR-002).

## Each endpoint

### 1. `GET /orcid/login`

- **Inputs**: `return` (optional): a path on this site. Anything not starting with exactly one `/`, or containing `\`, a scheme or a host, is replaced by `/`.
- **Does**: creates a pending sign-in (R3) under a new session cookie, or the existing one; `state` = 32 random bytes, base64url; PKCE verifier and S256 challenge if R4 holds.
- **Answers**: 302, `Location: {ORCID_AUTH_BASE}/oauth/authorize?client_id=…&response_type=code&scope=%2Factivities%2Fupdate&redirect_uri=…&state=…[&code_challenge=…&code_challenge_method=S256]`; `Set-Cookie` per FR-009.
- **Errors**: disabled: 404 envelope, `orcid.disabled`. Too many pending sign-ins for one cookie (more than 5): the oldest is dropped.

### 2. `GET /orcid/callback` and `GET /content/orcid/callback`

- **Inputs**: `code`, `state`, or `error`, `error_description`, `state` (ORCID's).
- **Does**: finds the pending sign-in by the cookie and `state` (constant-time compare; single use; ten minutes). With a code, POSTs `{ORCID_AUTH_BASE}/oauth/token` (form: `client_id`, `client_secret`, `grant_type=authorization_code`, `code`, `redirect_uri`, and `code_verifier` if R4), 30-second limit; on 200 with `access_token`, `orcid`, `scope` containing `/activities/update`: deletes the pending sign-in, creates a session under a **new** identifier, sets its cookie.
- **Answers**: always 302 to the site, `Referrer-Policy: no-referrer`:
  - `/orcid-callback?outcome=signed-in&return=<path>`
  - `/orcid-callback?outcome=declined&return=<path>` (`error=access_denied`)
  - `/orcid-callback?outcome=failed&reason=<code>&return=<path>`, `reason` one of `state` (missing, unknown, used or expired), `exchange` (ORCID refused or did not answer), `scope` (granted less than asked).
  - Never ORCID's `error_description` (it is ORCID's text, shown by ORCID already) and never the code.
- **Errors**: disabled: 404 envelope.

### 3. `GET /orcid/token`

Not served. 404, as any route the service does not have.

### 4. `POST /orcid/signout`

- **Inputs**: the session cookie; `Origin` must be the site's (FR-010).
- **Does**: deletes the session; clears the cookie (`Max-Age=0`); revokes the token at ORCID (FR-016), best effort, not waited on.
- **Answers**: 200, `text/plain`, `success` (as before), also when there was no session.
- **Errors**: wrong or missing `Origin`: 403 `orcid.origin`. GET: 405.

### 5. `GET /orcid/authenticated`

- **Answers**: 200, JSON (`OrcidStatus`): `{"enabled":false,"signedIn":false}` when disabled; `{"enabled":true,"signedIn":false}`; `{"enabled":true,"signedIn":true,"orcid":"0000-0002-1825-0097","name":"Placeholder Researcher"}`.
- Touches the session's last use. Never answers an error but 500.

### 6–10. `POST /orcid/claim/{all|pa|pr|ra|rr}`

- **Inputs**: body, `text/plain` (or any type, read as text, as Spring's `@RequestBody String` did), at most 64 bytes: a Person's dbId or ORCID iD, trimmed. `Origin` must be the site's.
- **Does**, in order: session (401) → origin (403) → claim already running for the session (409) → Person found by the same rule as `/data/person/{id}` (404) → Person has an ORCID iD (403 `orcid.person-without-orcid`) → equals the session's, ignoring case (403 `orcid.person-mismatch`) → reads the lists (`all`: the four; `pa`: authored pathways; `pr`: reviewed pathways; `ra`: authored reactions; `rr`: reviewed reactions) → for `all`, the events in both an authored and a reviewed list (by stable id) move to "both", per kind → builds works ([orcid-works.md](orcid-works.md)) → POSTs `{ORCID_API_BASE}/v3.0/{session iD}/works` with `Authorization: Bearer …`, at most 100 per request, in sequence → records the added works (FR-023).
- **Answers**: 200 `ClaimingSummary`:

  ```json
  { "total": 12, "totalExecuted": 12, "totalIncluded": 9, "totalConflict": 3, "totalErrors": 0 }
  ```

  `total`: works to send; `totalExecuted`: works sent; `totalIncluded`: bulk items ORCID answered with a work; `totalConflict`: items ORCID answered with error 409 (already in the record); `totalErrors`: other per-item errors. As before.

- **Errors**: 401 `orcid.signed-out` (no session, or ORCID answered 401: the session is then ended); 403 `orcid.origin`, `orcid.person-without-orcid`, `orcid.person-mismatch`; 404 `orcid.person-not-found`; 409 `orcid.claim-running`; 413 for a body over 64 bytes; 502 `orcid.unavailable` when a batch failed as a whole or timed out, with `user-message` stating how many works were added before it ("ORCID did not accept the request. 200 of 640 works were added; claiming again will add the rest without duplicating them."); 504 `orcid.too-long` past the 5-minute budget, worded the same way.
- **Old statuses**: not found, no iD and mismatch were 500 with `user-message` naming both iDs; ORCID's 401 was 401; any other ORCID error was 500 with ORCID's message. The new answers never name an iD other than the caller's own.

### 11. `GET /orcid/{orcid}/works`

- **Inputs**: `{orcid}`: a Person's ORCID iD (or dbId, as before: the old lookup took either).
- **Does**: the checks of 6–10 but the origin check (a GET); GETs `{ORCID_API_BASE}/v3.0/{session iD}/works`; keeps the summaries whose source is Reactome's client id.
- **Answers**: 200, JSON array (`OrcidWork[]`), sorted by stable id.
- **Errors**: as 6–10, without 409 and 413.

### 12. `GET /orcid/let-us-know-your-orcid`

- **Inputs**: `person` (optional): a Person's dbId or ORCID iD; ignored unless it names a Person.
- **Answers**: 200 JSON (`OrcidContactText`): `title` "Let us know your orcid", `subject` "[ORCID] Please add my orcid into Reactome", `message` the old text with the session's iD, followed, when `person` names one, by a line `Person page: {SITE_ORIGIN}/content/detail/person/{dbId}`.
- **Errors**: 401 `orcid.signed-out`.

## Routing

- nginx (`deploy/nginx/common/routes.conf`, deployed environments): one regex location for `^/ContentService/orcid/` and one exact location for `/content/orcid/callback` (and its trailing slash), both to the content service, with their own `limit_req` zone (`orcid_rate`, R9), `access_log off` on the callback locations, and a read timeout of 330 seconds on the claim locations.
- The dev proxy (`proxy.conf.js`) carries the same two entries; `deploy/nginx/routes.spec.ts` checks they agree.
- `/orcid-callback` is a site route (Angular), served as any page.
