# Quickstart: the stack beside the old web server, before cutover

For the session with access to the release server. Values in angle brackets are the
server's; none of them go into the repository.

## 1. Settings

1. A checkout of `main` (for the compose file, nginx examples and the guide; nothing is
   built from it except java-library and pdf-export).
2. `.env` with the keys in [contracts/server-settings.md](contracts/server-settings.md);
   `IMAGE_TAG=<the commit main names>`, `NGINX_ENV=release`, `SITE_PROFILE=release`,
   no `graph` in `COMPOSE_PROFILES`.
3. `docker-compose.override.yml` as in [contracts/compose-override.md](contracts/compose-override.md).
4. The site-local folder with the server's own blocks (contracts:
   [site-local-nginx.md](contracts/site-local-nginx.md)).
5. Check: `docker compose config --services` lists no `graphdb`; `docker compose config`
   shows `image: <registry>/...:<IMAGE_TAG>` and no `build:` for every published service.

## 2. Before switching, then the switch

Apache is turned off for good and nginx serves from then on; nginx needs 80 and 443, so
it starts once Apache stops. First everything behind it, with Apache still serving:

```sh
docker compose pull
docker compose build java-library pdf-export
docker compose up -d --scale nginx=0
```

Expected: every other container `Up`; the site's `/health` (loopback `:4200`) reports the
content service, render and its bundle; the content service (`:4400`) names the staged
release. Then the switch (the guide's §8): Apache stopped and disabled, `docker compose
up -d nginx`, and §3 on the public address.

## 3. Checks (SC-001)

Through `https://<release host>`, after the switch:

| Check                                                                  | Expected                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------- |
| `/`                                                                    | the new home page, naming the staged release          |
| a pathway, `/PathwayBrowser/#/R-HSA-...` (a real one, looked up first) | the diagram draws                                     |
| a search                                                               | results from the server's search index                |
| an analysis (the example data)                                         | results open                                          |
| `/download/current/<a real file>`                                      | 302 to the download site, the staged release's number |
| the build service's path                                               | its pages, a login, a long request                    |
| the chat                                                               | answers                                               |
| the wiki, and an upload at its present limit                           | both work                                             |
| an unknown host name                                                   | the stack's refusal                                   |
| `/ContentService/data/database/version`                                | the staged release                                    |

Then the endpoint spot check (SC-003): `node tools/release-check/endpoints.ts --base
http://127.0.0.1:4400` — at least 30 endpoints, each 200 with the contract's
shape, or listed with its reason.

## 4. PDF step (SC-005)

With `RENDER_SERVICE`, `CONTENT_SERVICE` and `RENDER_CONCURRENCY` as research R7 gives,
run pdf-export's figures step on a handful of pathways. Expected: their figures written;
no request leaves the server for production (the render service's log names only local
files).

## 5. Memory (SC-007)

Research R6's method, at rest, during the figures step, during one book part. Kept with
the server's notes, not in the repository.

## 6. Certificates (SC-004)

With the old web server stopped for a minute (or with each certificate moved to the
webroot first): `certbot renew --dry-run` for each. Expected: every one passes.

## Cutover (the user)

The switch in §2 is the cutover: Apache disabled, the renewals moved first (§6), §3 passed. The new setup is used going forward; Apache stays installed, disabled, for a while as a way back, and is removed eventually.
