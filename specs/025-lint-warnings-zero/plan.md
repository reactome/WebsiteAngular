# Implementation Plan: No lint warnings

**Branch**: `025-lint-warnings-zero` | **Date**: 2026-11-13 | **Spec**: [spec.md](spec.md)

## Summary

Clear the 879 ESLint warnings held by `lint-baseline.json`, rule by rule and
area by area, in small pull requests that change no behaviour. Each rule is
promoted from `warn` to `error` in `eslint.config.js` in the pull request that
clears its last warning, and each pull request lowers the baseline with
`node scripts/check-lint.mjs --update`.

## Technical Context

- **Language**: TypeScript (Angular 21, strict, `exactOptionalPropertyTypes`).
- **Linting**: ESLint flat config (`eslint.config.js`). `scripts/check-lint.mjs`
  ratchets the warnings per rule against `lint-baseline.json` and keeps errors
  at zero. `tools/**` has its own baseline (`tools/loose-baseline.json`, at
  zero) and is outside this work.
- **Types to reach for, in order**:
  1. the API contract (`projects/contract`, spec 016), imported with `import
type`, for any answer of the content, analysis or render services;
  2. a library's own published types;
  3. a narrow local type for what the code actually reads (an interface or a
     type guard), where a library has none;
  4. a single silenced line, with the reason beside it, only where a library
     makes a correct type impossible (spec FR-004).
- **Testing**: the existing unit tests (`npm test`) and end-to-end tests (the
  recorded suite, `npx playwright test`, with `E2E_PORT` set in a worktree)
  must pass unchanged. A bug found on the way gets its own commit and a test
  proved by mutation (constitution III).
- **Gates**: `scripts/preflight.sh` on every push (types, lint ratchet, dead
  code, formatting, unit tests, builds, an end-to-end smoke run).

## Constitution Check

- **III. Prove a test fails before believing it passes**: a typing change that
  alters behaviour is a bug fix and gets a test shown failing without it. A
  pure typing change is shown safe by the type check plus the unchanged tests.
- **V. Comments carry the failure, not the mechanism**: each silenced line says
  which library limitation makes it necessary.
- **Quality gates**: the lint and dead-code ratchets may only go down; this
  work only lowers them.

No violations.

## How the work is split

Order follows the spec's assumptions: small rules first, then "anything" values
by area (smallest first), then non-null assertions.

| Batch | What                                                                  | Warnings |
| ----- | --------------------------------------------------------------------- | -------- |
| 1     | The eleven small rules, then promote each to error                    | 54       |
| 2     | reactome-table: "anything" values                                     | 19       |
| 3     | e2e: "anything" values and non-null assertions                        | 21       |
| 4     | reactome-gsa-form: "anything" values                                  | 100      |
| 5–7   | website-angular: "anything" values, by feature folder                 | 228      |
| 8–13  | pathway-browser: "anything" values, by feature folder                 | 311      |
| 14    | Promote no-explicit-any and the five no-unsafe-\* rules to error      | —        |
| 15–17 | no-non-null-assertion, Pathway Browser and the rest; promote to error | 151      |

The counts per batch are as measured on 13 Nov; they move as other work lands,
and the ratchet keeps any new warning out meanwhile.

## Working practice

- One batch per pull request, from a worktree off `origin/main`; main merged in
  before each push.
- Each pull request lists the rules and counts it lowers, any silenced line
  with its reason, and any bug found, separately.
- An independent read-only review per pull request (the repository's practice).
- No two sessions in the same files: work in this repository stops before the
  other session's working hours, or continues in a separate clone.
