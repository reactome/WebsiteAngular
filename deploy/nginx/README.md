# beta.reactome.org under nginx

`beta.conf` is beta's live Apache configuration, written as nginx. **It is not in
use.** beta is served by Apache configured by hand on the dev box; this exists so
that configuration is reviewable, diffable and rebuildable, which is the point of
issue #203.

## What it covers

Read off the box on 2026-09-16 and reproduced here:

| Route                | Goes to          | Note                                                                   |
| -------------------- | ---------------- | ---------------------------------------------------------------------- |
| `/admin`, `/admin/…` | denied           | the Tina CMS editor must never be publicly reachable                   |
| `/ContentService/`   | `127.0.0.1:8080` | beta's **own** Tomcat, which serves endpoints the public host does not |
| `/AnalysisService/`  | `127.0.0.1:8080` | as above                                                               |
| `/chat/`             | `127.0.0.1:8000` | server-sent events: needs buffering off, not just the upgrade headers  |
| `/chat`              | `302 → /chat/`   |                                                                        |
| `/`                  | `127.0.0.1:4200` | the built site, via `serve-prod.js`                                    |
| bot blocking         | 403              | translated from `deploy/apache/beta-bot-blocks.conf`                   |

Plus one route Apache does not have:

| `/api/` | `127.0.0.1:8090` | DeltaSignal |

That absence is why DeltaSignal cannot work on beta today. The Angular side calls
`/api/pathways`, `/api/parse` and `/api/solve` as bare relative paths, routed only
by `proxy.conf.js` — the **dev server's** proxy, which does not exist in a built
artifact. Note the port: DeltaSignal's own compose binds 8080, which on this box
is Tomcat, so an unconfigured deployment sends these calls to Tomcat and gets 404s
from a real server rather than a clear failure.

## Verified

Syntax, and the decisions that do not need an upstream, against `nginx:alpine`:

```
/admin        → 403      /adminfoo    → passes through   (matches Apache)
/admin/cms    → 403      /administer  → passes through   (matches Apache)
GPTBot        → 403      CUBOT phone  → passes through
generic bot   → 403      curl         → passes through
/chat         → 302 /chat/
```

`/adminfoo` is in that list because the first draft blocked it: `location ^~
/admin` is a prefix match, while Apache's `LocationMatch "^/admin(/|$)"` is not.
Found by asking the running config rather than by reading it.

## Before any of this serves real traffic

**Certbot first, and prove it.** It is configured with `authenticator = apache`
and `installer = apache`. Swap the proxy without migrating that and renewal
silently stops — beta loses HTTPS within 90 days with nothing to warn anyone.
There is already a `dns-cloudflare` authenticator on the box for another
certificate, which does not care which web server is running.

```
certbot renew --dry-run          # must pass on the new authenticator, first
```

Then, in order:

1. Migrate certbot to `dns-cloudflare` and prove renewal with a dry run.
2. Generate the Cloudflare IP ranges file the config references, and uncomment
   the include. Without it every client IP in the logs is Cloudflare's.
3. Account for `001-reactome.conf`, the third vhost. It has to be understood, not
   assumed idle.
4. Move ports 80 and 443 atomically. Apache and the container cannot both hold
   them, and beta is down in between.

**Not during a curator review cycle.** beta is the QA gate; a proxy swap is not
something to do while people are testing against it.

## What is deliberately not here

No `docker-compose` service yet. Adding one would invite `docker compose up` to
take port 443 from Apache on a box where that is the live site. The compose entry
belongs in the same change as the cutover, with the certbot work done.
