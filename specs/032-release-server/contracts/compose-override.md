# Contract: the compose override on a server like the release server

Kept on the server as `docker-compose.override.yml` (compose reads it automatically). Its
shape is fixed here; its values are the server's. The guide carries this with
placeholders.

```yaml
services:
  app:
    # The published site image in place of the development container.
    image: ${REGISTRY}/site:${IMAGE_TAG}
    build: !reset null
    network_mode: host
    volumes: !reset []
    environment:
      - SITE_PROFILE=${SITE_PROFILE}
      - NODE_ENV=production
    restart: unless-stopped
  render:
    volumes:
      - ${RENDER_FILES_DIR}:/files:ro
    environment:
      - RENDER_FILES=/files
      - RENDER_CONCURRENCY=${RENDER_CONCURRENCY:-2}
  java-library: {} # built here: `docker compose build java-library`
  pdf-export: {} # built here, as java-library
```

Rules:

- No `graphdb` entry: it is under the `graph` profile, which this server does not name.
- Every published service runs `${IMAGE_TAG}`; the override never names `main` or
  `latest`.
- Nothing here holds a credential: the credentials file is mounted by the base compose
  file through `CONTENT_NODE_ENV_FILE`.
- `docker compose config` with this override and the server's `.env` must list no
  `build:` for a published service (checked in the guide's first step).
