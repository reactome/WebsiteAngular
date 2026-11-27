# Examples for a server's own nginx configuration

`release.conf` includes a folder the server mounts at `/etc/nginx/site-local`
(`NGINX_SITE_LOCAL` in its `.env`): `*.conf` at the top level for whole server
blocks, `release/*.conf` inside the release host's server block for locations.
`download-release.map` names the release `/download/current/` means; it is the
one file `production.conf` and `dev.conf` read from the folder (on reactome.org
and beta, with their own host names). The contract is
`specs/032-release-server/contracts/site-local-nginx.md`.

These files are examples only, with placeholder names, paths and ports. They
are never deployed from here: a server copies the ones it needs into its own
folder and fills them in. `deploy/nginx/test-config.sh` loads them all with the
release configuration, so an example that stops loading fails CI.
