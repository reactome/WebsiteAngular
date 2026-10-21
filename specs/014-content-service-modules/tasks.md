# Tasks: The content service in modules, then on Express 5

**Input**:

- [plan.md](plan.md) (order of work 1–8)
- [spec.md](spec.md)
- [research.md](research.md) (R1–R8, measured)
- [data-model.md](data-model.md)
- [contracts/](contracts/)
- [quickstart.md](quickstart.md)

**Tests**: required. Every new check is shown failing on a deliberate mistake before it is trusted (constitution III).

**Each move task** is one pull request. It must:

- pass the move check with 0 changed and 0 missing;
- not raise the baseline totals, with both per-module baselines `--update`d in the same pull request;
- be deployed to beta, rebuilding content-node only, with answers captured before and after and compared;
- have an adversarial review;
- pass CI and merge, then the merge commit is checked on main;
- tick its task here with the PR number, in the same pull request.

It must not mix in logic edits.

**Verification load** against the shared graph database is small, sequential and spaced. Nothing internal goes into this public repository.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: The instruments (before anything moves)

**Purpose**: the checks that make every later move provable. Each is shown failing first.

- [x] T001 [P] Write `scripts/check-move.mjs` (research R6, contracts/checks.md). It parses the base branch's `tools/content-node/service.ts` (`git show <base>:…`) and today's `tools/content-node/*.ts` with TypeScript's parser.
  - It matches every top-level declaration by name, and every endpoint by `path` plus method.
  - It compares their text with `export` and whitespace normalised, and reports `changed:` and `missing:` lines.
  - Show it failing on one character changed in a moved function. — #569
- [x] T002 [P] Write `scripts/check-baseline-totals.mjs` (R5). It compares the totals of `tools/loose-baseline.json`, `tools/implicit-any-baseline.json` and `lint-baseline.json` with the base branch's, and fails if any rose.
  - Run it in `scripts/preflight.sh` and `.github/workflows/tests.yml`, where the base is the pull request's base.
  - Show it failing on one module's count raised by hand. — #569
- [x] T003 [P] Write the route-order test in `tools/content-node/registry.spec.ts` (R3).
  - Record today's 88 paths with their methods, in order. Assert that the endpoint list equals the recording.
  - Assert that the 15 order-dependent pairs, named in the test, are in their measured order: the 5 person lists before `/{attribute}`; `enhanced`, `stId`, `ids/map` and `normalPathway` before `/query/{id}/{attribute}`, and `enhanced` before `/{id}/stId` and `/{id}/normalPathway`; `schema/model` before `/{id}`; `diagram/summary` before `/{diagram}`; icon `facet` and `query` before `/{identifier}`.
  - It reads the list from `service.ts` until T006 moves it. Show it failing on two swapped endpoints. — #569
- [x] T004 [P] Write the boundary test in `tools/content-node/boundaries.spec.ts` (contracts/boundaries.md). It reads each module's import specifiers and fails on any the table does not allow, naming both modules.
  - It passes trivially today, because only `service.ts` imports the leaves.
  - Show it failing on a family-to-family import, using a fixture module written in the test. — #569

**Checkpoint**: four checks live in CI, and nothing has moved.

---

## Phase 2: Foundational

- [x] T005 Break the release cycle (R2). The version endpoint's cached handler, `databaseVersion`, is declared on its own ahead of the list. Then:
  - the version endpoint uses it as its handler;
  - search's `reportInformation`, the citation lookup and `/health` call it, instead of `endpoints.find(… '/data/database/version')`.

  This is the one logic edit of Part 1. It lives in `service.ts` until T013 moves it into `tools/content-node/release.ts`, because it is built on `cached` (T011) and the graph. Verify on beta: `/data/database/version`, `/health`'s release and a citation. The no-result report path is not exercised there, because it posts a real report; it makes the same call as the citation lookup. Show with a spec (`registry.spec.ts`) that no helper looks an endpoint up by its path any more. — #570

