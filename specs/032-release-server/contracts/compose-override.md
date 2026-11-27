# Contract: the compose override on a server like the release server

Kept on the server as `docker-compose.override.yml` (compose reads it automatically). Its
shape is fixed here; its values are the server's. The guide carries this with
placeholders.

```yaml
services:
  app:
    # The published site image in place of the development container.
    image: ${REGISTRY:?REGISTRY must be set}/site:${IMAGE_TAG:?IMAGE_TAG must name a commit}
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
  # The published images, pulled, never built: with no `build:` left, an image
  # missing from the registry stops `up` rather than being built here under
  # the registry's name.
  content-node:
    image: ${REGISTRY:?REGISTRY must be set}/content-node:${IMAGE_TAG:?IMAGE_TAG must name a commit}
    build: !reset null
  render:
    image: ${REGISTRY:?REGISTRY must be set}/render:${IMAGE_TAG:?IMAGE_TAG must name a commit}
    build: !reset null
  analysis-gateway:
    image: ${REGISTRY:?REGISTRY must be set}/analysis-gateway:${IMAGE_TAG:?IMAGE_TAG must name a commit}
    build: !reset null
  mcp:
    image: ${REGISTRY:?REGISTRY must be set}/mcp:${IMAGE_TAG:?IMAGE_TAG must name a commit}
    build: !reset null
  nginx:
    image: ${REGISTRY:?REGISTRY must be set}/nginx-${NGINX_ENV:?NGINX_ENV must name the deployment}:${IMAGE_TAG:?IMAGE_TAG must name a commit}
    build: !reset null
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
- Every published service (`app`'s site image, content-node, render, analysis-gateway,
  mcp, nginx) has its `build:` reset and names its image with `${REGISTRY:?...}` and
  `${IMAGE_TAG:?...}` (nginx's `${NGINX_ENV:?...}` too): a server never builds a published
  image, and a setting left out stops `docker compose` with its message rather than
  falling back to the base file's defaults (`registry.invalid`, `main`, `dev`). `!reset`
  needs Docker Compose 2.24 or later.
- `IMAGE_TAG` is a full commit id; the override never names `main` or `latest`.
- No published service sets `pull_policy` (the base file's default, `missing`, pulls;
  `build` or `never` would not). `deploy/release-server/images.spec.ts` reads the block
  above and checks all of this.
- Nothing here holds a credential: the credentials file is mounted by the base compose
  file through `CONTENT_NODE_ENV_FILE`.
- `docker compose config` with this override and the server's `.env` must list no
  `build:` for a published service, and every published image's tag must be a full commit
  id (checked, failing loudly, in the guide's first step).
