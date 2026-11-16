# Contract: the endpoint parameter record

`tools/content-node/parameters.mjs` exports one entry per GET endpoint, keyed by node's endpoint path. For example:

```js
'/ContentService/data/event/{id}/in-depth': {
  java: '/data/event/{id}/in-depth',
  path: { id: 'oid' },
  query: {
    view: VIEW,                // declared on every GET; takes effect here
    includeRef: INCLUDE_REF,
    maxDepth: { type: 'int', default: 1 },
    attributes: { type: 'text', default: 'species,compartment' },
  },
},
'/ContentService/data/event/{id}/ancestors': {
  java: '/data/event/{id}/ancestors',
  path: { id: 'oid' },
  query: { view: VIEW_IGNORED, includeRef: INCLUDE_REF_IGNORED },
},
'/ContentService/interactors/psicquic/resources': {
  java: '/interactors/psicquic/resources',
  cache: 'never',            // an outside registry, re-read every 5 minutes
  query: { view: VIEW_IGNORED, includeRef: INCLUDE_REF_IGNORED },
},
```

## Rules a test enforces

1. The record's keys equal node's GET endpoint paths, so no endpoint is missing and none is extra.
2. Each entry with a `java` operation has exactly the query parameter names that operation declares in the snapshot of Java's published API description, with the same types and defaults. A parameter the description leaves out may appear only with a note saying why.
3. Each `java: null` entry has a `why`.
4. Each path variable in the endpoint path has a kind, and only the variables there do.
5. Every kind and type used has a validator, and each validator has tests:
   - one that accepts each standard form;
   - one that refuses each alias Java would also answer: padded, encoded, Unicode digits, other boolean spellings, `+`, hex, leading zeros.

## The validator's answer

```js
standardForm(endpoint, originalUrl) → { ok: true } | { ok: false, rule: 'parameter:page' | 'path:id' | 'form' }
```

It reads the URL exactly as it was sent: never the rewritten `request.url`, and never Express's decoded params.
