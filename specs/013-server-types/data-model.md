# Data model: types in the server-side services

## Loose baseline (`tools/loose-baseline.json`)

`{ "<module path>": <count> }`: the `no-unsafe-*` and `no-explicit-any` findings in each module and spec under `tools/`. A module's count may not rise; a lower count fails until the file is lowered (as spec 012's ratchet); a module absent is held to none. A module reaches zero and leaves the file.

## Row type (content service)

A query's row: one property per returned column, with its kind as the driver gives it (`number`, or `string` for an integer beyond the safe range; `null` where the query can return none). Named beside the query that returns it. `read<Row>(cypher, params)` returns `Promise<Row[]>`.

## Document type (search index)

The fields the service reads from an index document and from each handler's answer (`response.docs`, `numFound`, grouped `doclist`, `facet_counts`, `highlighting`, `spellcheck.collations`), each optional unless every recorded answer has it.

## Snapshot type

One per snapshot file (domain, OpenAPI, graph names, jsoup tables, schema, case, RFD), checked against the file in a spec by assigning a JSON import of the file to it.

## Answer type

What a service writes. Where the site reads the same answer (spec 012's call table), the site's model type is the one definition, imported by the service; otherwise defined beside the service.

## Environment

Each service's variables, read once through one function returning a typed configuration.
