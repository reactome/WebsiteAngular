# Quickstart: trying "Claim your work"

Three ways, from no credentials to the sandbox. None of them touches ORCID's production servers; the service refuses them without `ORCID_PRODUCTION=1`, which nothing here sets.

## 1. The checks (no credentials, no network)

```bash
npx vitest run tools/content-node/orcid tools/orcid-stub
npx playwright test --project=code e2e/orcid.spec.ts
```

The service's specs start the stub ORCID on a loopback port of their own; the site's spec answers `/ContentService/orcid/**` itself. A request to any other ORCID address fails the run (C17).

## 2. The whole flow on a development machine, against the stub

```bash
# the stub, on loopback; it prints its base address and its placeholder accounts
node tools/orcid-stub/stub.ts --port 4460

# the content service, pointed at it (placeholder values; nothing secret)
ORCID_STUB=1 \
ORCID_CLIENT_ID=APP-STUB000000000000 ORCID_CLIENT_SECRET=stub-secret \
ORCID_AUTH_BASE=http://127.0.0.1:4460 ORCID_API_BASE=http://127.0.0.1:4460 \
ORCID_REDIRECT_URI=http://localhost:4200/ContentService/orcid/callback \
SITE_ORIGIN=http://localhost:4200 WORK_SITE_ORIGIN=https://<public-site> \
ORCID_TEST_PERSON=<stub iD>:<fixture Person dbId> \
node tools/content-node/server.ts

# the site, through the dev proxy (which sends /ContentService/orcid/ to the service)
npm start
```

Open a Person page, press "Sign in with ORCID". The stub's authorise page offers "Approve" and "Decline" for its placeholder accounts. Approve, land on `/orcid-callback`, return to the Person page, claim. The stub prints its tallies (works received, conflicts, batches) for comparison with the summary.

## 3. The test site, against ORCID's sandbox

Prerequisites (the maintainer; T001):

1. The sandbox client, registered through ORCID's "Register a client application: Sandbox Member API" form, with only these redirect URIs:
   - `https://<test-site>/content/orcid/callback`
   - `https://<test-site>/ContentService/orcid/callback`
   - `http://localhost:<port>/content/orcid/callback`
   - `http://localhost:<port>/ContentService/orcid/callback`
2. Its id and secret, in the test site's private settings, beside `ORCID_AUTH_BASE=https://sandbox.orcid.org`, `ORCID_API_BASE=https://api.sandbox.orcid.org`, `ORCID_REDIRECT_URI` (one of the two test-site URIs), `SITE_ORIGIN=https://<test-site>`, `WORK_SITE_ORIGIN`, and the `ORCID_TEST_PERSON` mapping if FR-022 is decided so. Nothing in the repository.
3. A sandbox ORCID account (ORCID's sandbox sends no mail to real addresses; use an address you control on a domain ORCID's sandbox accepts).

Then: redeploy the content service; open the mapped Person's page on the test site; sign in with the sandbox account; claim all; check the works in the sandbox record; claim again (all conflicts, no duplicates); sign out; check `authenticated` says signed out and (if FR-016 is decided so) the grant is gone from the sandbox account's trusted organisations.

## What to look for in the logs

Counts and error codes only. If a token, code, secret, iD or name ever appears in the service's log, stop and file it: it is a failure of FR-024, whatever else works.
