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
Tomcat does. What this configuration changes is that connection handling becomes
a deliberate choice: see the note in `common/upstream-proxy.conf`, including why
the pool's keepalive must be shorter than the backend's.

## Before any of this serves traffic

**Certbot first, and proved.** On the dev box, `beta.reactome.org` and
`reactome.org` renew with `authenticator = apache`; stop Apache without migrating
them and renewal fails silently, with the certificate expiring 60-odd days later
and nothing to warn anyone.

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
