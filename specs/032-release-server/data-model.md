# Data model: The release server runs the site's stack

No stored data. The entities are configuration, and where each one lives.

## Server settings (kept on the server)

The `.env` beside the compose file, plus the override file (contracts:
[server-settings.md](contracts/server-settings.md), [compose-override.md](contracts/compose-override.md)).

| Field                                   | Meaning                                       | Rule                                                                                      |
| --------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `IMAGE_TAG`                             | the commit whose images run                   | a full commit id that CI published; never `main` on this server (one commit, never a mix) |
| `REGISTRY`                              | where images are pulled from                  | the project's public registry                                                             |
| `COMPOSE_PROFILES`                      | optional services                             | without `graph` here (D4)                                                                 |
| `NGINX_ENV`                             | which nginx tag                               | `release`                                                                                 |
| `SITE_PROFILE`                          | the site's deployment row                     | `release`; unknown names stop the site at start                                           |
| `CONTENT_NODE_ENV_FILE`                 | the graph's credentials file                  | a path on the server, mode 0600, never in git                                             |
| `DIAGRAM_FILES_DIR`, `RENDER_FILES_DIR` | the release's files folder                    | the release being staged; moved with each release                                         |
| `DOWNLOAD_RELEASE`                      | the release `/download/current/` redirects to | a release number; unset keeps `current`                                                   |
| `LETSENCRYPT_DIR`, `CERTBOT_WEBROOT`    | certificates and the challenge folder         | host folders, read-only in nginx                                                          |
| `NGINX_SITE_LOCAL`                      | the server's own nginx folder                 | a host folder; unset mounts the empty default                                             |

State: the settings change at a release (files folder, `DOWNLOAD_RELEASE`) and at an update
(`IMAGE_TAG`). Nothing else changes them.

## Image

| Field     | Meaning                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------- |
| name      | one per published service (research R1's table)                                                      |
| tags      | the full commit id; `main` moved after every image of that commit is pushed; nginx's per `NGINX_ENV` |
| published | yes, or built on the server (java-library, pdf-export)                                               |

Transitions: built in CI from a green commit → pushed by commit id → `main` moved. A
server moves `IMAGE_TAG`, pulls, and recreates; a failed pull changes nothing.

## Site-local configuration (kept on the server)

| Part                        | Included from                             | Holds                                                           |
| --------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| `site-local/*.conf`         | `release.conf`'s top level (http context) | whole `server` blocks: other host names                         |
| `site-local/release/*.conf` | the release host's `server` block         | `location` blocks on the release host: the build service's path |

Rule: the repository's folder is empty; examples live in `deploy/nginx/site-local-examples/`
and are loaded by `test-config.sh` only.

## Deployment row (in the repository)

`release` in `environments.ts`: `variant: 'main'`, `host: 'origin'`, the release host as
`originFallback`, no `gtagId`, no `deltaSignal`, the search-answer, analysis-summary and
chat-handoff endpoints as on beta.
