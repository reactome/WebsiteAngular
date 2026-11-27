# Contract: the site-local nginx folder

## Where it is included

`release.conf` (and only it) includes, from the folder mounted at `/etc/nginx/site-local`:

| Glob                                   | Context                                                    | For                                                     |
| -------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| `/etc/nginx/site-local/*.conf`         | http (top level of `release.conf`)                         | whole `server` blocks for the server's other host names |
| `/etc/nginx/site-local/release/*.conf` | inside the release host's `server { listen 443 ssl; ... }` | `location` blocks on the release host                   |

An empty folder, or none mounted, is valid: the image creates both folders, and a glob
that matches nothing loads nothing.

One file there is not configuration but a value: `download-release.map`, one line,
`<host> <release>;`, the release `/download/current/` means on this host. Moved with each
release. Read by `release.conf` (`release.reactome.org <release>;`, which redirects there;
without it, `current`), and by `production.conf` and `dev.conf` (`reactome.org <release>;`
and `beta.reactome.org <release>;`, which proxy there; without it, or with anything but a
number, 503), which read nothing else from the folder (T037).

## What a file there may rely on

- The certificates under `/etc/letsencrypt` (mounted) and `/etc/nginx/common/tls.conf`.
- `include /etc/nginx/common/upstream-proxy.conf;` for proxy headers, as the repository's
  routes use.
- `host.docker.internal` is not needed: nginx shares the host's network; services on the
  host are on `127.0.0.1`.

## What it must not do

- Redefine a `location` the repository's routes define. A duplicate prefix or exact
  location is refused by `nginx -t` before the reload, so the running server keeps
  serving; a duplicate regular-expression location is **not** refused: it loads and is
  never reached, because the repository's expressions come first. Use `^~` prefixes.
- Claim `default_server`: the repository's refusal for unknown names stays (User Story 3,
  scenario 4).

## Examples (in `deploy/nginx/site-local-examples/`, loaded by `test-config.sh`)

1. **The build service's path** (`release/build-service.conf`): `location ^~ /<path>/`,
   proxied to the service's loopback port with `Host`, `X-Forwarded-Proto https`,
   `X-Forwarded-Port 443`, `proxy_buffering off`, `proxy_request_buffering off`,
   `proxy_read_timeout` long enough for its long requests, and an upload limit.
2. **A wiki** (`wiki.conf`): a `server` block for its name and certificate, PHP through
   `fastcgi_pass` to a PHP-FPM socket on the host, the upload limit the wiki has today,
   denied access to its configuration and data folders.
3. **A redirect host** (`redirect.conf`): a `server` block answering `301` to the target.

Names, paths and ports in the examples are placeholders (`build.example`, `/build/`,
`127.0.0.1:PORT`).
