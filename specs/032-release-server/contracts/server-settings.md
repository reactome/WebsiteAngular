# Contract: the server's settings file

The `.env` a server like the release server keeps beside `docker-compose.yml`. Names only:
values are the server's, never in the repository (FR-011). The guide
(`deploy/release-server/README.md`) carries a copy with placeholders.

| Key                                    | Required | Read by                  | Notes                                                                                                               |
| -------------------------------------- | -------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `REGISTRY`                             | yes      | compose `image:`         | the project's public registry                                                                                       |
| `IMAGE_TAG`                            | yes      | compose `image:`         | full commit id of `main`                                                                                            |
| `COMPOSE_PROFILES`                     | no       | compose                  | leave `graph` out where the host has its own database                                                               |
| `NGINX_ENV`                            | yes      | compose (nginx tag)      | `release`                                                                                                           |
| `SITE_PROFILE`                         | yes      | site container           | `release`                                                                                                           |
| `CONTENT_NODE_ENV_FILE`                | yes      | content-node, pdf-export | path to the credentials file; the file holds `NEO4J_URI`, `NEO4J_DATABASE`, `NEO4J_USER`, `NEO4J_PASSWORD` as today |
| `CONTENT_NODE_UID`, `CONTENT_NODE_GID` | yes      | content-node             | the owner of that file                                                                                              |
| `DIAGRAM_FILES_DIR`                    | yes      | content-node             | the release's diagram folder                                                                                        |
| `RENDER_FILES_DIR`                     | yes      | render                   | the folder holding the release folders, as the download site lays them out (`<it>/99/diagram/...`)                  |
| `EXPRESSION_FILES_DIR`                 | no       | content-node             | unset: the Expression tab answers 503                                                                               |
| `DOWNLOAD_RELEASE`                     | no       | nginx                    | the release number `/download/current/` goes to                                                                     |
| `LETSENCRYPT_DIR`                      | yes      | nginx                    | certificates                                                                                                        |
| `CERTBOT_WEBROOT`                      | yes      | nginx                    | the folder certbot writes challenges to                                                                             |
| `NGINX_SITE_LOCAL`                     | no       | nginx                    | the server's own configuration folder                                                                               |
| `RENDER_CONCURRENCY`                   | no       | render                   | default 2 (research R7)                                                                                             |

A key not in this table is not read. Adding one is a change to this contract.
