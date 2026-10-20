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
rebound: javaTrim in body.ts is not the javaTrim service.ts had at <base>
rebound: javaJson, used by pageText in paging.ts, is global there; in service.ts at <base> it was declared
```

A `rebound` line covers both an import that resolves to something else and any name a moved declaration uses that is bound differently where it now is: the receiving module's own declaration of that name, or a global where the original module had a declaration or an import. Names the moved code declares itself (locals, parameters) are not compared. The same holds for code that stays where it was: a caller left in `service.ts` that now reaches another module's helper of the same name is `rebound` too.

## Baseline totals (`node scripts/check-baseline-totals.mjs [base]`)

It passes with:

```text
loose <n> (base <n>) · implicit any <m> (base <m>) · lint <k> (base <k>)
```

It fails with:

```text
loose rose: <n+1>, base <n> -- a move keeps totals; typing lowers them
loose in tools/content-node/a.ts rose: 6, base 5 -- a move keeps totals; typing lowers them
```

A module the base branch already counts may not rise, even if another falls, unless it is one the split creates to receive moved code (the shared modules, the families, the registry, the server), which a later move may add to. Code never moves into the services' other modules, so a rise in one of those is new code. The split's modules are held by the total.

The per-module checks (`check:types` for implicit `any`, `check:lint` for loose values) also fail on a fall that is not locked in with `--update`, so room left by typing cannot be spent later without the baseline moving.

## Route order (a spec over the registry)

It fails when the list differs from the recorded one, or when one of the 15 named pairs is out of order:

```text
/ContentService/data/query/{id}/{attribute} is matched before /ContentService/data/query/enhanced/{id}
```
