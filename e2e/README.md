# End-to-end tests

`npm run e2e` runs the suite in `e2e/*.spec.ts` against a server Playwright
starts itself. `npm run e2e:release` runs `e2e/release/**` instead, which is a
different job — see the bottom of this file.

## Backend data comes from recordings, not from a server

Everything under `/ContentService/`, `/AnalysisService/` and
`/ExperimentDigester/` is served from the HAR files in `e2e/har/`, replayed
inside the browser by `e2e/support/backend.ts`. No test in this suite talks to a
live backend.

That is deliberate. CI used to set `REACTOME_BACKEND` to `https://reactome.org`,
so every push ran 172 tests against the **public site** — roughly 1,400 requests
a run. Besides the load, it made the suite fail whenever production had a bad
minute: a Cloudflare 521 arrived as

```
TimeoutError: page.waitForSelector: Timeout 90000ms exceeded.
  - waiting for locator('#cytoscape canvas') to be visible
```

which says nothing about a backend and teaches you to press re-run (#217).

In CI `REACTOME_BACKEND` now names a closed port on purpose. A request with no
recording is **aborted**, never passed through, so a gap fails immediately
instead of quietly finding production again.

## Re-recording

```bash
npm run e2e:record
```

Record against a backend you trust, which means **the local Tomcat, never
production**. `proxy.conf.js` defaults to `http://localhost:8080`, so leaving
`REACTOME_BACKEND` unset is correct on the dev host.

One recording per spec file, at `e2e/har/<spec>.har`. Re-recording rewrites
them; commit the result, and read the diff — a fixture change is a change in
what the tests prove.

**Record the way CI runs.** CI serves the app with `ng serve` (the `development`
configuration, where backend calls are relative and go through the proxy). A
production build resolves some of them to absolute `https://beta.reactome.org`
URLs instead, and fixtures recorded that way do not match in CI. If a server is
already listening on `:4200`, Playwright reuses it rather than starting its own —
so check what is there, or point at your own:

```bash
npx ng serve --port 4253 --host 127.0.0.1
E2E_RECORD=1 E2E_BASE_URL=http://127.0.0.1:4253 npx playwright test --project=code
```

## Running less than all of it

The full suite is 154 tests and several of them open a pathway diagram and wait
for it to draw, so a whole run is minutes. Most of the time you do not want one:

```bash
npm run e2e:changed       # only specs changed against the base branch
npm run e2e:failed        # only what failed last time
npm run e2e -- e2e/interactors.spec.ts          # one file
npm run e2e -- --grep "pathway on screen"       # one test, by name
```

`e2e:changed` is the usual one while developing: it picks the spec files git says
you touched. `e2e:failed` is the usual one while fixing.

Run the whole suite when you are about to open a pull request, not while you are
still working — and note that the pre-push hook (`scripts/preflight.sh`) already
runs a deliberately small smoke rather than everything, for the same reason.

## Two suites, on purpose

**`e2e/*.spec.ts` — the code suite.** Runs on every push and pull request, and is
a **spot check**: does the thing the change touched still work for a reader. It
should not sweep the API. Every page it opens costs recorded data, and a test
that opens a diagram to assert something about a button has paid for the whole
pathway payload to do it. Prefer the lightest page that can show the behaviour.

**`e2e/release/` — the release checklist.** Run once per release cycle, after
the release process has generated the data and **before the new database moves to
production**. This one is allowed to be comprehensive, because it is answering a
different question: is _this release_ right, on a real deployment.

It is **never recorded**. Its whole job is to check a running host, so fixtures
would make it prove nothing. It takes `E2E_BASE_URL`, is a separate Playwright
project, and is not part of `npm run e2e`:

```bash
E2E_BASE_URL=https://<the host under test> npm run e2e:release
```

## What else is not recorded

- **Hosts other than the three above.** Downloads, the GSA server and the
  third-party PSICQUIC resources still go out over the network. Worth closing
  later; the backend was the large share.

## Fixtures go stale

A recording is a copy of what the backend said on the day it was taken. It will
not notice a backend that changes shape, and a test passing against a stale
fixture proves less than it appears to. Re-record when a data-dependent test is
edited, and treat a scheduled re-record that produces a large diff as a signal
rather than a chore.
