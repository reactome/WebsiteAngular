# Decisions behind the recorded backend for e2e tests

Each entry: what was decided, why, what was rejected, and the measurement that
settled it. Dates are when the figure was read off this host or CI.

The change these describe is #233. The problem it solves is that CI ran 172 tests
against **https://reactome.org** on every push and every pull request — about
1,400 requests a run, from August 2026 until 2026-09-17. That was introduced in
461bc8f to stop the e2e job hanging on a runner with no local backend: it fixed
the symptom by pointing the test suite at the public site.

---

## D1. Backend responses are recorded and replayed, not fetched

**Decision**: Everything under `/ContentService/`, `/AnalysisService/`,
`/ExperimentDigester/` and `idg.reactome.org` is served from recordings in
`e2e/har/`. CI talks to no server; `REACTOME_BACKEND` names a closed port on
purpose.

**Why**: Two separate harms. The load — 1,400 requests a run against the public
site. And the false failures: a Cloudflare 521 during one run surfaced as
`TimeoutError: page.waitForSelector: Timeout 90000ms exceeded`, which says nothing
about a backend and teaches people to press re-run.

**Measured** (2026-09-17): the trace from a failed run showed **eight** consecutive
`521` responses from production, with the page snapshot still showing a loading
spinner after 90s. The tests were not flaky; production was down.

**Rejected**: pointing CI at this box instead. Simpler, one line, and it keeps the
real backend in the loop — but it moves ~1,400 requests a run onto the machine
curators use for QA. Rejected on that, not on principle.

**Cost, stated plainly**: these tests no longer prove the backend works. They prove
the app renders recorded data. If ContentService changes shape they stay green.

---

## D2. One recording per test, not per spec file

**Decision**: `e2e/har/<spec>--<test>-<digest>.har`.

**Why**: Playwright writes the HAR when a browser **context** closes, and every
test has its own context. Per-spec files meant tests overwrote each other and the
last one won.

**Measured** (2026-09-17), per-spec recordings:

    content-pages              18 tests ->  5 recorded entries
    custom-interactor-dialog    9 tests ->  0 recorded entries

`custom-interactor-dialog` was empty because its final test skips, closing a
context that had requested nothing over the top of eight that had. The same fault
left **78 orphaned response bodies, 6.17 MB** — every test wrote its bodies, only
the last wrote an index.

**Rejected**: recording serially to avoid the overwrite. Tried it — 38 minutes
instead of 13, and it did not help, because the overwrite is per context and not a
race between workers. That was a misdiagnosis that cost two recording passes.

---

## D3. Entries match on method, path and query — never the origin

**Decision**: Replay does not use Playwright's `routeFromHAR` reader. Requests are
matched on `METHOD /path?query`.

**Why**: `routeFromHAR` matches the whole URL including the origin. Recordings are
taken wherever is convenient; CI serves on `localhost:4200`.

**Measured** (2026-09-17): recording and replaying against **the same server**
through two spellings of the same host — `127.0.0.1:4253` and `localhost:4253` —
was enough to fail every test in the spec.

---

## D4. Probe requests are recorded separately

**Decision**: Backend calls made through Playwright's `request` fixture are
recorded to `<test>.api.json` and replayed from there.

**Why**: `context.route()` does not intercept the `request` fixture — it is a
separate API context. Several specs use it to decide whether to skip:

    const up = await serves(request, '/ContentService/data/query/…');
    test.skip(!up, 'the content service is not reachable from here');

Under replay those reached the closed port, failed, and the tests skipped
themselves while the suite reported green.

**Measured** (2026-09-17): skips went from **6** to **20** — fourteen tests
silently not running — and back to 6 once probes were recorded.

---

## D5. The shared fallback serves GET and HEAD only

**Decision**: If a test's own recording lacks an entry, a pool built from every
recording is consulted — but only for idempotent reads.

**Why**: A request still in flight when its test ends is recorded with status
`-1`, no response ever received. That is common for reference data a page fetches
without waiting on, and on replay the abort left the page unable to initialise:
the DOI page failed for want of `/data/species/main`.

**Rejected**: pooling every method. **Eleven** tests POST to
`/ContentService/interactors/static/molecules/details` with a different list of
accessions each, and the key carries no body — so borrowing another test's reply
would hand one pathway's interactors to another. Plausible, wrong, and green.

---

## D6. `e2e/release/**` is never recorded

**Decision**: The release checklist keeps hitting a real host, via `E2E_BASE_URL`.

**Why**: Its job is to answer "is _this release_ right, on a real deployment",
once per cycle before the new database moves to production. Fixtures would make it
prove nothing. The code suite is a spot check on every push; the release suite is
allowed to be comprehensive because it runs rarely.

---

## D7. Recordings are trimmed to what replay reads

**Decision**: `scripts/trim-har.mjs` keeps `request.method`, `request.url`,
`response.status`, `response.headers` and `response.content`. Nothing else.

**Why**: Size, and disclosure. This repository is public, and Playwright records
request headers, cookies and timings that replay never reads.

**Measured** (2026-09-17): indexes **3.5 MB → 1.0 MB**, and across 2,032 entries
the committed recordings carry **0** request headers, **0** request bodies, **0**
cookies and **0** credential patterns.
