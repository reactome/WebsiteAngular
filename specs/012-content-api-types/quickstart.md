# Quickstart: content API types checked against real answers

Every command runs from the repository root, with Node 24 on the path.

## Run the checks

```bash
npx vitest run tools/api-types tools/analysis-types
```

Expected: passing. The compile check prints the routes not read by the site and the answers it skipped, with their counts; `known-problems.json` lists the routes whose types are not yet fixed.

## See each check fail (constitution III)

1. **A removed field.** In a copy of one recorded answer, delete a field its type requires (e.g. `displayName` from a `/data/species/main` answer): the compile check fails, naming the route, the answer and the path.
2. **An undeclared field.** Add `"undeclared": 1` to an object in a recorded answer: it fails with "does not exist", naming the path.
3. **A wrong kind.** Change a type's field from `string` to `number` where the answers send a string: it fails, naming the path of each value.
4. **A failed import.** Point the check at a type that does not exist: every answer of that route fails with "Cannot find", not a silent pass.
5. **The ratchet.** Raise a problem count in `known-problems.json`: the check fails asking for it to be lowered. Fix one problem without lowering it: it fails the same way.
6. **The call table.** Add an `http.get` to `CONTENT_SERVICE` in any service without a table entry: `calls.spec.mjs` fails, naming it.
7. **The snapshot.** Rename a property in a graph type (`Book.isbn` → `Book.ISBN`): `snapshot.spec.mjs` fails, naming the class. Remove a class from a copy of the snapshot: the type that models it fails.

Each step is undone after it has been seen to fail.

## Record the corpus again

```bash
node tools/api-types/record.mjs [origin]    # default: the node content service on this host
```

Reads at most 40 URLs, one at a time with a pause, from our own service, and rewrites `tools/api-types/recorded/`. Never pointed at production.

## After a type change

```bash
node scripts/check-types.mjs && node scripts/check-lint.mjs && node scripts/check-dead-code.mjs
E2E_PORT=4330 npx playwright test --project=code
```

Lint and dead-code counts must not go up; the e2e suite must pass.
