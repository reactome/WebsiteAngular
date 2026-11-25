# Running the stack on a server with its own graph database

How a server like the release server (`release.reactome.org`) runs this repository's
stack from `main`: the site and the newer services in containers, Tomcat and Solr on the
host, the host's own graph database, and this stack's nginx on the public ports. The
decisions, requirements and the reasons are in
[`specs/032-release-server`](../../specs/032-release-server/spec.md); this is the how.

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

Until images are published (spec 032 T009–T011), the server builds the small ones itself
(`docker compose build content-node render analysis-gateway mcp nginx`); the site's image
needs more memory than the server has free, so it is built elsewhere from the same commit
and loaded (`docker save` there, `docker load` here).

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
LETSENCRYPT_DIR=/etc/letsencrypt
CERTBOT_WEBROOT=<a folder certbot writes challenges to>
NGINX_SITE_LOCAL=<the server's own nginx folder>
```

The credentials file holds `NEO4J_URI` (the host's database, `bolt://127.0.0.1:7687`),
`NEO4J_DATABASE`, `NEO4J_USER` and `NEO4J_PASSWORD`, read literally, as on beta.

**`docker-compose.override.yml`** — as in
[`contracts/compose-override.md`](../../specs/032-release-server/contracts/compose-override.md):
the `app` service becomes the published site image.

**The site-local folder** (`NGINX_SITE_LOCAL`): the server's own nginx configuration,
copied from [`deploy/nginx/site-local-examples`](../nginx/site-local-examples) and filled
in — the build service's path (`release/`), the other host names (top level), and
`download-release.map`, one line naming the release `/download/current/` goes to. The
contract is
[`contracts/site-local-nginx.md`](../../specs/032-release-server/contracts/site-local-nginx.md).

Check before starting anything:

```sh
docker compose config --services     # no graphdb
docker compose config | grep -E '^\s+(image|build):'   # every published service: image at IMAGE_TAG
```

## 2. Before switching: everything behind nginx, with Apache still serving

The plan is to turn Apache off for good and serve through this stack's nginx from then
on. nginx takes ports 80 and 443, so it starts only once Apache stops (§8). Everything
behind it can be checked first, with no downtime:

```sh
docker compose pull
docker compose build java-library pdf-export
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

The graph, through the content service (SC-003):

```sh
node tools/release-check/endpoints.ts --base http://127.0.0.1:4400
# and, once beta serves the same release:
node tools/release-check/endpoints.ts --base http://127.0.0.1:4400 --compare https://beta.reactome.org
```

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
through the old web server begins failing, silently, the day that server stops. Move each
first:

- **A name that reaches this server directly**: to `webroot`, in the folder nginx serves
  the challenge path from:

  ```sh
  certbot certonly --webroot -w <CERTBOT_WEBROOT> --cert-name <name> -d <name> --keep-until-expiring
  ```

- **A name behind the CDN**: to the DNS method beta uses (`deploy/nginx/README.md`).

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

1. Move each certificate's renewal off Apache (§6), so none fails once it stops.
2. Stop and disable Apache: `systemctl disable --now apache2`.
3. Start nginx: `docker compose up -d nginx`.
4. Run §3's checks on the public address.

From then on nginx serves. Apache stays installed but disabled; if something is badly
wrong straight after the switch, `docker compose stop nginx` and
`systemctl start apache2` put the old site back while it is fixed. Once the new setup
has run through a release, Apache can be removed.
