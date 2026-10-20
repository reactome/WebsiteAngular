# Tasks: Types in the server-side services

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md) (R1–R7), [data-model.md](data-model.md), [quickstart.md](quickstart.md).

**Tests**: required. Every check is shown failing on a deliberate mistake before it is trusted (constitution III).

**Each pull request**: adversarial review, CI, merge; deploy the services it changes to beta; show every answer unchanged (parity with Java on a small, spaced sample, and the e2e suite); tick its tasks here with the PR number in the same pull request. Lint and dead-code counts only go down.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: The instrument, renaming nothing (US1) 🎯

**Goal**: everything a rename needs, and the checks that will hold it, in place first.

- [x] T001 [US1] Make the entry guards extension-agnostic: `tools/content-node/service.mjs` and `tools/render/service.mjs` start when `process.argv[1]` is this file (`fileURLToPath(import.meta.url)`), not when it ends in `service.mjs` (research R3). Test: started under another file name, each service listens. — #544
- [x] T002 [US1] Make the build fingerprints take `.ts` and `.mjs` alike (content service `/health`, render service `/health`), and extend the content service's fingerprint test to fail when a module file is left out. — #544
- [x] T003 [US1] Add `tools/package.json` (`{"type": "module"}`) and `tools/tsconfig.json` (R4), the type packages as direct dev dependencies (`@types/node` 24, `@types/express`; a local declaration for the `jsdom` parts used), and have `scripts/check-types.mjs` check it beside `tsconfig.app.json`. While no file is `.ts`, it checks the `.mjs` files with `checkJs` off: zero errors, so the gate is live from the first pull request. — #544
  - The local `jsdom` declaration moves to T010: its only user is a render spec, which converts there. `@types/node` is 24.19.2, the runtime's major (review of #544; the lockfile bump is that and its own `undici-types`).
- [x] T004 [US1] Add a type-check step to `.github/workflows/tests.yml` beside the lint step. — #544
- [x] T005 [US1] Add the per-module loose baseline (`tools/loose-baseline.json`, R5) to `scripts/check-lint.mjs`, and exclude `tools/**` from the global baseline's `no-unsafe-*`/`no-explicit-any` counts; lint `tools/**/*.ts` with `consistent-type-imports` and a ban on enums, namespaces and parameter properties. Show the baseline failing on an added `any`. — #544
- [x] T006 [US1] Add `tools/load.spec.mjs`: imports every service and CLI entry point in a child Node process (not vitest), failing on any load error. Show it failing on a type import written without `type`. — #544
  - Review of #544: the eight scripts that run when loaded are checked as Node would treat them, without running them: types stripped by Node's own `stripTypeScriptTypes`, the rest parsed, and each imported name looked for among its module's exports. `node --check` alone passed an enum and a type imported as a value. The start test now fails on any request leaving the machine (the content service fetched the PSICQUIC registry from EBI as it started).
- [x] T007 [US1] Write the content service image's own `package.json` with `"type": "module"` (`deploy/content-node/Dockerfile`), ready for its `.ts` files. — #544

**Checkpoint**: the gate runs in CI; nothing is renamed; every service deployed unchanged.

---

## Phase 2: Mechanical conversion, module by module (US1)

Each task: rename to `.ts`, update imports, file names that name it (R3 list), fix the type errors with `noImplicitAny` off without changing behaviour, seed its loose count, deploy, show answers unchanged.

- [x] T008 [US1] The analysis gateway (`tools/analysis-gateway/gateway.ts`; its Dockerfile `COPY`/`CMD`). — #549
- [x] T009 [P] [US1] `tools/api-types/*` and `tools/analysis-types/*` (compile, answers, scan, calls, content, record). — #551
- [x] T010 [US1] The render service: params, gif, then pptx, render-core, service, render (CLI); the image's `COPY tools/render/*.mjs` and `CMD`. — #552
- [x] T011 [US1] Content service leaves: graph, java-hashmap, schema, citation, psicquic, jsoup-text, warm. — #553
- [x] T012 [US1] Content service dependants: solr, report, parameters, cache-label, classify, domain, invalid-inputs. — #554
- [x] T013 [P] [US1] The snapshot scripts (domain, schema, openapi, graph-names, case, rfd). (#555)
- [x] T014 [US1] `service.ts` and `diff.ts`: the image's `CMD`, `package.json` scripts, `scripts/preflight.sh`, `deploy/nginx/routes.spec.ts`, the specs that import it, and the documented commands (36). (#556)

**Checkpoint**: every module is `.ts` and checked; no `.mjs` left in the services.

---

## Phase 3: The data the services read (US2)

- [x] T015 [US2] `graph.ts`: `read<Row>()` returning `Promise<Row[]>`, and the driver's value kinds; each of the 65 call sites names its row type. (#557)
- [x] T016 [P] [US2] `solr.ts`: the handlers' answer types and the document fields read (`searchEntry` and the five other readers). (#558)
- [x] T017 [P] [US2] Snapshot types (domain, OpenAPI, graph names, jsoup tables, schema, case, RFD), each checked against its file in a spec by a JSON import assigned to it; show one failing on a renamed field. (#559)
- [x] T018 [P] [US2] Each service's settings named and typed in one place: the content service's in `settings.ts`, each read when it was before (the specs change the environment between cases, so not once); render's typed constants and the gateway's `GatewaySettings` already were. (#560)

---

## Phase 4: The answers the services write (US3)

- [ ] T019 [US3] Where the site reads the same answer (spec 012's call table), the content service writes it through the site's model type, one definition; show a field renamed in the shared type failing in both. Done for the contents lists (toc, doi, contributors), the schema attribute and referral tables and the schema model (#561). Schema min and instance referrers too (#PR), with the site's `SimpleDatabaseObject` corrected to what is written (no `stId` on an InstanceEdit or Species). Left, by spec 012's call table: pathway citation, person event lists, diagram and species-overview flags, icon entry and icon facets, facets, locationsInPWB, interactors (details, withEntities), PSICQUIC resources, spellcheck, suggest.
- [ ] T020 [US3] Answers only the services write: types beside the service.

---

## Phase 5: Strict, module by module (US4)

- [ ] T021 [US4] `noImplicitAny` on per module (3,373 errors in all, measured), smallest first, each module's loose count lowered in the same pull request.
- [ ] T022 [US4] Each module's loose count to zero, starting with those that read graph rows or write answers (SC-004).

---

## Phase 6: Polish

- [ ] T023 The tools beside the services that they do not import (`tools/java-parity`, `tools/library-update`, `tools/svg-export-harness`, the check specs): converted the same way, or recorded as left and why.
- [ ] T024 `CLAUDE.md`: the rule for new service code (typed, and a load test entry for a new entry point) if one emerges.

---

## Dependencies

- Phase 1 before any rename. T001–T002 before T010 and T014 (the guards and fingerprints).
- Within Phase 2, leaves before dependants; `service.ts` last (a `.ts` module may import `.mjs`, not the reverse for type-only imports).
- Phase 3 after the module it types is converted. Phase 4 after spec 012's types for that answer are fixed. Phase 5 last.

## Implementation strategy

1. **MVP**: Phase 1. The gate is in CI before the first file changes.
2. Then the gateway, the type tools and the render service (small, separate services), then the content service from its leaves to `service.ts`.
3. Then data and answer types, then strictness, each module to zero.
