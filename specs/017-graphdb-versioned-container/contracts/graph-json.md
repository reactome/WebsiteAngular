# Contract: `deploy/graphdb/graph.json`

The configuration the graph is to run. Read by the apply step (to build the applied image), by `status` (to
report a pending change) and by `graph.spec.ts` (FR-012). Fields and their rules are in
[data-model.md](../data-model.md); the shape:

```json
{
  "neo4j": {
    "version": "4.3.6",
    "image": "neo4j:4.3.6-community",
    "digest": "sha256:cda7786843922909655ef8c7b8771d192ea3fa3557eecfe24add193d4c916e48"
  },
  "releaseBuild": "4.3.6",
  "plugins": [
    {
      "name": "apoc",
      "version": "4.3.0.12",
      "url": "https://github.com/neo4j-contrib/neo4j-apoc-procedures/releases/download/4.3.0.12/apoc-4.3.0.12-all.jar",
      "sha256": "a59fc3376e2c78716203fc72f00cdaa95c2e3f55fd13a5a774eb00097d4d2d1b"
    }
  ],
  "settings": {
    "dbms.default_database": "graph.db",
    "dbms.security.procedures.unrestricted": "apoc.*",
    "dbms.config.strict_validation": "true"
  }
}
```

The settings shown are illustrative; the first task copies the host installation's settings that matter
(memory, Bolt, procedures) and records each one's reason.

## What CI refuses (each seen failing once)

| Change                                                                                                                                                           | Message names                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `neo4j.version` older than `releaseBuild`                                                                                                                        | the server could not open the release's store |
| `neo4j.version` in another major than `releaseBuild`                                                                                                             | a migration, not an apply (FR-008)            |
| `neo4j.image` tag not matching `neo4j.version`                                                                                                                   | the two versions                              |
| `neo4j.digest` missing or malformed                                                                                                                              | the field                                     |
| a plugin without `version`, `url` or `sha256`, or a malformed sha256                                                                                             | the plugin                                    |
| a plugin version not for the Neo4j minor version                                                                                                                 | the plugin and both versions                  |
| `dbms.default_database` not `graph.db`                                                                                                                           | the setting                                   |
| a required setting missing: Bolt listen address, heap, page cache, `dbms.security.procedures.unrestricted` for the plugins, `dbms.config.strict_validation=true` | the setting                                   |
| `dbms.allow_upgrade`, `dbms.recovery.fail_on_missing_files` or `unsupported.dbms.tx_log.fail_on_corrupted_log_files` present                                     | one start of one step only (FR-003)           |
