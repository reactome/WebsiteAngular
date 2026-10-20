# Quickstart: checking a move, and the upgrade

Every command runs from the repository root, with Node 24 on the path.

## A family's move

```bash
node scripts/check-move.mjs origin/main          # moved, 0 changed, 0 missing
node scripts/check-baseline-totals.mjs origin/main
node scripts/check-types.mjs && node scripts/check-lint.mjs && node scripts/check-dead-code.mjs
npx vitest run tools deploy/nginx/routes.spec.ts # the order test and the boundary test among them
```

Expected:

- Every command passes.
- The load test now counts the new module.
- The move check lists that family's declarations and endpoints as moved, none changed.

## On beta, after each move

1. Capture before the deploy. Use the same small, spaced capture of answers as spec 013 used, covering the family that moved and two others.
2. Rebuild content-node (only content-node, never the graph database).
3. Capture again and compare.

Expected: every answer is byte-identical, apart from a timestamp that changes per request.

## The upgrade to Express 5

```bash
node tools/content-node/diff.ts                  # against Java: the same result as before
node tools/content-node/invalid-inputs.ts | …    # the corpus, against both, as spec 011 ran it
```

Both run small and spaced. The shared graph database has run out of memory under parity load before.

Expected:

- The same differences as before the upgrade, which are only the ones the endpoints declare.
- The URL forms in the spec answer as before.
- A handler made to reject is answered with the service's 500, and nothing is logged as an unhandled rejection.

## See each new check fail (constitution III)

1. **The move check.** Change one character in a moved function. It reports `changed:` with that function's name.
2. **The baseline totals.** Raise one module's count in `tools/loose-baseline.json`. It reports `loose rose`.
3. **The boundary test.** Import one family from another. It names both modules.
4. **The order test.** Swap two endpoints of one of the 13 order-dependent pairs. It names the pair.
5. **The endpoint type.** Misspell `sample` as `sampel` in one endpoint. `check:types` fails on it.

Each is undone after it has been seen to fail.
