# nginx for reactome.org

Four environments, one set of shared routes. **None of this is in use yet** —
beta is still served by hand-configured Apache on the dev box. This exists so
the configuration is reviewable, diffable and rebuildable, and so the site can
eventually be started locally.

```
common/     what every environment shares
local.conf       your machine          compose service names, no TLS
dev.conf         beta.reactome.org     the development box
release.conf     release.reactome.org  the staged release
production.conf  reactome.org          the public site
```

## What differs, and why

|                                         | local         | dev     | release | production |
| --------------------------------------- | ------------- | ------- | ------- | ---------- |
| TLS                                     | no            | yes     | yes     | yes        |
| Real client IPs via Cloudflare          | no            | yes     | yes     | yes        |
| Named AI/SEO crawlers blocked           | no            | yes     | yes     | **yes**    |
| _Anything_ calling itself a bot blocked | no            | yes     | yes     | **NO**     |
| Tina admin                              | **reachable** | denied  | denied  | denied     |
| Rate limit                              | none          | 100 r/s | 100 r/s | 600 r/s    |
| Unknown hostnames                       | —             | 503     | 503     | 503        |

Two rows carry the whole risk of this arrangement.

**The blanket bot rule must never reach production.** It blocks Googlebot and
Bingbot along with everything else. Safe on a host that must not be indexed,
catastrophic on the one that must. It lives in `common/block-all-automation.conf`
and is included by `dev` and `release` only. Verified by test, not by reading:

```
dev         Googlebot → 403      GPTBot → 403
production  Googlebot → allowed  GPTBot → 403
```

**The admin rule is repeated in each environment rather than shared.** nginx
cannot choose an include by variable, and the workaround would have hidden the
one decision that must be obvious at a glance: whether a CMS editor is reachable
from the internet. It is reachable locally — editing content is the point of
running locally — and denied everywhere else.

## Verified

Against a running `nginx:alpine`, per environment:

```
/admin        → 403      /adminfoo    → passes through   (matches Apache)
/admin/cms    → 403      /administer  → passes through   (matches Apache)
GPTBot        → 403      CUBOT phone  → passes through
curl          → passes through        dev.reactome.org → 503
www.reactome.org → 301 to reactome.org
```

`/adminfoo` is in that list because the first draft blocked it: `location ^~
/admin` is a prefix match, while Apache's `LocationMatch "^/admin(/|$)"` is not.
Found by asking the running config rather than by reading it.

## Local is not runnable yet, and says so

`local.conf` expects compose services named `app`, `content-service`,
`deltasignal` and `chatbot`. **Only `app` exists** in `docker-compose.yml` today.
So this file is the shape of the answer, not the answer: starting the site
locally still needs those services defined.

DeltaSignal and the chatbot are resolved _per request_ rather than at startup,
through a variable and a resolver, so their absence gives a 502 on those two
routes instead of stopping nginx entirely. Named in an upstream block they would
be resolved at startup, and one missing service would refuse to start the whole
site — which is a poor welcome for someone who only wanted to look at a pathway.

`content-service` is deliberately **not** treated that way: a site with no content
service is not worth starting, and failing loudly is the right answer.

## Upstreams move; that is expected

`common/routes.conf` names `site`, `content`, `analysis`, `deltasignal` and
`chatbot`. Each environment defines them. Two changes are coming and this shape
absorbs both: node in this repository taking over most of what Tomcat serves, and
the site being startable locally, where they become compose service names.

`/api/` for DeltaSignal exists in none of the Apache configuration, which is why
DeltaSignal cannot work on beta today — the Angular side calls it as a bare
relative path, routed only by the dev server's proxy, which does not exist in a
built artifact. Note the port on the dev box: **8090**, not the 8080 DeltaSignal's
own compose binds, because 8080 there is Tomcat.

## Connections, which is a reason this is worth doing

Measured on the dev box, sockets to Tomcat's 8080:

```
76 CLOSE-WAIT      19 ESTABLISHED
```

Four in five connections leaked. Whether Apache or Tomcat is at fault is not
settled and does not need to be — the pairing produces it, and it goes when
Tomcat does.

What this configuration changes is that connection handling is chosen rather than
inherited: every upstream sets `keepalive`, with `keepalive_timeout 10s` — shorter
than Tomcat's 20s default, so the backend never closes a pooled socket first.

That pairing is not optional. `proxy_http_version 1.1` with `Connection ""` and
**no** `keepalive` tells the backend to hold the socket open while nginx has no
pool to keep it in, which is a way of causing this pile rather than curing it. An
earlier draft of these files did exactly that — described the pooling and
configured none of it — and it was caught by reviewing the configuration against
its own comments.

## Certificates: only the servers have them

`local.conf` is plain HTTP on port 80 and touches no certificate at all —
verified, it starts with nothing mounted at `/etc/letsencrypt`. Running the site
on your own machine should not require obtaining a certificate for a hostname you
do not own.

Deployed environments present certificates the server already holds. This box
needs exactly two:

|                     |                                                             |
| ------------------- | ----------------------------------------------------------- |
| `beta.reactome.org` | the site                                                    |
| `dev.reactome.org`  | the retired host, so its 503 is not a TLS error             |
| `reactome.org`      | the same, for the two aliases the retired vhost answers for |

The wikis lived here as leftovers and were deleted on 2026-09-16, along with the
long-expired `login.dev`.

The third is easy to talk yourself out of. Production serves `reactome.org`, so
it is tempting to drop the certificate — but this box still _answers_ for that
name and for `www`, because the retired vhost lists them as aliases. Drop the
certificate and those names get beta's instead: a name mismatch, so a browser
security warning where there is currently a clean 503. A worse retirement than
the one being replaced.

So all three certificates must renew without Apache before the cutover, not two.
`reactome.org` was still on the apache authenticator after the first migration
pass — worth checking rather than assuming, since the script only moves what it
is told to.

## Before any of this serves traffic

**Certbot first, and proved.** Renewal is already automated — `certbot.timer`
twice daily and a `/etc/cron.d/certbot` besides, both running `certbot -q renew`.
That is the risk rather than the reassurance: `renew` uses each certificate's
_stored_ authenticator, and `beta.reactome.org` still stores
`authenticator = apache`. The day Apache stops, that renewal begins failing, and
`-q` means it fails without saying anything. The certificate expires 60-odd days
later.

Only beta needs moving: `dev.reactome.org` already renews via `dns-cloudflare`,
which is the same path, already working on this machine.

The safe path is already proven on that box: `dev.reactome.org` renews via
`dns-cloudflare`, and `python3-certbot-dns-cloudflare` is installed.
`python3-certbot-nginx` is **not** — which is why `common/tls.conf` writes the TLS
settings out rather than including `/etc/letsencrypt/options-ssl-nginx.conf`, a
file that does not exist here. A missing include stops nginx from starting, and a
cutover is the worst moment to learn that.

```
certbot renew --cert-name beta.reactome.org --dry-run    # must pass first
```

Then: ports 80 and 443 handed over atomically, with a one-command rollback, and
**not during a curator review cycle** — beta is the QA gate.

## What is deliberately absent

No `docker-compose` service. Adding one would invite `docker compose up` to take
port 443 from Apache on a box where that is the live site. It belongs in the same
change as the cutover.
