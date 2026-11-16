# Research: types in the server-side services

Measured 19 Oct 2026 on Node 24.15 (local) and the `node:24` image (24.22), on copies of the services; no service was started against a database or index.

## R1. Typed source run directly, not annotations

**Decision**: convert the services to TypeScript (`.ts`) that Node 24 runs directly by stripping types. No build step: the images keep `node <file>`.

**Measured**: both Node versions run a `.ts` copy of the gateway and of the content service (which loads and lists its 88 endpoints). A thrown error's stack points at the exact line and column (types are replaced by spaces, so no source maps are needed). No module uses syntax that stripping cannot remove (enums, namespaces, parameter properties): none exist in the JavaScript today, and `erasableSyntaxOnly` raised nothing in `tools/`.

**Alternatives**: JSDoc annotations checked with `checkJs` (weaker inference, verbose, and the shared site types would be imported through comments); a build to JavaScript (a step to deploy, and two copies of every file).

## R2. Module system

**Decision**: `.ts`, with a `tools/package.json` of `{"type": "module"}`, and the same in the content service's image directory (its `package.json` is written by `npm install` without one).

**Measured**: the root `package.json` declares no type, so Node warns `MODULE_TYPELESS_PACKAGE_JSON` on every start and parses each file twice, and the type checker treats every `.ts` file as CommonJS (2,077 errors). `.mts` avoids the package file but the lint configuration, vitest's include and the pre-commit formatter all match `*.ts` only, and `.mts` files were measured unlinted. The render image writes its own module `package.json`; the gateway image has none and measured clean.

## R3. What a rename would break silently

These were found by running the converted copies, and are fixed before any file is renamed (Phase 1):

- **Entry guards**: the content and render services start only when `process.argv[1].endsWith('service.mjs')` (`tools/content-node/service.mjs`, `tools/render/service.mjs`). Renamed, the content service exits 0 without listening, and its container restarts in a loop. The guards that compare `process.argv[1]` with `fileURLToPath(import.meta.url)` (gateway, warm, classify and others) keep working.
- **Build fingerprints**: `/health` hashes the content service's files matching `/\.(mjs|json)$/`, and the render service's ending `.mjs`. Renamed, the content fingerprint would cover the JSON only, unseen by any test; the render one would be empty (its test does catch that).
- **Vitest is more lenient than Node**: a type-only import written without `type`, an enum, a parameter property and a missing extension all pass under vitest and fail when Node loads the file. So a load test runs every entry point under Node itself.
- **Names of files**: the three Dockerfiles (`CMD`, and the render image's `COPY tools/render/*.mjs`), `package.json`'s `content:node`/`content:diff`, `scripts/preflight.sh` (starts both services), `knip.json` entries, the lint block for `tools/**/*.mjs`, `deploy/nginx/routes.spec.ts` (imports the service), `vi.mock('./graph.mjs')` in 20 specs, literal names in two specs, and 36 documented `node tools/….mjs` commands.

## R4. Type-checking settings

**Decision**: `tools/tsconfig.json` with the site's strictness (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnused*`), `module`/`moduleResolution` `nodenext`, `allowImportingTsExtensions` with `noEmit`, `isolatedModules`, `types: ["node"]`, lib ES2024 plus DOM (the render service's page code). `scripts/check-types.mjs` checks it beside `tsconfig.app.json`, and CI gains a type-check step (today only the pre-push hook runs it; CI type-checks only through `ng build`).

**`verbatimModuleSyntax` and `erasableSyntaxOnly` stay off in the checker**, because compiler options apply to the whole program and the services import the site's model types (R6), which use a namespace (`Analysis`) and enums (`constants.ts`) and import types without `type` (87 places): with them on, 90 errors land in site files this feature does not change. What they protect is enforced instead by lint for `tools/**` (`consistent-type-imports`, and a ban on enums, namespaces and parameter properties) and by the Node load test (R3), which fails on exactly what they would catch.

**`noImplicitAny`**: off in the first, mechanical step (1,180 errors to fix across 35 modules and 53 specs: 651 in modules, 527 in specs), on module by module as each is typed (3,373 with it on).

**Type packages**: `@types/node` (matching 24) and `@types/express` become direct dev dependencies (today present only transitively); `jsdom` needs a local declaration for the parts one spec uses.

## R5. Lint

**Measured**: the `.mjs` files have no lint findings today, because the `tools/**/*.mjs` block applies only the recommended rules. Converted, the type-aware `**/*.ts` rules apply: 7,564 `no-unsafe-*` warnings (5,399 in modules, 2,165 in specs) and 48 errors, against today's whole-repository baseline of 1,329. The ratchet is per rule and global, so the first conversion would fail it.

**Decision**: the `no-unsafe-*` and `no-explicit-any` findings in `tools/**` are counted per module in their own baseline (`tools/loose-baseline.json`), which may only go down: this is the spec's "loose count" (FR-007), and it reaches zero module by module. The site's global baseline excludes `tools/**` for those rules, so neither hides the other. The 48 errors are fixed in the step that converts their module.

## R6. What the services read and write

- **Graph**: every read goes through `graph.mjs` `read(cypher, params, {graph})` (63 call sites in the content service, 2 in a snapshot script), which returns `record.toObject()` rows; integers come back as numbers, or strings beyond the safe range. First type: `read<Row>()` returning `Promise<Row[]>`, each call site naming its row.
- **Search index**: 18 call sites through `solr(handler, params, …)`, returning untyped JSON; about 36 document fields are read (`searchEntry`). First type: the answer and document shapes.
- **Snapshots**: seven files read lazily with `JSON.parse` (domain, OpenAPI, graph names, jsoup tables, schema, case, RFD), so `any` today. Each gets a type, checked against the file itself in a spec by a JSON import assigned to it.
- **Answers**: where the site reads the same answer (spec 012's call table), the service writes it through the site's type; spec 012's recorded answers check that type.
- **Environment**: about 40 variables across the three services, read as strings; typed through one reader per service.

## R7. Order

**Decision**, smallest and least depended-on first, each its own pull request, deployed and verified:

0. **Instrument** (no file renamed): `tools/tsconfig.json`, `tools/package.json`, extension-agnostic entry guards and fingerprints, the type check in CI, the per-module loose baseline, the type packages, the Node load test.
1. The analysis gateway (1 module, 328 lines).
2. `tools/api-types` and `tools/analysis-types` (6 modules, 724 lines).
3. The render service (6 modules, 2,128 lines; its image's `COPY` changes).
4. Content service leaves (graph, java-hashmap, schema, citation, psicquic, jsoup-text, warm), then their dependants (solr, report, parameters, cache-label, classify, domain, invalid-inputs). A `.ts` module can import a `.mjs` one, so leaves convert while the service is still `.mjs`.
5. The snapshot scripts (6 modules).
6. `service.mjs` (8,483 lines), then `diff.mjs`; this one changes the image's `CMD`, `package.json`, preflight and the specs that import it.

Then, module by module: `noImplicitAny` on, the data types of R6, and each module's loose count to zero.

**Out of this feature's first pass, named so they are not forgotten**: `tools/java-parity`, `tools/library-update`, `tools/svg-export-harness` and the check specs beside them, which the services do not import.
