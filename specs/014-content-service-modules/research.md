# Research: the content service in modules, then on Express 5

Every figure below was measured on `tools/content-node/service.ts` at main `346a8ae6` (8,982 lines,
88 endpoints, 206 top-level declarations). The scripts are TypeScript's own parser over the file (top-level
declarations, the identifiers each references, followed transitively from each endpoint) and the
loaded endpoint list.

## R1. The cut

**Decision.** Each endpoint belongs to a family by its path. A declaration reached only from one
family's endpoints moves with that family. A declaration reached from two or more families goes to
a shared module by concern. One that no endpoint reaches belongs to the server.

**Measured.** Endpoint lines per family, then the declarations reached by that family alone:

| Family          | Paths                                                                                                  | Endpoint lines | Own helpers (decls/lines) |
| --------------- | ------------------------------------------------------------------------------------------------------ | -------------: | ------------------------: |
| data-query      | `/data/query/*`, `/data/database/*`, `/data/diseases*`, `/data/discover`, `/data/instance/*/referrers` |            533 |                    10/135 |
| pathways-events | `/data/pathways/*`, `/data/pathway/*`, `/data/event/*`, `/data/detail/*`, `/data/{kind}/{id}/in-depth` |            411 |                    30/462 |
| content         | `/data/content/*`                                                                                      |            216 |                      4/50 |
| person          | `/data/person/*`                                                                                       |            255 |                      2/29 |
| entities        | `/data/participants/*`, `/data/entity/*`, `/data/complex*`                                             |            298 |                      7/69 |
| mapping-species | `/data/mapping/*`, `/references/*`, `/data/ortholog*`, `/data/species/*`                               |            305 |                    15/221 |
| schema          | `/data/schema/*`                                                                                       |            183 |                    12/109 |
| interactors     | `/interactors/*`                                                                                       |            203 |                    12/154 |
| exporters       | `/exporter/*`                                                                                          |            103 |                    16/245 |
| citation        | `/citation/*`                                                                                          |            101 |                      6/73 |
| search          | `/search/*`                                                                                            |            673 |                    54/968 |

- 75 declarations (908 lines) are reached by three or more families.
- 24 (about 330 lines) are reached by exactly two.
- 17 (335 lines) are reached by none: `app`, `endpointFor` and `getEndpointFor`, the health
  fingerprint, `PORT`/`HOST`, the deep-query share, the PSICQUIC refresh, `readBody`,
  `startedDirectly`.

**The shared modules, by concern** (layered: each imports only those above it):

1. `java-text.ts`: Java's text and number semantics. `caseInsensitive` with the case snapshot, `javaTrim`/`javaTrimAll`, `JAVA_WHITESPACE`, `javaNumeric`, `asciiDigits`, `javaParseInteger`/`javaParseInt`/`javaDecode`/`javaDigit`, `JavaNumberFormat`, `javaSplit`, `hashSetOf`, `longHash`, `databaseObjectHash`/`databaseObjectSet`, `present`, `javaUtf8`.
2. `body.ts`: request bodies as Spring reads them. `plainText` and its charset table, `decoderFor`, `utf16`, `utf32`, `knownCharset`, `plainTextProblem`, `plainIds`.
3. `spring.ts`: Spring's parameter binding and path reading. `Bound`, `booleanEditor`, `springBoolean`/`springInteger`/`springPrimitiveBoolean`/`springIntWithDefault`/`springIntegerWithDefault`/`springPathLong`, `servletParameter`/`servletDecode`, `queryValues`, `pathId`/`javaPathDecode`/`rawSegment`, `requiredString`, `writerFor`.
4. `answers.ts`: Java's answers. `javaJson`, `javaError`, `notFound`, `unexpected`/`unexpectedFailure`, `springNotFound`, `compact`/`BeforeNonEmpty`/`JsonWritten`/`Written`/`only`, `nonEmptyJson`/`RawJson`, `Failure`, `neo4jFailureMessage`, `timedOut`, `cached`.
5. `objects.ts`: ids and objects in the graph. `resolveId`, `graphCoreId`, `inDepthId`, `longPastRange`, `speciesFilter`/`speciesTaxId`, `lazyCollectionQuery`/`lazyRelationship`, `attributeOf`/`attributeAnswer`, `pathwayJson`, `Props`.
6. Pair-shared modules, named for what they hold. Measured: one family never needs another's code except through these.
   - `reference-entities.ts`: `referenceEntityJson`, `REFERENCE_CLASSES`, `MOLECULE_TYPES` (entities and mapping).
   - `search-params.ts`: `searchParams`, `SCOPE_FILTER`, `PARSER_TYPES`, `plainFilter`, `SolrParams`, `diagramResult` and its queries (search and exporters).