---

## Phase 3: User Story 2 — An endpoint's declaration is checked (Priority: P1)

**Goal**: one typed `Endpoint` shape; the tools read it with no cast.

**Independent Test**: a misspelled or mistyped endpoint field fails `check:types`, and `git grep` finds no cast on the endpoint list in the tools or specs.

- [x] T006 [US2] Add the `Endpoint`, `Handler`, `Answer` and `Request` types (first as `tools/content-node/registry.ts`; renamed `endpoint.ts`, a types-only leaf, when the review of 20 Oct found families and `answers` need them and may not import the registry) (data-model.md, the 11 fields plus `warms` on the handler). `service.ts` types its list `Endpoint[]` in place, and `cached` returns a `Handler`. Show `sampel: '…'` on one endpoint failing the type check.

  Done with T005 in one PR: naming the version handler changed what TypeScript inferred for the untyped list, so the list had to be typed at the same time. The registry does not re-export the list yet, because nothing would read it there. `endpointFor` and `getEndpointFor` stay in `service.ts`, beside the server code that calls them; they move to the registry in T026, when it assembles the families and `service.ts` goes. `deploy/nginx/routes.spec.ts` and the route-order test move to the registry then too. — #570

- [x] T007 [US2] Remove the casts on the endpoint list: `tools/content-node/diff.ts` (`DiffEndpoint`, `as DiffEndpoint[]`), `tools/content-node/invalid-inputs.ts`/`.spec.ts` (`Endpoint`, the `as … []`), `tools/content-node/parameters.spec.ts`, and any other spec `git grep` finds. All of them use `Endpoint` from `endpoint.ts` and read the list from `service.ts` until T026 moves it to the registry. `deploy/nginx/routes.spec.ts` lost its cast too, though no gate type-checks `deploy/` yet (it has strict-mode errors of its own). — #577

**Checkpoint**: the endpoint list is typed and read through the registry. Families can now move out from under it.

---

## Phase 4: User Story 1 — Work on one family without touching the rest (Priority: P1) 🎯 MVP

**Goal**: `service.ts` divided as research R1 sets out, one move per pull request, every answer byte-identical.

**Independent Test**: after each move, the move check reports 0 changed, the beta captures are identical, and the boundary test passes.

### Shared modules, bottom layer first (each its own PR; `service.ts` imports from them)

