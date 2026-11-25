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
    # Reset or overridden, not merged: the base service's development settings (its bridge
    # addresses for Tomcat and the render service, its ports, a terminal) do
    # not hold on the host's network.
    ports: !reset []
    extra_hosts: !reset []
    stdin_open: false
    tty: false
    # The site's own settings, as beta's service reads them: the human check's
    # keys, the identity secret, the chat's addresses (ANSWER_UPSTREAM,
    # SUMMARY_UPSTREAM, HANDOFF_UPSTREAM: this server's own, never another
    # deployment's), TRUSTED_PROXIES. The same file the analysis gateway mounts.
    env_file: !override ['${ANSWER_ENV_FILE}']
    volumes: !override
      - type: bind
        source: ${CALLER_TOKEN_KEY_FILE}
        target: /run/secrets/caller-token.key
        read_only: true
        bind:
          create_host_path: false
    environment: !override
      - SITE_PROFILE=${SITE_PROFILE}
      - NODE_ENV=production
      - CALLER_TOKEN_KEY=/run/secrets/caller-token.key
    restart: unless-stopped
  java-library: {} # built here: `docker compose build java-library`
  pdf-export: {} # built here, as java-library
```

`environment` wins over `env_file` for a key in both, so the key's path is the
container's whatever the settings file says. The contact form needs a `sendmail`, which
the site image does not have: until it does (T031), the settings file this container gets
leaves `CONTACT_TO` unset, and the form says it cannot send rather than failing.
The render service needs no entry: the base file reads `RENDER_FILES_DIR` and
`RENDER_CONCURRENCY` from the settings file (T016). `RENDER_FILES_DIR` names the folder
holding the release folders (`<it>/99/diagram/...`), as the download site lays them out,
not one release's own folder.

Rules:

- No `graphdb` entry: it is under the `graph` profile, which this server does not name.
- Every published service runs `${IMAGE_TAG}`; the override never names `main` or
  `latest`.
- Nothing here holds a credential: the credentials file is mounted by the base compose
  file through `CONTENT_NODE_ENV_FILE`.
- `docker compose config` with this override and the server's `.env` must list no
  `build:` for a published service (checked in the guide's first step).