7. `release.ts`: see R2.
8. `server.ts`: routing, the download guard, `failureAnswer`/`writeResult`/`answer`, the health route, start-up. Plus `registry.ts`, which assembles the endpoint list.

**Module-level state**, where it lives after the cut. Each item is created at the same moment as now, at start or on first use:

| State               | Module                       |
| ------------------- | ---------------------------- |
| `javaCase`          | `java-text.ts`               |
| `safeExtensions`    | `server.ts` (download guard) |
| `psicquicCache`     | interactors                  |
| `DEEP`              | `server.ts`                  |
| `cached()`'s stores | `answers.ts`                 |
| the release cache   | `release.ts`                 |

**Search is split in two**, because its endpoints and own helpers come to 1,641 lines, over SC-001's 1,500:

- `search-endpoints.ts`: query, paginated query, facets, suggest and spellcheck, icons, pathways-of.
- `search-diagram-endpoints.ts`: diagram summary, diagram search, flag, occurrences, species overview, and the overview's flag.

**Line counts after the cut, estimated** (endpoints plus own helpers): every family module is 175 to 875 lines. `search-endpoints.ts` and `search-diagram-endpoints.ts` are about 800 each. The shared modules are 100 to 300 each, and `server.ts` about 600. None is over 1,500.

**Alternatives.**

- By layer (handlers, queries, writers): rejected, because every change to one endpoint would still touch three files.
- By Java controller class: rejected, because several controllers share helpers the same way and the families already follow the URL space the site and the route tables use.

## R2. One cycle to break first

**Measured.** Three helpers read the endpoint list itself, to answer the release:

| Line | Where               | Family it is in |
| ---- | ------------------- | --------------- |
| 7298 | `reportInformation` | search          |
| 7667 | `citationFor…`      | citation        |
| 8762 | `/health`           | server          |

Each runs `endpoints.find(... '/data/database/version').handler(...)`. Once moved, search and citation would import the registry that imports them.

**Decision.** Before any move, one pull request adds `release.ts`, which answers the release once (cached as the version endpoint already is). The version endpoint and the three callers use it. It is the only logic edit Part 1 needs, it gets its own pull request, and it is verified like the others. No family module may import the registry or another family; only shared modules.

## R3. The registry and the order of routes

**Measured.**

- Express routes are registered in array order (`server.all(...)`) and the first match wins. `endpointFor` and `getEndpointFor` also take the first match in array order.
- 15 pairs of endpoints can match one URL, so their order decides the answer. All 15 are within one family:
  - person: 5 named lists before `/{attribute}`;
  - query: `enhanced`, `stId`, `ids/map` and `normalPathway` before `/{id}/{attribute}`, and `enhanced` before `/{id}/stId` and `/{id}/normalPathway` (`/data/query/enhanced/stId` matches both);
  - schema: `model` before `/{id}`;
  - search: diagram `summary` before `/{diagram}`, and icon `facet` and `query` before `/{identifier}`.

  No pair crosses families. Four more pairs overlap across methods (`GET /data/query/{id}` and `POST /data/query/ids`, say): Express routes by method, but `endpointFor` does not, so the test names those too.

**Decision.**

- Each family exports its endpoints in today's order.
- The registry concatenates the families. Their order between each other does not matter for matching, but it is kept as today's anyway so that `/health`'s list, the parity harness and the route tables read the same.
- A new test pins it: the registry's list equals a recorded list of today's paths, in order, and every one of the 15 pairs is in its recorded order.
- `deploy/nginx/routes.spec.ts` reads the registry instead of `service.ts`.
- Specs that import a helper from `service.ts` import it from its new module. `service.ts` keeps no re-exports once its last family has gone; until then it re-exports only what has not moved yet.

## R4. The typed endpoint

**Measured over the 88.**

| Field         | Endpoints using it | Kind     |
| ------------- | -----------------: | -------- |
| `path`        |                 88 | string   |
| `handler`     |                 88 | function |
| `differs`     |                 53 | RegExp[] |
| `sample`      |                 45 | string   |
| `samplePath`  |                 10 | object   |
| `method`      |                  6 | string   |
| `sampleBody`  |                  6 | string   |
| `normalise`   |                  4 | function |
| `deep`        |                  3 | boolean  |
| `unordered`   |                  2 | function |
| `samplesOnly` |                  2 | boolean  |

