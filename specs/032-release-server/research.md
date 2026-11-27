# Research: The release server runs the site's stack

What the plan rests on, read from the repository as it stands (24 Nov 2026) and from the
handoff of the session with access to the release server. Server details stay out of
this file (FR-011): "the release server" is all it is called.

> **Since retired (27 Nov 2026, T034, #1105):** `deploy.yml`, the workflow that copied
> the site's build to a static file bucket, is gone; the site is published only as the
> image R1 and R2 describe. Where this file cites `deploy.yml`, it records what stood
> when the plan was made.

## R1. Getting the images there: published by CI, pulled by the server

**Decision**: a new workflow, `publish-images.yml`, runs after Tests passes on `main`
(the same `workflow_run` trigger `deploy.yml` uses, so nothing is published from a red
commit). It builds the redistributable images and pushes each to the project's public
registry, tagged with the full commit id and `main`. The compose file gains an `image:`
for each, named by `REGISTRY` and `IMAGE_TAG` (default `main`), so `docker compose pull`
on a server fetches them and `docker compose build` on beta still builds the same
services locally.

| Image            | Published                                                                       | Why                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| site (new, R2)   | yes                                                                             | our code and redistributable dependencies                                                                                                                                                                           |
| content-node     | yes                                                                             | ours                                                                                                                                                                                                                |
| render           | yes                                                                             | ours, plus Chromium from its base image                                                                                                                                                                             |
| analysis-gateway | yes                                                                             | ours                                                                                                                                                                                                                |
| mcp              | yes                                                                             | already built from a public repository's ref                                                                                                                                                                        |
| nginx            | yes, one tag per `NGINX_ENV` (`nginx-release`, `nginx-dev`, `nginx-production`) | the configuration is baked in by design (a checkout cannot change what it serves); the server picks the tag for its role                                                                                            |
| java-library     | **no**                                                                          | its graph library declares no licence (spec 010 R10); built on the server from `deploy/java/PINS.md`'s commits, with Docker alone (it already builds in CI from a clean checkout, `tests.yml`)                      |
| pdf-export       | **no, for now**                                                                 | built from the commit PINS.md pins; its own licence check (pdf-export spec 001, US4) covers its dependencies, but publishing it is a decision for that repository. Built on the server like java-library until then |

- **One commit, never a mix** (spec edge case): the server pulls by commit tag, never by
  `main`, through `IMAGE_TAG=<sha>` in its settings file, and the workflow publishes every
  image of a commit before it moves the `main` tag. A failed pull leaves the running
  containers as they were (`docker compose pull` then `up -d`, never `down` first).
- **Authentication**: the repository's CI already assumes an AWS role by OIDC
  (`deploy.yml`, `vars.AWS_ROLE`). Publishing needs a role allowed to push to the
  registry's repositories; the release-server session creates the repositories and the
  role (spec Assumptions). A public registry needs no credentials to pull.
- **Build cost in CI**: the site's image is the slow one (the Angular build, about the
  build `deploy.yml` already does). Layer caching via the registry keeps the others to a
  minute or two.

**Alternatives considered**: build every image on the server from a checkout (the spec's
first draft): refused by FR-001, the server's free memory is far below an Angular
production build's. A private registry: needless, the code is public, and pulling would
need credentials on the server. GitHub's registry: possible, but the project's images are
already in the AWS public registry (the graph image).

## R2. The site as a container

**Decision**: `deploy/site/Dockerfile`, two stages. The first runs the build beta runs
(`npm ci`, the indices and content staging `deploy.yml` runs, the two libraries, then
`ng build reactome --configuration production,beta` into a stage-local folder, and the
embeddable diagram). The second is `node:24-slim` with production dependencies only,
`serve-prod.js`, `proxy.conf.js`, the scripts it requires, and the built folders,
started as `node projects/website-angular/src/scripts/serve-prod.js` with `DIST_DIR`
and `EMBED_DIST_DIR` set. Host network, port 4200, as the systemd service on beta binds.

