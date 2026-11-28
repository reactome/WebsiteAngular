# Contract: the content service's new settings

Each is read from the environment in `tools/content-node/settings.ts`, named and typed there with the service's other settings. Every one has a default, so an unset setting never stops the service. A folder that is not set turns its feature off with a clear error, rather than writing somewhere unexpected.

## Inside the container

| Setting                   | Default         | Meaning                                                                                      |
| ------------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| `PSICQUIC_CACHE`          | unset: no cache | The folder cached PSICQUIC answers are kept in                                               |
| `PSICQUIC_CACHE_SECONDS`  | `86400`         | How long an answer is kept                                                                   |
| `PSICQUIC_CACHE_BYTES`    | `2147483648`    | The cache's cap on disk; least recently used answers go first                                |
| `PSICQUIC_TIMEOUT_MS`     | `30000`         | The longest one fetch from a third-party server may take (a custom PSICQUIC service's too)   |
| `PSICQUIC_PER_SERVER`     | `4`             | Fetches at once to any one third-party server                                                |
| `PSICQUIC_QUEUE`          | `200`           | Fetches that may wait for one server; past it a fetch fails at once, as a timed-out one does |
| `CUSTOM_INTERACTORS`      | unset: refuse   | The token store's folder. Unset, uploads and token reads answer the service's 503            |
| `UPLOAD_FETCH_TIMEOUT_MS` | `15000`         | The longest an upload by address may take                                                    |
| `UPLOAD_MAX_BYTES`        | `52428800`      | The largest upload, as content, form or address (Java's 50 MB)                               |
| `UPLOAD_RATE_PER_MINUTE`  | `10`            | Uploads a minute from one client (nginx's `X-Real-IP`)                                       |

## On the host (`.env`, never in this repository)

| Setting                  | Meaning                                               |
| ------------------------ | ----------------------------------------------------- |
| `PSICQUIC_CACHE_DIR`     | The host folder mounted read-write as the cache       |
| `CUSTOM_INTERACTORS_DIR` | The host folder mounted read-write as the token store |

In `docker-compose.yml`, each host folder is mounted read-write when it is set, and its container setting is set only then (`PSICQUIC_CACHE=${PSICQUIC_CACHE_DIR:+/data/psicquic-cache}`, as `DIAGRAM_FILES` is set from `DIAGRAM_FILES_DIR`). Compose cannot leave a volume out, so when a host folder is unset its mount falls back to a named Docker volume (`${PSICQUIC_CACHE_DIR:-psicquic-cache}`), which node never writes to because its setting is unset. **No folder inside the repository's checkout is ever mounted read-write**, so no upload or cached answer can be written there. No server's path appears in this repository.
