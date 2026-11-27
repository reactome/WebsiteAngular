# Running the stack on a server with its own graph database

How a server like the release server (`release.reactome.org`) runs this repository's
stack from `main`: the site and the newer services in containers, Tomcat and Solr on the
host, the host's own graph database, and this stack's nginx on the public ports. The
decisions, requirements and the reasons are in
[`specs/032-release-server`](../../specs/032-release-server/spec.md); this is the how.
reactome.org runs the same stack, at a release's tag and with the stack's own graph
database container: §9 says how it differs.

Everything below in angle brackets is the server's, and stays on the server: host names
beyond the public release address, paths, ports of its other services, sizes and
credentials never go into this repository.

## What runs where

| Part                                                       | Where                       | From                                            |
| ---------------------------------------------------------- | --------------------------- | ----------------------------------------------- |
| the site (`serve-prod.js`)                                 | container, loopback `:4200` | the published `site` image (`deploy/site`)      |
| content-node, render, analysis gateway, MCP                | containers                  | published images                                |
| nginx                                                      | container, ports 80 and 443 | the published `nginx-release` image             |
| java-library, pdf-export                                   | containers                  | built on the server (never published, R1)       |
| Tomcat (AnalysisService, the content routes still in Java) | host                        | as today                                        |
| Solr, the graph database                                   | host                        | as today; the stack's `graphdb` is not started  |
| the server's other sites, its build service                | host                        | as today; nginx reaches them through site-local |

The server never builds a published image: its override resets their `build:` and names
each at `${REGISTRY}` and `${IMAGE_TAG}`, a commit id (§1; on production a release's
tag, §9). An image missing from the
registry makes `docker compose pull` and `up` fail, and nothing is built in its place
under the registry's name; the fix is to publish it (spec 032 T009, T010), not to build
it here. The server builds only java-library and pdf-export. This needs Docker Compose
2.24 or later (`docker compose version`), for the override's `!reset`.

## 1. Settings, kept on the server

In the checkout's root, beside `docker-compose.yml`; both are gitignored, so a pull never
touches them:

**`.env`** — the keys are listed in
[`contracts/server-settings.md`](../../specs/032-release-server/contracts/server-settings.md).
A server like this one:

```sh
REGISTRY=<registry>
IMAGE_TAG=<full commit id of main>     # never `main`: one commit's images, never a mix
# No COMPOSE_PROFILES=graph: the host's own graph database serves.
NGINX_ENV=release
SITE_PROFILE=release
CONTENT_NODE_ENV_FILE=<path to the graph credentials file, mode 0600>
CONTENT_NODE_UID=<its owner's uid>
CONTENT_NODE_GID=<its owner's gid>
DIAGRAM_FILES_DIR=<the staged release's folder>/diagram
RELEASE_FILES_DIR=<the staged release's folder>
RENDER_FILES_DIR=<the folder holding the release folders>   # <it>/<release>/diagram/...
RENDER_CONCURRENCY=2
# RENDER_MEM_LIMIT=3g                 # raise with RENDER_CONCURRENCY, by measurement (§5)
ANSWER_ENV_FILE=<the site's settings file, mode 0600>
CALLER_TOKEN_KEY_FILE=<the key the site signs its calls to the chat with>
LETSENCRYPT_DIR=/etc/letsencrypt
CERTBOT_WEBROOT=<a folder certbot writes challenges to>
NGINX_SITE_LOCAL=<the server's own nginx folder>
```

The credentials file holds `NEO4J_URI` (the host's database, `bolt://127.0.0.1:7687`),
`NEO4J_DATABASE`, `NEO4J_USER` and `NEO4J_PASSWORD`, read literally, as on beta.

The site's settings file (`ANSWER_ENV_FILE`) holds what beta's site service reads from
its own: the human check's keys, the identity secret (which the analysis gateway reads
too: without it no report is made), and the chat's addresses, set to this server's own
chat, never to another deployment's (unset, they name beta's). The gateway does not start
without the file. The contact form's settings are there too: `CONTACT_TO`, `CONTACT_FROM`
and `CONTACT_SES_REGION`. The site image has no `sendmail`, so the form sends through
Amazon SES's API in that region, signed by the instance's role (spec 032 T031): the role
needs both `ses:SendEmail` and `ses:SendRawEmail` (the form sends a raw message, which SES
authorizes as the latter), allowed for `CONTACT_FROM`'s address, and that address's domain must
be a verified SES identity in the region. Leave `CONTACT_TO` unset and the form says it
cannot send.

