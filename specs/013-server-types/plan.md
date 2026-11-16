# Implementation Plan: Types in the server-side services

**Branch**: `spec/013-server-types` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/013-server-types/spec.md`

## Summary

The content service, the render service, the analysis gateway and the type-check tools become TypeScript that Node 24 runs directly, checked in CI under the site's strictness. First an instrument pull request that renames nothing: the type-check configuration, a CI step, a per-module count of loosely typed values that may only go down, and fixes for what a rename would break silently (entry guards, build fingerprints, and a load test under Node itself, which is stricter than the test runner). Then the modules convert in dependency order, smallest first, each pull request deployed and every answer shown unchanged. Then each module's types tighten until its loose count is zero, reading graph rows, index documents and snapshots through named types, and writing the answers the site reads through the site's own types. Research: [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 5.9 (type stripping by Node 24; no emit).

**Primary Dependencies**: none new at run time. Dev: `@types/node` (24), `@types/express`, as direct dependencies.

**Storage**: none.

**Testing**: vitest (existing 48 spec files, converted with their modules); a load test that imports every entry point under Node; the content service's parity comparison with Java and the e2e suite for every converted module.

**Target Platform**: the three services' images (`node:24`) behind nginx.

**Project Type**: web services.

**Performance Goals**: no change in answer time or start time (type stripping is per load; measured negligible).

**Constraints**: every answer byte-identical; entry points unchanged in kind (`node <file>`); lint and dead-code counts only down; site files not changed for this feature's sake (R4).

**Scale/Scope**: 35 modules (16,800 lines) and 53 spec files; 1,180 type errors to clear in the mechanical step, 3,373 with `noImplicitAny`; 7,564 loose values to count down.

## Constitution Check

| Principle                     | How this plan meets it                                                                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Verify the instrument      | The type check is shown failing on a deliberate mistake in each converted module; the load test is shown failing on a type import without `type`; the fingerprint test is extended to fail when a module is left out. |
| II. Measure in the thing      | Every converted module is deployed and its answers compared with Java and the e2e suite on beta; types of rows and documents come from the queries and recorded answers, not from guesses.                            |
| III. Prove a test fails       | Each new check and each tightened type is shown failing first.                                                                                                                                                        |
| IV. Stable identifiers        | Not affected.                                                                                                                                                                                                         |
| V. Comments carry the failure | Kept: comments move with their code unchanged.                                                                                                                                                                        |
| Quality gates                 | Lint: tools' loose values counted per module in their own baseline (R5), the global baseline unchanged; dead code unchanged or down.                                                                                  |

Gates pass.

## Project Structure

### Documentation (this feature)

```text
specs/013-server-types/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md, tasks.md
```

### Source Code (repository root)

```text
tools/
├── package.json            # {"type": "module"}
├── tsconfig.json           # the services' type check (R4)
├── loose-baseline.json     # loosely typed values per module; may only go down (R5)
├── load.spec.mjs → .ts     # every entry point imported under Node itself (R3)
├── analysis-gateway/gateway.ts
├── api-types/*.ts, analysis-types/*.ts
├── render/*.ts
└── content-node/*.ts       # graph.ts read<Row>(), solr.ts, snapshot types (R6)
scripts/check-types.mjs     # checks tsconfig.app.json and tools/tsconfig.json
scripts/check-lint.mjs      # the per-module tools baseline beside the global one
deploy/*/Dockerfile         # CMD and COPY names
.github/workflows/tests.yml # a type-check step
```

**Structure Decision**: modules stay where they are, renamed; types each module needs live beside it (`*.types.ts` only where shared by several), and answer types the site also reads are imported from the site's model.

## Complexity Tracking

| Choice                                                                                        | Why needed                                                                                   | Simpler alternative rejected because                                                                                                           |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `verbatimModuleSyntax`/`erasableSyntaxOnly` enforced by lint and a load test, not the checker | The checker's options cover the whole program, including the site types the services import. | Turning them on puts 90 errors in site files this feature does not touch; leaving them unenforced lets a file pass the tests and fail to load. |
| A separate per-module loose baseline                                                          | Converting adds 7,564 findings at once, all of them the work this feature does.              | The global per-rule baseline would have to rise, which it never may; excluding tools from the rules entirely would hide them.                  |