- **Health**: `serve-prod.js` already answers `/health` with the bundle, its build time
  and the services it can reach (`HEALTH_CONTENT_NODE`, `HEALTH_RENDER`, `HEALTH_MCP`);
  the image's `HEALTHCHECK` asks it.
- **Which deployment the site is.** A build names its deployment
  (`projects/website-angular/src/config/environments.ts`, one row per deployment: its
  backend's origin, its analytics property, which optional features it shows). Beta's
  row is right for beta and wrong for the release server in small, real ways: beta's
  analytics property, beta's name as the fallback origin, DeltaSignal on. So:
  - a new row, `release`: the site's own origin (`host: 'origin'`), the release host as
    the fallback origin, no analytics property (the host is not indexed, and its traffic
    must not land in either property), DeltaSignal off (it is another session's feature,
    per deployment), the search answer and analysis summary as on beta (each answers 503
    and renders nothing where its key is absent);
  - **one image for both hosts**, chosen at run time: the site already honours
    `window.__APP_ENV` before the build's own name (`runtimeProfileName()`, written for
    pages that embed it). `serve-prod.js` writes that one line into the `index.html` it
    serves when `SITE_PROFILE` is set, and only a known profile name (an unknown one
    stops the server at start, as `getProfile` throws for an unknown build name).
    Unset, the page is unchanged, so beta's systemd service is not affected.
- **Other settings that differ per host** are already read at run time
  (`REACTOME_BACKEND`, `RENDER_TARGET`, the contact and search-answer settings from the
  mounted settings file), never baked.

**Alternatives considered for the deployment**: a second image built with
`--configuration production,release` (doubles the slow build in CI, and two images can
drift); serving beta's row on the release server (sends its visits to beta's analytics
property and turns on DeltaSignal where nobody asked for it).

- **Beta keeps its systemd service** until the image has run there a week; then beta moves
  to it too, so the two hosts run the same thing (a later task, not a requirement here).

**Alternatives considered**: install Node on the server (refused: D1 says the newer
services run in containers, and the spec requires no host runtime). Serve the built files
straight from nginx: loses `serve-prod.js`'s routes (the contact form, the search answer,
health, the proxy table for development parity).

## R3. The graph database's version