- [x] T008 [US1] Move `tools/content-node/java-text.ts` (R1 layer 1): the case table and `caseInsensitive`, `javaTrim`/`javaTrimAll`, `JAVA_WHITESPACE`, `javaNumeric`, `asciiDigits`, `javaParseInteger`/`javaParseInt`/`javaDecode`/`javaDigit`, `JavaNumberFormat`, `javaSplit`, `hashSetOf`, `longHash`, `databaseObjectHash`/`databaseObjectSet`, `present`, `javaUtf8`. With it, `javaCase` and `CaseSnapshot`, which `caseInsensitive` reads. — #578
- [x] T009 [US1] Move `tools/content-node/body.ts` (layer 2): `plainText` and its charset table, `decoderFor`, `utf16`, `utf32`, `knownCharset`, `plainTextProblem`, `plainIds`. With them, `UTF_8`, `Decoder`, `JAVA_DECODERS` and `JAVA_CHARSET_NAMES`, which they read. — #580
- [x] T010 [US1] Move `tools/content-node/spring.ts` (layer 3): `Bound`, `booleanEditor`, the `spring*` binders, `servletParameter`/`servletDecode`, `queryValues`, `pathId`/`javaPathDecode`/`rawSegment`, `requiredString`, `writerFor`. `springScope` takes its `SCOPES`; `springFields` waits for T013 with `SOLR_FIELDS` and `pair`. — #581
- [x] T011 [US1] Move `tools/content-node/answers.ts` (layer 4): `javaJson`, `javaError`, `notFound`, `unexpected`/`unexpectedFailure`, `springNotFound`, `compact` and its types, `only`, `nonEmptyJson`/`RawJson`, `Failure`, `neo4jFailureMessage`, `timedOut`, `cached`. With them, compact's types (`JsonWritten`, `BeforeNonEmpty`, `Written`, `OptionalKeys`). — #582
- [x] T012 [US1] Move `tools/content-node/objects.ts` (layer 5): `resolveId`, `graphCoreId`, `inDepthId`, `longPastRange`, `speciesFilter`/`speciesTaxId`, `lazyCollectionQuery`/`lazyRelationship`, `attributeOf`/`attributeAnswer`, `pathwayJson`, `Props`. — #583
- [x] T013 [US1] Move the layer-6 modules (#584):
  - `tools/content-node/release.ts`: `databaseVersion` (T005);
  - `tools/content-node/reference-entities.ts`: `referenceEntityJson`, `REFERENCE_CLASSES`, `MOLECULE_TYPES`;
  - `tools/content-node/search-params.ts`: `searchParams`, `SCOPE_FILTER`, `PARSER_TYPES`, `plainFilter`, `SolrParams`, `pair`, `diagramResult` and its queries; and `springFields` with search-core's `SOLR_FIELDS`, which T010 left here, being Solr's.

### Families, least coupled first (each its own PR: its endpoints in today's order, and the helpers only it uses)

- [ ] T014 [P] [US1] `tools/content-node/citation-endpoints.ts`: `/citation/*`.
- [x] T015 [P] [US1] `tools/content-node/content-endpoints.ts`: `/data/content/*` (toc, doi, contributors, `peopleByPathway`, `simplePeople`). — #586
- [ ] T016 [P] [US1] `tools/content-node/person-endpoints.ts`: `/data/person/*`, the role lists' generator kept as a generator.
- [ ] T017 [P] [US1] `tools/content-node/schema-endpoints.ts`: `/data/schema/*`, with `schemaPage` and its queries.
- [ ] T018 [P] [US1] `tools/content-node/interactors-endpoints.ts`: `/interactors/*`, holding `psicquicCache` and the PSICQUIC refresh.
- [ ] T019 [P] [US1] `tools/content-node/exporters-endpoints.ts`: `/exporter/*`, with the render-service requests.
- [ ] T020 [P] [US1] `tools/content-node/entities-endpoints.ts`: `/data/participants/*`, `/data/entity/*`, `/data/complex*`.
- [ ] T021 [P] [US1] `tools/content-node/mapping-species-endpoints.ts`: `/data/mapping/*`, `/references/*`, `/data/ortholog*`, `/data/species/*`.
- [ ] T022 [P] [US1] `tools/content-node/data-query-endpoints.ts`: `/data/query/*`, `/data/database/*`, `/data/diseases*`, `/data/discover`, `/data/instance/*/referrers`.
- [ ] T023 [P] [US1] `tools/content-node/pathways-events-endpoints.ts`: `/data/pathways/*`, `/data/pathway/*`, `/data/event/*`, `/data/detail/*`, the in-depth generator.
- [ ] T024 [US1] `tools/content-node/search-endpoints.ts`: query, paginated, facets, suggest and spellcheck, icons, pathways-of, with the search entry and report helpers.
- [ ] T025 [US1] `tools/content-node/search-diagram-endpoints.ts`: diagram summary, search, flag and occurrences; species overview and its flag.
  - Also show SC-003 here: two pull requests changing two different families at once, neither conflicting.

### The server

- [ ] T026 [US1] Move what is left into `tools/content-node/server.ts`: start-up, the path rules, the download guard, failure answering, `/health`, warm-up. Remove `service.ts`. Then:
  - the registry assembles the families' lists in today's order, and `endpointFor` and `getEndpointFor` move to it (T006); point `deploy/nginx/routes.spec.ts` and the route-order test at it;
  - change `deploy/content-node/Dockerfile`'s CMD, `package.json`'s `content:node`, `scripts/preflight.sh` and `tools/started.spec.mjs`;
  - update every spec and document that names `service.ts` (historical specs aside);
  - run the end-to-end suite in full;
  - show SC-001 (no module over 1,500 lines) with a count in the PR.

**Checkpoint**: Part 1 is done. Spec 013's Phase 5 resumes on the content service, one family module per pull request.

---

## Phase 5: User Story 3 — The content service on Express 5 (Priority: P2)

**Goal**: Express 5, async rejections handled, every URL answered as before and as Java answers it.

**Independent Test**: the parity harness and the invalid-input corpus against Java give the same result before and after, and a rejecting handler is answered by the error handling.

- [ ] T027 [US3] Before upgrading, record the baselines on beta, small and spaced:
  - the parity harness against Java over every endpoint's samples (`node tools/content-node/diff.ts`);
  - the invalid-input corpus against both;
  - the spec's URL forms (trailing slash, matrix parameter, encoded and doubled slashes, malformed escape, repeated parameter), saved as captures.
- [ ] T028 [US3] Upgrade `express` to 5 in `package.json` and `deploy/content-node/Dockerfile`, keeping the lockfile diff to Express and its own dependencies. Then:
  - remove the `void (async () => …)()` wrappers in `tools/content-node/server.ts`;
  - re-measure the `URIError` path (a malformed escape in a path) against Java, keeping the handler only if Express 5 still raises it;
  - add a spec in which a handler that rejects is answered with the service's 500, with no unhandled rejection. Show it failing on Express 4 first.
- [ ] T029 [US3] On beta after the upgrade, run T027's three sets again and compare. They must be identical. Record the result in the PR.

---

## Phase 6: User Story 4 — The render service on Express 5 (Priority: P3)

**Goal**: the render service on Express 5, its answers unchanged.

**Independent Test**: its specs pass, and a few figures and refusals on beta answer as before.

- [ ] T030 [US4] Upgrade `tools/render` to Express 5 (`deploy/render/Dockerfile` if it pins Express). Then:
  - set the query parser to `extended` explicitly (R7), and add a spec with `?x[y]=1` refused naming `x`, as today;
  - remove its route's `void` wrapper.
- [ ] T031 [US4] On beta, before and after, send:
  - one small figure per format that is already cached;
  - one refusal each for an unknown parameter, a repeated parameter and an out-of-range value.

  Each answer must be identical.

---

## Phase 7: Polish

- [ ] T032 [P] Update `CLAUDE.md`'s content-service section and `tools/render/README.md` for the new modules, the registry and Express 5. Name the boundary rule (families import only shared modules).
- [ ] T033 [P] Record in spec 013's `tasks.md` (T021/T022) that the content service's remaining typing proceeds per family module.

---

## Dependencies

- Phase 1 comes before everything else.
- T005 comes before any family move. Without it, search and citation would import the registry.
- Phase 3 (T006–T007) comes before Phase 4, because families declare `Endpoint[]`.
- Within Phase 4:
  - The shared modules go in layer order, T008 → T013.
  - The families come after T013.
  - The families are independent of each other ([P]). But they all edit `service.ts`'s import list and the registry, so they merge one at a time, each rebased on the last.
  - T024 and T025 come last; they are the most coupled.
  - T026 comes after every family.
- Phase 5 comes after T026, and Phase 6 after or alongside Phase 5. The render service shares no code with the content service.

## Parallel opportunities

- T001–T004 are separate files and can be written in parallel.
- T014–T023 can be prepared in parallel in separate worktrees, then merged one at a time. They conflict only on the import list and the registry, which take one line each.
- T032 and T033 are independent of each other.

## Implementation strategy

- **MVP**: Phases 1–3, then the shared modules and the first two families (T008–T015). That shows the cut works, a move is provable, and answers stay identical, before the larger families move.
- **Then**: one family per pull request until T026.
- **Express 5**: only once Part 1 is done.
