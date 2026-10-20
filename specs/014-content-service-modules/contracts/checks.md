# Contract: what the new checks report

## Move check (`node scripts/check-move.mjs [base]`)

It compares the base branch's `service.ts` and today's modules: every top-level declaration by name, and every endpoint by path.

It passes with:

```text
moved <d> declarations and <e> endpoints, 0 changed; 0 missing
```

It fails with a line for each difference:

```text
changed: searchEntry (search.ts:120) differs from service.ts at base: line 14 of the body
missing: facetMapping (in service.ts at base, nowhere now)
```

## Baseline totals (`node scripts/check-baseline-totals.mjs [base]`)

It passes with:

```text
loose <n> (base <n>) · implicit any <m> (base <m>) · lint <k> (base <k>)
```

It fails with:

```text
loose rose: <n+1>, base <n> — a move keeps totals; typing lowers them
```

## Route order (a spec over the registry)

It fails when the list differs from the recorded one, or when one of the 13 recorded pairs is out of order:

```text
/ContentService/data/query/{id}/{attribute} is matched before /ContentService/data/query/enhanced/{id}
```