**Finding**: the release server's database is **Neo4j 4.3.6, the same version beta's graph
container runs** (read from the running beta container's kernel jar, 24 Nov 2026). Spec D4
said older; that was a misreading of the handoff, corrected in the spec. The content
service (neo4j-driver 6.2, `tools/content-node/graph.ts`) and the Java library have run
against 4.3.6 on beta every day since the graph moved into a container.

**Decision**: FR-006's check is kept, but it now tests the **data**, not the version: the
release server's graph is the next release's, loaded by its pipelines, and may differ from
beta's in content and in indexes. A spot check of at least 30 content endpoints (SC-003)
compares the server's answers with the same endpoints on beta when beta serves the same
release, or, before that, checks each answers 200 with the shape the contract names
(`tools/api-types/schema.spec.ts`'s checker, pointed at the server). Indexes the content
service relies on (`graph_query_traps`: the index on `DatabaseObject.stId`) are read back
from the server's database before the check.

**Alternatives considered**: a 4.3 compatibility matrix of the driver: unnecessary, the
version is the one in daily use.

## R4. nginx: the server's own configuration, and downloads

**Decision**:

- `release.conf` gains two includes of a folder mounted from the server, empty in the
  repository: `include /etc/nginx/site-local/*.conf;` at the top level (other virtual
  hosts: the wiki, the redirect host) and `include /etc/nginx/site-local/release/*.conf;`
  inside the release host's server block (the build service's path). A glob matching
  nothing is valid nginx, so a host with no folder mounted (CI's `test-config.sh`, a
  laptop) loads the configuration unchanged. The image creates both folders empty; the
  compose file mounts `${NGINX_SITE_LOCAL:-./deploy/nginx/site-local-empty}` read-only.
- `test-config.sh` runs `nginx -t` twice for `release`: with the folder empty, and with
  the documented examples (FR-007) mounted, so an example that stops loading is caught by
  CI.
- **`/download/`** (D5): a `location ^~ /download/` in `release.conf` answers a 302 to the
  download site, `current` replaced by the release the server stages
  (`/download/current/x` → `<download site>/<release>/x`; any other path kept). The release
  number comes from a one-line file in the server's own folder,
  `site-local/download-release.map` (`release.reactome.org 99;`), read by a `map` on the
  host name in `release.conf`; without the file, `current` is kept, so the link still
  works, to the released files. (First planned as an environment variable through the
  nginx image's template step; changed in T012: an unset variable there reaches nginx
  literally and refuses the whole configuration, and `test-config.sh`, which runs `nginx
-t` without the image's entry point, would never have seen the template.)
  The site's own page is `/download-data`, which this does not touch.
- **The wiki's scripting runtime**: the server has the old web server's in-process PHP and
  no FastCGI process manager. The example for the wiki uses `fastcgi_pass` to a PHP-FPM
  the user installs on the host (spec Assumptions); a PHP-FPM container is the alternative
  if the user prefers no host package. Documented, not decided here.
- **The build service's path**: the example sets the headers it needs to write public
  addresses (`Host`, `X-Forwarded-Proto`, `X-Forwarded-Port`), no buffering, long read
  timeouts for its long requests, and a body limit for uploads.

**Alternatives considered**: putting the server's blocks in the repository behind a
variable (refused by D7 and FR-011). Proxying `/download/` to the download site rather than
redirecting: costs the server's bandwidth for nothing.

## R5. Certificates without the old web server

**Finding**: every config already routes `/.well-known/acme-challenge/` to
`/var/www/certbot`, but **no compose file mounts that folder into the nginx container**,
so today a webroot challenge answered by the stack's nginx would 404. On beta it never
mattered: beta renews by DNS (`deploy/nginx/README.md`).

**Decision**: mount `${CERTBOT_WEBROOT:-./deploy/nginx/no-webroot}` read-only at
`/var/www/certbot`. The documentation gives each certificate's move off the old web
server's authenticator: to `webroot` with that folder (works for any name that reaches the
server directly), or to the DNS method beta uses where the name sits behind the CDN. A
test proves the mount: a file written in the webroot folder is served at the challenge
path through nginx, and is a 404 without the mount (constitution III).

## R6. Measuring memory

**Decision**: `docker stats --no-stream` every 5 s, per container, written with a time,
plus the host's `free` and the Tomcat and graph database processes' resident memory, over
three phases: at rest (30 min after start, after a crawl of 200 pages to warm caches), the
figures step on a sample (100 pathways) at the concurrency chosen in R7, and the book's
join on one large top-level pathway. Peak and mean per part. Beta's numbers (from the
handoff: about 2.4 GB without the graph, render up to 1.6 GB, the book about 6 GB) are
the baseline; the server's are what FR-010 records, in the server session's notes, not in
the repository (sizes of that server, FR-011). The repository records the method and
beta's numbers.

## R7. pdf-export's settings on that server

**Decision** (FR-009), for the release's PDF job:

- `RENDER_SERVICE=http://127.0.0.1:4310` (the render service's loopback port).
- `CONTENT_SERVICE=http://127.0.0.1:4400/ContentService` — the node content service
  directly, not through nginx: the job is on the same host, and nginx's per-client limits
  (64 connections, the rate zone) would throttle a bulk run.
- `RENDER_CONCURRENCY`: 2 at first, the compose default. pdf-export's measurements (spec
  001 research, T005) put a figure at 3.5–4.6 core-seconds in the render container and
  peak memory at 0.7 GB (1–2 at once) to 1.9 GB (8 at once); with little free memory, 2 is
  the safe start, raised after FR-010's measurement. The job's `--parallel` matches it.
- The render service reads the release's files locally: the server's override sets
  `RENDER_FILES` to the mounted release folder (spec 018), so no figure fetches from the
  download site or production.
- **Never while Tomcat is stopped**: the job takes the same lock as the steps that stop
  Tomcat (a lockable resource in the job service, configured by the release-server
  session); stated here as the requirement, set where the jobs live.
