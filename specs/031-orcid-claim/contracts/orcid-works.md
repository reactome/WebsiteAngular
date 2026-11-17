# Contract: the works sent to ORCID, and the calls made to it

What the content service sends to ORCID. The stub ORCID (T006) accepts exactly this and refuses anything else, so a test that passes against the stub has sent what this page says.

## Addresses

| Call             | Address                                    | From settings     |
| ---------------- | ------------------------------------------ | ----------------- |
| Authorise (page) | `{ORCID_AUTH_BASE}/oauth/authorize`        | `ORCID_AUTH_BASE` |
| Token            | `{ORCID_AUTH_BASE}/oauth/token`            | `ORCID_AUTH_BASE` |
| Revoke           | `{ORCID_AUTH_BASE}/oauth/revoke` (R5)      | `ORCID_AUTH_BASE` |
| Works (bulk add) | POST `{ORCID_API_BASE}/v3.0/{orcid}/works` | `ORCID_API_BASE`  |
| Works (list)     | GET `{ORCID_API_BASE}/v3.0/{orcid}/works`  | `ORCID_API_BASE`  |

ORCID's public documentation gives the sandbox as `https://sandbox.orcid.org` (authorise, token) and `https://api.sandbox.orcid.org` (Member API), and production as `https://orcid.org` and `https://api.orcid.org`. The production pair is refused without the production switch (FR-020). Every call is HTTPS with the system's certificate authorities, verified by name (the old client accepted any certificate), except to the stub on the loopback interface.

Headers on API calls: `Authorization: Bearer <token>`, `Accept: application/json`, and for the POST `Content-Type: application/vnd.orcid+json`. Each call has a 30-second limit.

## One work

Built from one event of the person lists (`SimpleEvent`, `projects/contract/person.ts`), as the old `OrcidHelper.createWork` built it, in ORCID's v3.0 names:

```json
{
  "title": { "title": { "value": "<event displayName>" } },
  "short-description": "Pathway",
  "type": "data-set",
  "publication-date": {
    "year": { "value": "2019" },
    "month": { "value": "06" },
    "day": { "value": "06" }
  },
  "url": { "value": "{WORK_SITE_ORIGIN}/content/detail/R-HSA-0000000" },
  "external-ids": {
    "external-id": [
      {
        "external-id-type": "other-id",
        "external-id-value": "R-HSA-0000000",
        "external-id-url": { "value": "{WORK_SITE_ORIGIN}/PathwayBrowser/#/R-HSA-0000000" },
        "external-id-relationship": "self"
      },
      {
        "external-id-type": "doi",
        "external-id-value": "10.3180/R-HSA-0000000.1",
        "external-id-url": { "value": "https://doi.org/10.3180/R-HSA-0000000.1" },
        "external-id-relationship": "self"
      }
    ]
  },
  "contributors": {
    "contributor": [
      {
        "contributor-attributes": { "contributor-sequence": "first", "contributor-role": "author" }
      }
    ]
  }
}
```

- `short-description`: `Pathway` when the event's labels include `Pathway`, else `Reaction`.
- `publication-date`: from the event's `dateTime` (the edit's date, as before); left out when it is empty.
- The DOI identifier: pathways only, when `doi` is not blank, as before. Its address is `https://doi.org/…` (old: `http://dx.doi.org/…`, the same resolver).
- `WORK_SITE_ORIGIN` is a setting: Reactome's public site, so a work's links point at the public site even when it is claimed from the test site. The addresses keep the old paths, which the new site still answers.
- Contributors, by role, as before: **author** → one, `first`, `author`; **reviewer** → one, `additional`, `assignee`; **both** → the two.
- The `other-id` value is the stable id, as before: ORCID matches a work already in the record by its identifiers, so a work claimed by the old module and claimed again is a conflict (409), not a duplicate. This is why the type, value and relationship must not change.

## The bulk add

Body `{"bulk":[{"work":…},…]}`, at most 100. ORCID answers 200 with `{"bulk":[…]}`, one item per work in order, each either `{"work":{…,"put-code":…,"created-date":{"value":…},"last-modified-date":{"value":…}}}` or `{"error":{"response-code":409,…}}`. A 401 ends the session (FR-008); any other status, or no answer within 30 seconds, ends the claim (502).

The v2.1 to v3.0 change (R6) alters names (`type` `data-set`, lower-case roles and sequences, the `vnd.orcid+json` media type), not what is sent.