Eight handlers carry `warms`. The parameter record (`parameters.ts` `RECORD`) is keyed by path and stays separate. It is shared with the cache labels and the invalid-input corpus, and folding it into the endpoint would tie three modules to one shape.

**Decision.** One `Endpoint` type in `registry.ts` with exactly these fields (see data-model.md). Each family declares its list as `Endpoint[]`. The casts in `diff.ts`, `invalid-inputs.ts`/`.spec.ts` and `parameters.spec.ts` go.

## R5. Ratchets across a move

**Measured.**

- `check-lint.mjs` and `check-types.mjs` compare per-module counts against their baseline files, and `--update` rewrites them.
- A move PR must rewrite them. The destination modules appear and the source shrinks, and the pre-push hook checks against the baseline in the working tree.

**Decision.**

- A new check, `scripts/check-baseline-totals.mjs`, run in CI and preflight, compares the totals of `tools/loose-baseline.json`, `tools/implicit-any-baseline.json` and `lint-baseline.json` with the base branch's. It fails if any total rose. The dead-code baseline is one number already.
- A move PR runs `--update` on both baselines and shows the totals unchanged or lower.
- Outside moves, the per-module rule is unchanged.
- The check is shown failing first: raise one module's count by hand.

## R6. A move is a move

**Decision.** A new script, `scripts/check-move.mjs`, takes the base branch's modules and today's and, for every top-level statement and every endpoint (by method and path) that left its module, compares it token for token: strings, templates, regular expressions and comments exactly, only the whitespace between tokens and a leading `export` set aside, so Prettier rewrapping a moved declaration is not a change. Two things fail besides a changed or missing piece, because a moved declaration's meaning can change without its text changing: a declaration added to a module that received moved code (`added:`), and an imported name that now resolves to a different declaration (`rebound:`). Every import in a module that received moved code -- named, default, namespace, side-effect, or through a re-export -- must be one the original module had and resolve to the same declaration or package export; a name the original did not have (a global such as `fetch`) fails. Comments on a code line are compared as well as comments on their own. It is not a CI gate: a pull request that deletes code would fail it; a move pull request runs it and shows its output. It fails on any difference and lists them, so a move PR shows "N declarations, M endpoints moved, 0 changed".

Imports are not compared. Neither is anything the PR lists as needing a change because of the boundary (a module-local name that had to be exported). It is shown failing first, with one character changed in a moved function.

**Alternative.** `git diff --color-moved`. It is good for a reviewer's eye but gives no verdict, and it does not follow text across files reliably.

## R7. Express 5

**Measured in the code.**

- **Content service.**
  - All 88 paths use `{name}` placeholders, rewritten to `:name` when registered. No path has a character path-to-regexp 8 reserves (`( ) [ ] ? + ! * :`).
  - It reads queries from the raw URL (`queryValues`, the servlet's rules), never `req.query`, so Express 5's change of default parser ("simple" for "extended") does not reach it.
  - It uses `response.status(...).location(...).end()`, `sendStatus`, `type`, `send`, `setHeader` and four-argument error handlers. All are unchanged in 5.
  - It catches `URIError` from Express's path decoding. Express 5's router decodes parameters differently, so this must be re-measured: a malformed escape in a path, against Java.
- **Render service.** It reads `req.query` throughout (`repeated`, `canonicalUrl`, the unknown-parameter refusal). Under "simple", `?x[y]=1` is the key `x[y]` where "extended" made it `x`, so a refusal could name a different key. **Decision**: set the query parser to "extended" explicitly, so its answers stay the same, and show it with that URL.
- **Both.** Express 5 forwards a rejected handler promise to the error handler. The `void (async () => …)()` wrappers (the content service's `/health` and signal handlers; render's route wrapper) are removed. A new test shows a rejecting handler answered by the error handler with no unhandled rejection.

**Verification**, before and after, for each service:

- the parity harness over every endpoint's samples, against Java;
- the invalid-input corpus, against Java;
- the route-table test;
- the order test from R3;
- the URL forms in the spec (trailing slash, matrix parameter, encoded and doubled slashes, malformed escape, repeated parameter);
- before-and-after captures on beta.

All of it runs small, sequential and spaced against the shared graph database.

## R8. Image, health, load test

**Measured.**

- The Docker image copies `tools/content-node/` whole, and every new module lives there.
- `/health`'s fingerprint hashes every module in the directory (`fingerprintFiles(readdirSync(here))`), so new modules join it with no change.
- `tools/load.spec.mjs` imports every module in each service's directory, so new modules join it with no change.

**Decision.** No change to any of the three. Each move PR's checks show them covering the new modules: the load test's count of modules rises, and `/health` lists the build.