**`docker-compose.override.yml`** — as in
[`contracts/compose-override.md`](../../specs/032-release-server/contracts/compose-override.md):
the `app` service becomes the published site image, and every published service (`app`,
content-node, render, analysis-gateway, mcp, nginx) loses its `build:` and names its image
with `${REGISTRY:?…}` and `${IMAGE_TAG:?…}`, so a setting missing from `.env` stops
`docker compose` with its name rather than falling back to the base file's
`registry.invalid` and `main`.

**The site-local folder** (`NGINX_SITE_LOCAL`): the server's own nginx configuration,
copied from [`deploy/nginx/site-local-examples`](../nginx/site-local-examples) and filled
in — the build service's path (`release/`), the other host names (top level), and
`download-release.map`, one line naming the release `/download/current/` goes to. The
contract is
[`contracts/site-local-nginx.md`](../../specs/032-release-server/contracts/site-local-nginx.md).

Check before starting anything:

```sh
! docker compose config --services | grep -x graphdb &&
  config=$(docker compose config app content-node render analysis-gateway mcp nginx) &&
  ! printf '%s\n' "$config" | grep -E '^ +build:' &&
  ! printf '%s\n' "$config" | grep -E '^ +image:' | grep -vE ':([0-9a-f]{40}|Release[0-9]+)$' &&
  echo 'published images: pulled at a commit or a release, none built'
docker compose config app             # the site: SITE_PROFILE, NODE_ENV=production, no dev ports
```

