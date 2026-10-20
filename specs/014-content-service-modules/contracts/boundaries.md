# Contract: what may import what

The service's HTTP answers are not a contract this feature changes. Every one stays byte-identical.

The contract here is between the modules:

| Module                                                                                                                                                                                 | May import                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `java-text`                                                                                                                                                                            | the services' existing leaves (`java-hashmap`, `schema`, …)     |
| `body`                                                                                                                                                                                 | `java-text`                                                     |
| `spring`                                                                                                                                                                               | `java-text`, `body`                                             |
| `answers`                                                                                                                                                                              | `java-text`, `spring`                                           |
| `objects`                                                                                                                                                                              | the above, `graph`, `domain`                                    |
| `reference-entities`, `search-params`, `release`                                                                                                                                       | the above, `solr`                                               |
| a family (`data-query`, `pathways-events`, `content`, `person`, `entities`, `mapping-species`, `schema-endpoints`, `interactors`, `exporters`, `citation`, `search`, `search-diagram`) | any shared module; **never another family, never the registry** |
| `registry`                                                                                                                                                                             | the families                                                    |
| `server`                                                                                                                                                                               | the registry, the shared modules                                |

A test reads each module's imports and fails on any import this table does not allow, naming the module and the import. It is shown failing first: make one family import another.

The family module for `/data/schema/*` is `schema-endpoints`, because `schema.ts` already exists. It is the model's class table, and stays as it is.
