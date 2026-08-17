# Contributing

## Running the checks

```bash
npm test                 # unit tests (vitest)
npm run e2e              # end-to-end tests (playwright); starts its own ng serve
npm run lint             # eslint
npm run format           # prettier, writes
npm run check:lint       # what CI enforces: zero errors, warnings not increasing
npm run check:dead       # unreachable files and exports, same idea
```

A pre-commit hook formats staged files and runs eslint over them. It blocks on
errors only, not warnings — see below for why.

## How the quality gates work

This codebase had no linter for most of its life, so switching one on produced
around 1600 findings. Requiring all of them fixed before anything could be
enforced would have meant nothing ever being enforced. Instead there are two
ratchets, and one rule about severity.

**Severity records whether the codebase is already clean of a rule.**

- `error` — no existing violations. Any error is therefore new, and CI fails.
- `warn` — violations exist. The count is recorded in `lint-baseline.json` and
  can only go down.

When you fix a warned rule's last violation, promote it to `error` in
`eslint.config.js`. That is how the list shrinks rather than sitting at its
current size forever. Four rules have made that trip already: the two promise
rules, `prefer-inject`, and `no-empty-lifecycle-method`.

**Unreachable code** is tracked the same way by `check:dead` (knip), which finds
whole files and exports nothing imports — something eslint cannot see. Note that
"not imported" does not always mean "safe to delete": the graph model classes are
referred to by `schemaClass` name strings rather than by import.

After reducing either count, lock it in:

```bash
npm run check:lint -- --update
npm run check:dead -- --update
```

### Why warnings do not block commits

Roughly 680 warnings live in files people still have to edit. Blocking every
commit that touches one would get the hook disabled within a week. The bar for
committing is the same as the bar CI enforces: no errors.

## Things worth knowing before you change them

**Signals and change detection.** The app runs zoneless. Nothing patches the
browser's async APIs, so state set from a raw `addEventListener`, a
`ResizeObserver`, an `IntersectionObserver` or a bare `setTimeout` reaches the
template only if the component says so — a signal, or `markForCheck()`. Getting
this wrong renders a stale view and throws nothing, so it will not show up as an
error anywhere.

**Effects are synchronous.** `effect(async () => ...)` looks fine and quietly
breaks: anything read after the first `await` is not tracked as a dependency, so
the effect never re-runs for it. Read signals up front, then do the async work.

**The backend is local.** `proxy.conf.js` points at `http://localhost:8080`,
where ContentService, AnalysisService and ExperimentDigester all run. Pointing it
at `dev.reactome.org` instead sends every API call out through Cloudflare and
back into the same machine's Apache; a repeated e2e run once exhausted Apache's
workers that way and took the origin down. CI sets `REACTOME_BACKEND` to a public
host because a runner has no local backend.

**Tests run against real data.** The e2e suite asserts on content from the
content service rather than on elements existing, because a page that renders its
shell with an empty list looks fine to a container-based assertion. Specs that
need endpoints only present on the dev host check for them and skip rather than
fail.

## Workspace libraries

`projects/` holds four libraries that build to `dist/` and are consumed from
there, not from `node_modules`. Build them before the app will compile:

```bash
npm run build:libs
ng build reactome-cytoscape-style
```
