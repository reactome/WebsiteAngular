# Contract: what may import what

The service's HTTP answers are not a contract this feature changes. Every one stays byte-identical.

The contract here is between the modules:

| Module                                                                                                                                                                     | May import                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `java-text`                                                                                                                                                                | the services' existing leaves (`java-hashmap`, `schema`, …)               |
| `body`                                                                                                                                                                     | `java-text`                                                               |
| `spring`                                                                                                                                                                   | `java-text`, `body`                                                       |
| `answers`                                                                                                                                                                  | `java-text`, `spring`                                                     |
| `objects`                                                                                                                                                                  | the above, `graph`, `domain`                                              |
| `reference-entities`, `search-params`, `release`                                                                                                                           | the above, `solr`                                                         |
| `search-core`                                                                                                                                                              | the above, layer 6 included (what both search families share)             |
| a family (`<family>-endpoints`: data-query, pathways-events, content, person, entities, mapping-species, schema, interactors, exporters, citation, search, search-diagram) | any shared module, any leaf; **never another family, never the registry** |
| `registry`                                                                                                                                                                 | the families                                                              |
| `server`                                                                                                                                                                   | the registry, the shared modules                                          |

A test reads each module's imports and fails on any import this table does not allow, naming the module and the import. It is shown failing first: make one family import another.

A **leaf** is any module of the service not in the table -- `graph`, `solr`, `domain`, `schema`, `settings`, `endpoint` (the `Endpoint` types) and the like, and any module added without a row -- and imports only leaves. Every shared module may import leaves besides the shared modules its row names: `spring` reads `domain`'s views, for one. So a family, or `answers`, declares `Endpoint[]` or returns a `Handler` from `endpoint.ts`, never from the registry. The two tools that read the endpoint list, `diff` and `invalid-inputs`, may import anything, and nothing in the service imports them.

Every family module is named `<family>-endpoints.ts`, because several family names are taken already: `schema.ts` (the model's class table) and `citation.ts` (the citation formatter) stay as they are.
