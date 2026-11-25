# Tasks: The release server runs the site's stack

**Input**: Design documents from `specs/032-release-server/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**How each task is done**: one pull request per task (or per task group where marked), its
own adversarial review, every new check **seen failing first** (constitution III), and
`tasks.md` ticked with the PR number in the same pull request. Public repository: no host
beyond `release.reactome.org`, no server paths, sizes, credentials, internal process or
names (FR-011).

**Who does it**: tasks marked **(server session)** are done by the session with access to the
release server, which ticks them with its results; the numbers it measures stay in its own
notes (FR-011). Every other task is done in this repository.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 (spec.md)

---

## Phase 1: Setup

No setup beyond the worktree: every file this spec touches exists or is created by its own
task.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: compose and nginx changes a server with its own graph database needs, with no
change to what beta runs.

- [x] T001 Put `graphdb` under a compose profile `graph` in `docker-compose.yml`, with a comment saying why (a host with its own database must not start a second one, D4). **Same deploy**: add `COMPOSE_PROFILES=graph` to beta's `.env` (not committed) before `deploy-beta.sh` runs, and add it to `.env.example` with its reason. Check after deploy: `docker compose ps --services` lists the same services as before, and the graph answers (`/ContentService/data/database/version`). Seen failing: without the `.env` line, `docker compose config --services` omits `graphdb`. Done (#1072): beta's `.env` has the line; a dry-run `up` with the change recreates nothing (the same as `main`'s), and without the profile it leaves the running graph alone.
- [x] T002 [P] Mount the certbot webroot into nginx in `docker-compose.yml`: `${CERTBOT_WEBROOT:-./deploy/nginx/no-webroot}:/var/www/certbot:ro`, with `deploy/nginx/no-webroot/.gitkeep`. Comment: every config routes the challenge path there, and without the mount the folder in the container is empty, so a webroot renewal through this nginx would 404 (research R5). Done (#1073), with T003 and T004 in one PR (same files). Proved by T025.
- [x] T003 [P] Site-local folder: `deploy/nginx/Dockerfile` creates `/etc/nginx/site-local/release/` empty; `docker-compose.yml` mounts `${NGINX_SITE_LOCAL:-./deploy/nginx/site-local-empty}:/etc/nginx/site-local:ro` (with `deploy/nginx/site-local-empty/release/.gitkeep`); `deploy/nginx/release.conf` includes `/etc/nginx/site-local/*.conf` at its top level and `/etc/nginx/site-local/release/*.conf` inside the release host's 443 server block, per [contracts/site-local-nginx.md](contracts/site-local-nginx.md). Seen failing: a deliberately broken file in the folder makes `nginx -t` fail. Done (#1073): seen failing with a broken file and with an example claiming `default_server`; a duplicate prefix location is refused, a duplicate regular-expression one is not (it loads and is never reached), so the contract asks for `^~` prefixes.
- [x] T004 Extend `deploy/nginx/test-config.sh` to test `release` twice: with the empty folder, and with `deploy/nginx/site-local-examples/` mounted at `/etc/nginx/site-local` (the folder starts with one trivial example; US3 fills it). Run it; CI runs it on every pull request already. Seen failing: an example with a syntax error fails the second run, not the first.

**Checkpoint**: beta runs as before; the release configuration accepts a site-local folder.

---

## Phase 3: User Story 1 — The release is checked on its own server, through the new site (P1) 🎯 MVP

**Goal**: the release server can run the whole site from published images, as the
`release` deployment, with `/download/` going to the download site.

**Independent test**: on this host, the stack started from published images (pulled by
commit id) with the [compose override](contracts/compose-override.md), the site on a spare
port answers `/`, a pathway, a search and `/download/current/...` as quickstart §3 says.

### The site as a container (R2)

Done (#1073).

- [ ] T005 [US1] Add the `release` row to `projects/website-angular/src/config/environments.ts` (`ProfileName`, `SITE_PROFILES`): `variant: 'main'`, `host: 'origin'`, `originFallback: 'https://release.reactome.org'`, no `gtagId`, no `deltaSignal`, the search-answer, analysis-summary and chat-handoff endpoints as beta's, `gsaServer` as beta's, with a comment on each difference from beta (data-model "Deployment row"). Unit test beside the existing profile tests: `getProfile('release')` has no analytics property and DeltaSignal off; seen failing with beta's row copied unchanged.
- [ ] T006 [US1] `SITE_PROFILE` in `projects/website-angular/src/scripts/serve-prod.js`: when set, the `index.html` it serves gets `<script>window.__APP_ENV="<name>"</script>` before the app's scripts; the name must be a known profile (read from the built bundle's list or a small JSON written at build time), and an unknown one stops the server at start with a message naming the known ones. Unset: the page is byte-identical to today's (beta's systemd service unchanged). Unit tests: set, unset, unknown; each seen failing against a mutant.
- [ ] T007 [US1] `deploy/site/Dockerfile`: stage 1 runs beta's build (`npm ci`, `npm run generate:indices`, `npm run stage:content`, the `reactome-table` and `reactome-gsa-form` libraries, `ng build reactome --configuration production,beta --output-path` into the stage, the embeddable diagram's build); stage 2 `node:24-slim` with production dependencies, `serve-prod.js` and what it requires, `proxy.conf.js`, the built folders, `DIST_DIR` and `EMBED_DIST_DIR` set, `HEALTHCHECK` on `/health`, a non-root user. Never builds into the host's `dist/`.
- [ ] T008 [US1] CI smoke test for the site image in `.github/workflows/tests.yml`: build `deploy/site/Dockerfile`, run it, and check `/health` reports a bundle and `/` serves the app's `index.html` with `SITE_PROFILE=release`'s line in it. Seen failing: with `DIST_DIR` pointing at an empty folder.

### Published images (R1)

- [ ] T009 [US1] `.github/workflows/publish-images.yml`: `workflow_run` after Tests completes successfully for a `push` to `main` (the same guard `deploy.yml` uses, and tested the same way in `tools/workflows.spec.ts`); assumes the registry role by OIDC (`vars.REGISTRY_ROLE`, `vars.REGISTRY`); builds and pushes `site`, `content-node`, `render`, `analysis-gateway`, `mcp`, and `nginx-<env>` for each `NGINX_ENV`, each tagged with the full commit id; after **all** are pushed, moves each image's `main` tag. Never java-library or pdf-export (a check in `tools/workflows.spec.ts` refuses their Dockerfiles in this workflow; seen failing with one added). Merged with the job's `if:` also requiring `vars.REGISTRY` set, so it does nothing until the registry exists.
- [ ] T010 [US1] **(server session)** Create the registry's repositories (one per image in T009) and the role CI assumes, allowed to push to them only; set `vars.REGISTRY` and `vars.REGISTRY_ROLE` on the repository. Check: the next `main` commit's run pushes every image, and `docker pull <registry>/site:<sha>` works without credentials.
- [ ] T011 [US1] `image: ${REGISTRY:-local}/<name>:${IMAGE_TAG:-main}` beside each published service's `build:` in `docker-compose.yml`, so `docker compose pull` fetches them on a server and `docker compose build` still builds them on beta. Comment: a server pins `IMAGE_TAG` to a commit id, never `main` (one commit's images, never a mix). Check on beta: `docker compose config` unchanged apart from the `image:` lines, and a deploy recreates nothing it would not have.

### nginx for the release host (R4)

- [x] T012 [US1] `/download/` in `deploy/nginx/release.conf`: `location ^~ /download/` answering 302 to `https://download.reactome.org/<release>/...`, `current` replaced by `${DOWNLOAD_RELEASE}` through the nginx image's template step (move `release.conf` to `/etc/nginx/templates/default.conf.template` for the `release` env only, in `deploy/nginx/Dockerfile`, with `NGINX_ENVSUBST_FILTER` limited to `DOWNLOAD_RELEASE` so nginx's own `$` variables are untouched); unset, `current` is kept. `/download-data` (the site's page) is untouched. Test in `deploy/nginx/test-config.sh` or a small `curl` check against the built image: `/download/current/x` → `/99/x` with `DOWNLOAD_RELEASE=99`, `/download/98/x` kept, `/download-data` not redirected. Seen failing: without the template step the `${...}` reaches nginx literally. Done (#1079), by a different mechanism: a `map` on the host name reading `site-local/download-release.map`, not the template step (research R4 says why). `test-config.sh` runs the redirects for real, with the example file and without it. Seen failing: the map's include removed, and the location misnamed.

### Checking a release's graph (R3, SC-003)

- [ ] T013 [P] [US1] `tools/release-check/endpoints.ts`: asks at least 30 content endpoints (every family in `tools/content-node/registry.ts` once, with real identifiers read from the server's own graph first: the top-level pathways of a species, then a pathway, a reaction, an entity and a complex from them), checks each answers 200 and matches its contract shape with the checker `tools/api-types/schema.spec.ts` uses, and, given `--compare <base>`, the same answer as another host. Reads back the graph's indexes first (`SHOW INDEXES` through the content service's status or a read-only query the operator runs) and names a missing one the service relies on. Typed (`noImplicitAny`), joins `tools/load.spec.ts`'s list as a script that does its work when run (`RUN_ON_LOAD`). Seen failing: against a stub answering one endpoint with the wrong shape.

### The guide

- [ ] T014 [US1] `deploy/release-server/README.md`: running the stack on a server with its own graph database, following [quickstart.md](quickstart.md): the settings file ([contracts/server-settings.md](contracts/server-settings.md), with placeholders), the override ([contracts/compose-override.md](contracts/compose-override.md)), pulling one commit (`IMAGE_TAG`), building java-library and pdf-export there, the spare-port trial, the checks, updating, moving the release's files folder at a release, and what is never in the repository. Linked from `deploy/nginx/README.md` and the root `README.md`'s deployment section.
- [ ] T015 [US1] **(server session)** Bring the stack up beside the old web server on a spare port (quickstart §1–2) and run quickstart §3 (SC-001's site, pathway, search, analysis, downloads, chat, version) and T013's check against the server (SC-003). Tick with pass/fail per row; differences found become tasks here.

**Checkpoint**: the release server can serve the new site from `main`'s images.

---

## Phase 4: User Story 2 — The release's PDF step can run there (P1)

**Goal**: pdf-export's figures step on the release server draws through that server's render
and content services, from local files, never while Tomcat is stopped.

**Independent test**: the render service's health on the server reports local files and the
release's content service; a figures run on a handful of pathways writes their figures with
no request to production (quickstart §4).

- [ ] T016 [US2] The render service's files in the override: confirm `RENDER_FILES` is read by `tools/render` as spec 018 describes, and that the override in [contracts/compose-override.md](contracts/compose-override.md) and the guide mount `RENDER_FILES_DIR` read-only and set `RENDER_FILES` and `RENDER_CONCURRENCY`. If the base compose file should carry it (empty default, as `DIAGRAM_FILES_DIR`), add it to `docker-compose.yml` instead, with the same "unset → empty folder, never another release's files" rule. Seen failing: a figure whose files are missing answers an error, not a fetch from the download site.
- [ ] T017 [P] [US2] PDF job settings in `deploy/release-server/README.md` (research R7): `RENDER_SERVICE=http://127.0.0.1:4310`, `CONTENT_SERVICE` the node content service directly on loopback (not through nginx, whose per-client limits would throttle a bulk run), `RENDER_CONCURRENCY` 2 to start with `--parallel` matching, raised only from T019's measurement; and the requirement that the job never runs while a release step has stopped Tomcat (one lock shared by those steps and the PDF job, configured where the jobs live).
- [ ] T018 [US2] **(server session)** Set the PDF job's settings and the shared lock; run the figures step on a handful of pathways (SC-005). Tick with the result.
- [ ] T019 [US2] **(server session)** Memory (FR-010, SC-007), research R6's method: at rest, during the figures step on 100 pathways, during one book part. Recorded in the session's notes, not here; the tick says it was done and what the owner decided to cut.

**Checkpoint**: the book can be made on the release server.

---

## Phase 5: User Story 3 — The server's other sites keep working (P2)

**Goal**: the build service's path, a wiki and a redirect host are configured on the server
through the site-local folder, from documented examples.

**Independent test**: `test-config.sh` loads every example; on the server, quickstart §3's
build-service, wiki and unknown-host rows pass.

- [x] T020 [P] [US3] `deploy/nginx/site-local-examples/release/build-service.conf`: `location ^~ /build/` proxied to `127.0.0.1:PORT` with `Host`, `X-Forwarded-Proto https`, `X-Forwarded-Port 443`, `proxy_buffering off`, `proxy_request_buffering off`, a long `proxy_read_timeout`, an upload limit; comments say which failure each line prevents (wrong public addresses, a long request cut off, an upload refused). Done (#1080), with T021–T023 in one PR (the same test).
- [x] T021 [P] [US3] `deploy/nginx/site-local-examples/wiki.conf`: a `server` block for `wiki.example`, its certificate, PHP through `fastcgi_pass unix:/run/php/php-fpm.sock` (PHP-FPM on the host, or a container's port; the comment gives both), the wiki's upload limit as a placeholder, its configuration and data folders denied. Done (#1080): the PHP-FPM socket's folder, or a PHP-FPM container, and the wiki's folder mounted at one path in both.
- [x] T022 [P] [US3] `deploy/nginx/site-local-examples/redirect.conf`: a `server` block for `redirect.example` answering 301 to its target, on 80 and 443. Done (#1080).
- [x] T023 [US3] `test-config.sh` (T004) loads all three; the guide (T014) describes copying and filling them on the server. Seen failing: an example claiming `default_server` is refused (duplicate default), and a check that the unknown-host refusal still answers 503 with the examples loaded. Done (#1080): run for real with a stand-in build service on the example's port: the wiki's redirect to https, the redirect host's, the build path reaching its service (200) and not the site, and an unknown name still refused (503); the examples' certificates stood in for like the configuration's. Seen failing: the wiki's redirect removed, and the redirect host taking the unknown name; earlier, an example claiming `default_server` (#1073).
- [ ] T024 [US3] **(server session)** Write the server's own site-local files from the examples; check the build service (pages, a login, a long request, the public addresses it writes), the wiki (pages, an upload at today's limit) and the redirect through the spare port. Tick with the result.

**Checkpoint**: nothing on the server depends on the old web server for its pages.

---

## Phase 6: User Story 4 — Certificates renew without the old web server (P2)

**Goal**: every certificate on the server renews with the old web server stopped.

**Independent test**: `certbot renew --dry-run` for each certificate passes with the old
web server stopped (SC-004).

- [ ] T025 [US4] Prove the webroot mount (T002): a check in `deploy/nginx/test-config.sh` (or beside it) that starts the `release` image with a temporary webroot holding `.well-known/acme-challenge/probe`, and asks `http://release.reactome.org/.well-known/acme-challenge/probe` through it (`Host` header); 200 with the file's text. Seen failing: without the mount, 404.
- [ ] T026 [US4] Renewal steps in `deploy/release-server/README.md`: for each certificate, move its renewal from the old web server's authenticator to `webroot` with `CERTBOT_WEBROOT`, or to the DNS method beta uses (`deploy/nginx/README.md`) where the name is behind the CDN; reload nginx after renewal (a deploy hook running `docker compose exec nginx nginx -s reload`); the dry run to check.
- [ ] T027 [US4] **(server session)** Move each certificate's renewal and run each dry run with the old web server stopped (SC-004). Tick with the result.

**Checkpoint**: the old web server can be stopped for good (the cutover is the user's).

---

## Phase 7: Polish & cross-cutting

- [ ] T028 SC-006: search the repository for server specifics (host names other than the public ones already in it, server paths, sizes, credentials, the names of the server's other sites) in every file this spec added or changed; none found. A check in `tools/` that fails on the patterns the guide's placeholders replace, seen failing with one planted.
- [ ] T029 [P] Link the guide and this spec from `deploy/nginx/README.md` (the site-local folder, the webroot) and `.env.example` (the new keys with their reasons); `CLAUDE.md` gets one line under nginx: the site-local folder is the server's, never the repository's.
- [ ] T030 Beta onto the site image (R2's later step): after the release server has run the image a week, beta's systemd service is replaced by the `app` override with `SITE_PROFILE=beta`, so both hosts run the same thing. Separate PR, checked like any deploy.

---

## Dependencies & order

- **Phase 2** before everything: T001 first (it changes beta's `.env`), T002–T003 in parallel, T004 after T003.
- **US1**: T005 → T006 → T007 → T008. T009 needs T007 (the site image) and T010 (server session) to do anything; T011 after T009. T012 after T003. T013 independent. T014 after T011–T013. T015 last.
- **US2** after T011 (images) and T014 (the guide). T016–T017 in parallel; T018–T019 server session.
- **US3** after T004; T020–T022 in parallel; T023, then T024.
- **US4** after T002; T025, T026, then T027.
- **Polish** after the stories it touches; T030 after T015 plus a week.

## Parallel examples

- Phase 2: T002 and T003 together.
- US1: T013 alongside T005–T008; T012 alongside T009.
- US3: T020, T021, T022 together.

## Implementation strategy

1. **MVP = Phase 2 + US1 (T001–T015)**: the release server serves the new site from
   `main`'s images. This is what the release is checked in.
2. **US2** next: it is the reason the work started (the book), and needs US1's stack.
3. **US3 and US4** before the cutover: without them, retiring the old web server breaks
   the other sites and certificate renewal.
4. The cutover itself is the user's (spec Assumptions).
