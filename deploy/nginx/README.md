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

On the dev box, what is _presented_ and what _exists_ are different things, and
the difference cost a detour worth recording:

| Name                  | Presents                          | Renewed by                          |
| --------------------- | --------------------------------- | ----------------------------------- |
| `beta.reactome.org`   | its Let's Encrypt certificate     | certbot, dns-cloudflare             |
| `dev.reactome.org`    | **Cloudflare Origin certificate** | Cloudflare; long-lived, not certbot |
| `reactome.org`, `www` | **Cloudflare Origin certificate** | as above                            |

Established by asking the running server what it serves for each name, not by
listing what is on disk. `001-reactome.conf` sets
`SSLCertificateFile /etc/ssl/cloudflare/reactome-origin.crt` with the Let's
Encrypt line commented out beneath it, so **only beta's Let's Encrypt certificate
is actually in use**.

`reactome.org`'s Let's Encrypt certificate was deleted on 2026-09-16: nothing
presented it, and it shared `dev.reactome.org` as a name with the certificate
below, which made combined renewals fight over the same
`_acme-challenge.dev.reactome.org` record and fail unpredictably.

**`dev.reactome.org`'s Let's Encrypt certificate is kept deliberately**, even
though nothing presents it today. The Angular site is expected to move from
`beta.reactome.org` to `dev.reactome.org` when it is ready, and the certificate
is there for that. It renews via `dns-cloudflare`; that renewal was silently
broken until the token was replaced on 2026-09-16.

When that move happens, the `dev.reactome.org` server block below stops being a
503 and becomes the site — at which point it needs a certificate a browser will
accept if anything reaches it other than through Cloudflare, which is what the
Let's Encrypt one is for.

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
