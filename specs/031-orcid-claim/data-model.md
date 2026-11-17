# Data model: ORCID "Claim your work"

Two kinds of thing: what the content service holds in memory, and what crosses a boundary (to the site, to ORCID, to the report webapp). The answer types are in `projects/contract/orcid.ts` (spec 016: types only, written through by the service, read by the site).

## Held in memory (`tools/content-node/sessions.ts`)

Never answered, logged or written anywhere.

### PendingSignIn

| Field       | Type   | Notes                                                  |
| ----------- | ------ | ------------------------------------------------------ |
| `state`     | string | 32 random bytes, base64url; the key it is found by     |
| `verifier`  | string | PKCE code verifier, 32 random bytes, base64url (if R4) |
| `returnTo`  | string | A path on this site, already checked (FR-011)          |
| `startedAt` | number | Milliseconds; gone after 10 minutes                    |

At most five per session cookie; a sixth drops the oldest. Deleted on first use.

### Session

| Field        | Type    | Notes                                                                      |
| ------------ | ------- | -------------------------------------------------------------------------- |
| `id`         | string  | 32 random bytes, base64url; the cookie's value; replaced at sign-in        |
| `orcid`      | string  | From ORCID's token answer, `NNNN-NNNN-NNNN-NNNX`                           |
| `name`       | string  | From ORCID's token answer; may be empty (the researcher's choice at ORCID) |
| `token`      | string  | The access token                                                           |
| `scope`      | string  | Must include `/activities/update`                                          |
| `expiresAt`  | number  | From ORCID's `expires_in`; a session past it ends                          |
| `signedInAt` | number  | Absolute limit: 8 hours                                                    |
| `lastSeenAt` | number  | Idle limit: 30 minutes                                                     |
| `claiming`   | boolean | One claim at a time (FR-014)                                               |

ORCID's `refresh_token` is not kept. **States**: none → pending (login) → signed in (callback) → ended (sign-out, limit, ORCID 401, restart). A pending sign-in that fails leaves no session.

## Answers (`projects/contract/orcid.ts`)

```ts
/** GET /orcid/authenticated */
export interface OrcidStatus {
  enabled: boolean;
  signedIn: boolean;
  /** Only when signed in. */
  orcid?: string;
  /** Only when signed in; ORCID's name for the account. */
  name?: string;
}

/** POST /orcid/claim/{all|pa|pr|ra|rr}: the old module's ClaimingSummary, unchanged. */
export interface ClaimingSummary {
  total: number;
  totalExecuted: number;
  totalIncluded: number;
  totalConflict: number;
  totalErrors: number;
}

/** GET /orcid/{orcid}/works: one work Reactome added to the record. */
export interface OrcidWork {
  putCode: number;
  stId: string;
  title: string;
  /** ORCID's work type, `data-set` for every work Reactome adds. */
  type: string;
  url?: string;
  /** ISO 8601, ORCID's. */
  createdDate: string;
  lastModifiedDate: string;
}

/** GET /orcid/let-us-know-your-orcid */
export interface OrcidContactText {
  title: string;
  subject: string;
  message: string;
}

/** Every error the family answers: the old module's ResponseError keys. */
export interface OrcidError {
  'response-code': string;
  'developer-message': null;
  'user-message': string;
  'error-code': OrcidErrorCode;
  'more-info': null;
}

export type OrcidErrorCode =
  | 'orcid.disabled'
  | 'orcid.signed-out'
  | 'orcid.origin'
  | 'orcid.person-not-found'
  | 'orcid.person-without-orcid'
  | 'orcid.person-mismatch'
  | 'orcid.claim-running'
  | 'orcid.too-large'
  | 'orcid.unavailable'
  | 'orcid.too-long';
```

Sign-out answers `success` as text; the callback and login answer redirects. Neither has a JSON type.

## Sent to ORCID

The work and bulk bodies are in [contracts/orcid-works.md](contracts/orcid-works.md); their types live beside the client (`tools/content-node/orcid-client.ts`), not in the contract, because the site never reads them.

## Read from the graph

The Person (by dbId or ORCID iD, the rule `/data/person/{id}` uses: `personWhere` in `person-endpoints.ts`) and its four lists as `SimpleEvent` (`projects/contract/person.ts`): `stId`, `displayName`, `dateTime`, `doi`, `labels`. Nothing else.

## Claim record (sent to the report webapp, if FR-023 decides so)

One per work ORCID added, in the old module's `OrcidClaimRecord` shape, which the report webapp's claim-register call reads:

| Field          | Type   | From                                   |
| -------------- | ------ | -------------------------------------- |
| `stId`         | string | The work's `other-id` identifier       |
| `orcid`        | string | The session's iD                       |
| `putCode`      | number | ORCID's answer                         |
| `created`      | string | ORCID's `created-date`, or empty       |
| `lastModified` | string | ORCID's `last-modified-date`, or empty |

No token, no name. The report webapp keys these by stable id and iD.

## Settings (environment; values only in the host's private settings)

| Name                  | Meaning                                                               |
| --------------------- | --------------------------------------------------------------------- |
| `ORCID_CLIENT_ID`     | The ORCID client's id (sandbox until production switches)             |
| `ORCID_CLIENT_SECRET` | Its secret                                                            |
| `ORCID_AUTH_BASE`     | ORCID's authorise and token host                                      |
| `ORCID_API_BASE`      | ORCID's Member API host                                               |
| `ORCID_REDIRECT_URI`  | One of the registered redirect URIs                                   |
| `SITE_ORIGIN`         | This site's origin: the `Origin` POSTs must carry; where redirects go |
| `WORK_SITE_ORIGIN`    | The public site's origin, written into works                          |
| `ORCID_PRODUCTION`    | `1` to allow ORCID's production hosts; set by no one in this spec     |
| `ORCID_STUB`          | `1` to allow a loopback ORCID; tests only                             |
| `ORCID_TEST_PERSON`   | Sandbox or stub only: `<iD>:<dbId>` (FR-022, if decided so)           |
| `REPORT_URL` etc.     | Already the service's, for the search report (`report.ts`)            |