The first command prints `graphdb` if it would start, any `build:` left on a published
service, and any published image whose tag is neither a full commit id nor a release's
tag (`Release` and its number, production's: §9), and then fails,
exiting non-zero; with `REGISTRY`, `IMAGE_TAG` or `NGINX_ENV` missing, `docker compose
config` itself refuses, naming it. Go on only once it prints its last line.

## 2. Before switching: everything behind nginx, with Apache still serving

The plan is to turn Apache off for good and serve through this stack's nginx from then
on. nginx takes ports 80 and 443, so it starts only once Apache stops (§8). Everything
behind it can be checked first, with no downtime:

```sh
docker compose pull &&
  docker compose build java-library pdf-export &&
  docker compose up -d --scale nginx=0
curl -s 127.0.0.1:4200/health                                  # the site: its bundle, its services
curl -s 127.0.0.1:4200/ | grep -c '__APP_ENV="release"'        # 1: the release deployment
curl -s 127.0.0.1:4400/ContentService/data/database/version    # the staged release
```

and the graph check (§3).

## 3. Checks

Through `https://release.reactome.org`, as
[`quickstart.md`](../../specs/032-release-server/quickstart.md) §3 lists them: the home page, a pathway, a search, an analysis, a download link, the
build service, the chat, the wiki, an unknown host name, and the database version.

The graph, through the content service (SC-003). The check is this repository's own
script, which needs Node 24 and its packages; the server has neither, by design, so it is
run from a checkout elsewhere, through a tunnel to the server's loopback port:

```sh
ssh -N -L 4400:127.0.0.1:4400 <the server> &      # on the machine with the checkout
node tools/release-check/endpoints.ts --base http://127.0.0.1:4400
# and, once beta serves the same release:
node tools/release-check/endpoints.ts --base http://127.0.0.1:4400 --compare https://beta.reactome.org
```

Each answer is checked for its status and a body, and against its shape where the
contract's description has one; the last line says how many were (`~` marks the rest).

The indexes the content service relies on, read back from the host's database by its
operator (read-only), before the check: `SHOW INDEXES` in `cypher-shell`; the index on
`DatabaseObject.stId` and `DatabaseObject.dbId` must be online.

## 4. The release's PDF job

pdf-export's figures step and book (its spec 001) run as the release's job, on this
server, against this stack:

| Setting              | Value                                    | Why                                                                                           |
| -------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| `RENDER_SERVICE`     | `http://127.0.0.1:4310`                  | the render service's loopback port                                                            |
| `CONTENT_SERVICE`    | `http://127.0.0.1:4400/ContentService`   | the content service directly: through nginx, its per-client limits would throttle a bulk run  |
| `RENDER_CONCURRENCY` | 2 to start; the job's `--parallel` alike | a figure costs 3.5–4.6 core-seconds and up to 1.9 GB at 8 at once (pdf-export spec 001, T005) |

Raise the concurrency only from the memory measured (below). The render service reads the
staged release's files from `RENDER_FILES_DIR`, so no figure is fetched from the download
site or production.

**The PDF job never runs while a release step has stopped Tomcat**: the analysis service
and the content routes still in Java would fail under it. One lock, shared by the steps
that stop Tomcat and by the PDF job, configured where the jobs are kept.

## 5. Memory

Measured on the server, not here (its sizes are the server's): `docker stats --no-stream`
every 5 s per container, the host's `free`, and Tomcat's and the graph database's resident
memory, at rest (after a crawl of 200 pages), during the figures step on 100 pathways, and
during one part of the book. For comparison, on beta: the stack without the graph about
2.4 GB, the render service up to 1.6 GB, the book about 6 GB.

## 6. Certificates without the old web server

`certbot renew` uses each certificate's stored authenticator. A certificate that renews
through the old web server begins failing, silently, the day that server stops. So each is
moved to another, once nginx is serving the challenge path (§8):

- **A name that reaches this server directly**: to `webroot`, in the folder nginx serves
  the challenge path from. `reconfigure` rewrites the stored authenticator and tests a
  renewal with it (certbot 2.3 or later):

  ```sh
  certbot reconfigure --cert-name <name> --webroot -w <CERTBOT_WEBROOT>
  ```

  Not `certonly ... --keep-until-expiring`: on a certificate not yet due it does nothing,
  and leaves the old authenticator stored. With an older certbot, renew once with
  `certbot certonly --webroot -w <CERTBOT_WEBROOT> --cert-name <name> -d <name>
--force-renewal`, which stores the new one.

- **A name behind the CDN**: to the DNS method beta uses (`deploy/nginx/README.md`).
  That does not need nginx, and can be moved before the switch.

Then, so nginx presents a renewed certificate, a deploy hook:
`/etc/letsencrypt/renewal-hooks/deploy/nginx-reload` running
`docker compose -f <checkout>/docker-compose.yml exec -T nginx nginx -s reload`.

Check each, with the old web server stopped (SC-004):

```sh
certbot renew --cert-name <name> --dry-run
```

## 7. Updating

```sh
git -C <checkout> pull --ff-only
# IMAGE_TAG=<the new commit> in .env
docker compose pull && docker compose build java-library pdf-export && docker compose up -d
```

A failed pull or build leaves the running containers as they were: `up -d` is run only
after both succeed, and never `down` first.

At a release: point `DIAGRAM_FILES_DIR` and `RELEASE_FILES_DIR` at the new release's
folder, change `download-release.map`, and `docker compose up -d` (and `docker compose
exec nginx nginx -s reload` for the map).

## 8. Switching over (the user)

1. Check no certificate falls due in the next few days (`certbot certificates`), and move
   those behind the CDN to the DNS method (§6).
2. Stop and disable Apache: `systemctl disable --now apache2`.
3. Start nginx: `docker compose up -d nginx`. It serves the challenge path from
   `CERTBOT_WEBROOT` from now on.
4. Move each remaining certificate to `webroot` and dry-run each (§6), and add the deploy
   hook.
5. Run §3's checks on the public address.

From then on nginx serves, and the new setup is the one used going forward. Apache stays
installed but disabled for a while: if something is badly wrong after the switch,
`docker compose stop nginx` and `systemctl start apache2` put the old site back while it
is fixed. It is removed eventually, once the new setup has proven itself.

## 9. Production (reactome.org)

reactome.org runs this same stack: the published images, the same override, this stack's
nginx. It differs from the release server in three ways: it runs a release's images, not
a commit's; its nginx and site are production's; and it runs the stack's own graph
database container in place of the host's, from the next release on.

**The release's tag.** On release day every published image gets a write-once tag
`Release<NN>` (`Release99`, say), the same name as the graph image's, and the commit gets
a git tag of the same name; the release-tag workflow (spec 032 T036, to come) makes both, and
refuses a tag that already exists. So production's `IMAGE_TAG` names one release, never
`main` and never a commit id, and that tag never moves.

**`.env`**: as §1, except:

```sh
IMAGE_TAG=Release<NN>                 # the release production serves; never `main`
COMPOSE_PROFILES=graph                # the stack's own graph database (below)
NGINX_ENV=production
SITE_PROFILE=production
DIAGRAM_FILES_DIR=<release NN's folder>/diagram
RELEASE_FILES_DIR=<release NN's folder>
RENDER_FILES_DIR=<the folder holding the release folders>
```

Unchanged: `REGISTRY`, the override, the credentials file and its owner
(`CONTENT_NODE_ENV_FILE`, `CONTENT_NODE_UID`, `CONTENT_NODE_GID`), the site's settings file
(`ANSWER_ENV_FILE`, with the contact form's keys; the production profile offers no search
answer, summary or chat handoff), `CALLER_TOKEN_KEY_FILE`, `LETSENCRYPT_DIR`,
`CERTBOT_WEBROOT`, and the render settings. `production.conf` includes no site-local
folder, so `NGINX_SITE_LOCAL` is not read there.

**The graph.** `graphdb` is the project's published graph image for the release that
`docker-compose.yml` names, made read-only and built here, like java-library: its image
(`reactome/graphdb_readonly:Release<NN>`) is never pulled from or pushed to a registry. So
the checkout is at the same git tag as the images, and its compose file names the same
release. The container serves on the host's loopback port 7687, where the host's database
served, so the credentials file is unchanged: `NEO4J_URI` stays `bolt://127.0.0.1:7687`,
and the container takes its user and password from the same file. It is moved, from the
host's database the first time and from one release to the next after that, by
[`deploy/graphdb/next-release.sh`](../graphdb/next-release.sh), as on beta: `check`,
`switch`, `rollback`, then `cleanup` once the release is checked. Run under `sudo`, it sets
the credentials file's path itself, to `~/.content-node.env` in the home of the user who
ran it, and that wins over `.env`'s: so give it the path, as below. It names the containers
`websiteangular-…`, the project's name when the checkout's folder is `WebsiteAngular`.

Because `graphdb` has a build and no published image, a plain `docker compose pull` fails
on it here: pull with `--ignore-buildable`, which still pulls every published image (their
builds are reset) and leaves graphdb, java-library and pdf-export to be built.

Check before starting anything: §1's check, with the graph expected to start:

```sh
docker compose config --services | grep -x graphdb &&
  config=$(docker compose config app content-node render analysis-gateway mcp nginx) &&
  ! printf '%s\n' "$config" | grep -E '^ +build:' &&
  ! printf '%s\n' "$config" | grep -E '^ +image:' | grep -vE ':([0-9a-f]{40}|Release[0-9]+)$' &&
  echo 'published images: pulled at a commit or a release, none built; the graph starts here'
docker compose config graphdb | grep -E '^ +image:'   # Release<NN>: the same NN as IMAGE_TAG
```

and, once the site runs (§2's checks, with production's name):

```sh
curl -s 127.0.0.1:4200/ | grep -c '__APP_ENV="production"'     # 1: the production deployment
curl -s 127.0.0.1:4400/ContentService/data/database/version     # NN, once the graph is switched
```

**The first start**, with whatever serves reactome.org today still serving:

```sh
docker compose pull --ignore-buildable &&
  docker compose build java-library pdf-export &&
  docker compose up -d app content-node render analysis-gateway mcp java-library pdf-export
sudo env CONTENT_NODE_ENV_FILE=<the credentials file> bash deploy/graphdb/next-release.sh switch
```

The services are named so `up` neither builds nor starts the graph: `switch` builds it,
fills its volume while the host's database still serves, then stops and disables the
host's database and starts the container. nginx starts last, at the switch over (§8's
steps, with production's certificate and names).

**At a release**, once the release-tag workflow has tagged it:

```sh
git -C <checkout> fetch --tags && git -C <checkout> checkout Release<NN>
# in .env: IMAGE_TAG=Release<NN>; DIAGRAM_FILES_DIR and RELEASE_FILES_DIR at release NN's folder
docker compose pull --ignore-buildable && docker compose build java-library pdf-export &&
  sudo env CONTENT_NODE_ENV_FILE=<the credentials file> bash deploy/graphdb/next-release.sh switch &&
  docker compose up -d
```

then the two steps `switch` prints at its end (the edge cache's purge and its warming).
Never `down` first: a failed pull or build leaves everything as it was, and a failed switch
goes back to the graph that served before by itself.

**Rolling back** is the previous release's tag: the images under it are the ones that
served, since a release's tag never moves.

```sh
sudo env CONTENT_NODE_ENV_FILE=<the credentials file> bash deploy/graphdb/next-release.sh rollback
git -C <checkout> checkout Release<NN-1>
# in .env: IMAGE_TAG=Release<NN-1>, and the previous release's folders
docker compose pull --ignore-buildable && docker compose up -d
```

The graph goes back only until `next-release.sh cleanup` has removed the previous
release's image and volume; run `cleanup` once the new release has been checked.
