# Contract: the content service's new settings

Each is read from the environment in `tools/content-node/settings.ts`, named and typed there with the service's other settings. Every one has a default, so an unset setting never stops the service, and a folder that is not set turns its feature off with a clear error rather than writing somewhere unexpected.

| Setting                   | Default         | Meaning                                                                                                |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| `PSICQUIC_CACHE_DIR`      | unset: no cache | The folder cached PSICQUIC answers are kept in (mounted read-write)                                    |
| `PSICQUIC_CACHE_SECONDS`  | `86400`         | How long an answer is kept                                                                             |
| `PSICQUIC_CACHE_BYTES`    | `2147483648`    | The cache's cap on disk; least recently used answers go first                                          |
| `PSICQUIC_TIMEOUT_MS`     | `30000`         | The longest one fetch from a third-party server may take                                               |
| `PSICQUIC_PER_SERVER`     | `4`             | Requests at once to any one third-party server                                                         |
| `CUSTOM_INTERACTORS_DIR`  | unset: refuse   | The token store's folder (mounted read-write). Unset, uploads and token reads answer the service's 503 |
| `UPLOAD_FETCH_TIMEOUT_MS` | `15000`         | The longest an upload by address may take                                                              |
| `UPLOAD_RATE_PER_MINUTE`  | `10`            | Uploads per client a minute                                                                            |

In `docker-compose.yml`, each folder is mounted from a path the deployment's `.env` names, with an empty default folder in the repository, as `DIAGRAM_FILES_DIR` is. No server's path appears in this repository.
