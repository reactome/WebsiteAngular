# Implementation Plan: The release server runs the site's stack

**Branch**: `spec032/release-server` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/032-release-server/spec.md`

## Summary

The release server runs this repository's stack from `main`, as beta does, with its
nginx on the public ports and its old web server retired. The repository provides: images
published by CI for the server to pull (the Java library and pdf-export built there
instead), a production container for the site so the server needs no host Node, a
`release` deployment row chosen at run time, the nginx hooks for the server's own
configuration (an empty, mounted `site-local` folder) with documented examples, `/download/`
redirected to the download site, the certificate webroot actually mounted, the PDF job's
settings, and the measurement method for memory. The server session does the rest (spec
Assumptions). Research: [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript on Node 24 (site build, `serve-prod.js`, content-node, render); nginx (alpine image); GitHub Actions YAML; Dockerfiles

**Primary Dependencies**: Angular (production build), Express (`serve-prod.js`), neo4j-driver 6.2 (content-node), Docker Compose v2+, the AWS public registry

**Storage**: none new. The host's Neo4j 4.3.6 (same version as beta's, R3); the release's files folder, mounted read-only

**Testing**: `deploy/nginx/test-config.sh` (`nginx -t` per deployment, extended to the site-local examples), unit tests beside `serve-prod.js` for the profile line, `tools/workflows.spec.ts` for the new workflow, an image smoke test in CI (the site image answers `/health` and `/`), the SC-003 endpoint spot check script

**Target Platform**: a Linux server with Docker and Compose, Tomcat and Solr on the host

**Project Type**: deployment of an existing web application

**Performance Goals**: none new; the site behaves as on beta

**Constraints**: the server's free memory is small (the reason for FR-001 and FR-010); nothing server-specific in the repository (FR-011); one commit's images at a time

**Scale/Scope**: about 8 images, 1 new workflow, 1 new Dockerfile, 1 new profile row, nginx changes in `release.conf`, compose changes, documentation

## Constitution Check

| Principle                     | How this plan meets it                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I. Verify the instrument      | The graph version was read from the running container, not taken from the handoff (R3 corrected D4). The memory method names what each number measures (R6); the endpoint check reads back the indexes before comparing.                                                 |
| II. Measure in the thing      | Memory measured on the server, under the figures step and the book, not estimated (FR-010). Image pulls checked by digest against the commit (SC-002).                                                                                                                   |
| III. Prove a test fails       | Each new check is seen failing first: the webroot test without the mount (R5), `nginx -t` with a broken example, the profile line with an unknown name, the workflow spec with a publish step that runs on a red commit, the image smoke test with a missing `DIST_DIR`. |
| IV. Stable identifiers        | Not touched: no reader-facing identifiers change. `/download/current/...` resolves to a release number.                                                                                                                                                                  |
| V. Comments carry the failure | The compose and nginx comments say what goes wrong without each line (the empty webroot, a mixed-commit pull, a site-local folder missing).                                                                                                                              |
| Public repository             | Server hosts, paths, sizes and credentials stay on the server (FR-011); examples use placeholders; SC-006 is a search for them.                                                                                                                                          |

Gate: passes. No violation to justify.

## Project Structure

### Documentation (this feature)

```text
specs/032-release-server/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R7
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── server-settings.md     # the settings file's keys, names only
│   ├── compose-override.md    # the override's shape for a server like this
│   └── site-local-nginx.md    # the site-local folder's contract and examples
└── checklists/requirements.md
```

### Source Code (repository root)

```text
.github/workflows/publish-images.yml     # new (R1)
deploy/site/Dockerfile                   # new (R2)
deploy/nginx/
├── Dockerfile                           # creates /etc/nginx/site-local{,/release}; templates step (R4)
├── release.conf                         # two site-local includes, /download/ redirect
├── test-config.sh                       # release twice: empty folder, examples mounted
├── site-local-empty/                    # what a host with no folder mounts
├── site-local-examples/                 # build-service path, wiki with PHP-FPM, redirect host (placeholders)
└── no-webroot/                          # default certbot webroot (R5)
deploy/release-server/README.md          # how a server like this runs the stack: settings, override, pull, cutover checks
docker-compose.yml                       # image: per published service; webroot + site-local mounts; graphdb under a profile
projects/website-angular/src/config/environments.ts   # `release` row
projects/website-angular/src/scripts/serve-prod.js    # SITE_PROFILE → window.__APP_ENV
tools/release-check/endpoints.ts         # SC-003 spot check (30+ endpoints)
```

**Structure Decision**: deployment files live under `deploy/`, as every service's do; the
release server's guide joins them as `deploy/release-server/README.md`. No new service
code.

### The graph container on a host that has its own

The compose file starts `graphdb` with everything else, and the release server must not
(D4). `graphdb` moves under a compose profile, `graph`, and beta's `.env` names it
(`COMPOSE_PROFILES=graph`); the release server leaves it out. The change to beta's `.env`
is made in the same deploy as the compose change, or beta's graph would not start: the
task says so and checks it.

## Order of work

1. **Compose and nginx groundwork** (no behaviour change on beta): `graphdb` under a
   profile with beta's `.env` set first; the webroot and site-local mounts with empty
   defaults; `test-config.sh` extended. Proven on beta: same containers after deploy.
2. **The site's image and the `release` row** (R2): Dockerfile, `/health` smoke test in
   CI, `SITE_PROFILE` in `serve-prod.js` with its tests.
3. **Publishing** (R1): the workflow, the `image:` lines, the registry's repositories and
   role (created by the server session; the workflow is merged disabled until they exist).
4. **nginx for the server** (R4): `/download/` redirect, the examples, the guide.
5. **Certificates** (R5): the mount's test; the guide's renewal steps.
6. **The server session's turn**: bring up beside the old web server, SC-001, SC-003
   (the endpoint check, run there), SC-004, SC-005, SC-007 measurements, the PDF job's
   settings (R7). Their results come back as task ticks with the numbers kept on the
   server.

## Complexity Tracking

None.
