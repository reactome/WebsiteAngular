# Contract: what the new checks report

## Move check (`node scripts/check-move.mjs [base]`)

It compares the base branch's `service.ts` and today's modules: every top-level declaration by name, and every endpoint by path.

It passes with:

```text
moved <d> declarations and <e> endpoints, 0 changed; 0 missing; 0 added; 0 rebound
```

It fails with a line for each difference:

```text
changed: searchEntry (now in search-endpoints.ts) differs from service.ts at <base>
missing: facetMapping (in service.ts at <base>, nowhere now)
added: javaTrim (in body-endpoints.ts: not there at <base>, nor moved in)
rebound: javaTrim in body.ts is jsoup-text.ts's, not the one service.ts had at <base>
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

It fails when the list differs from the recorded one, or when one of the 15 named pairs is out of order:

```text
/ContentService/data/query/{id}/{attribute} is matched before /ContentService/data/query/enhanced/{id}
```
