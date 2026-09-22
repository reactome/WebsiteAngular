#!/usr/bin/env bash
#
# Put the nginx configuration somewhere a `git checkout` cannot reach.
#
# nginx used to mount `deploy/nginx` straight out of the working tree. That
# makes a working directory a deployment input: check out a branch and the
# routes inside the running container are that branch's, one reload away from
# being live. It happened -- a feature branch's /mcp route was found sitting in
# the production container, inert only because nginx reads its configuration at
# start rather than continuously.
#
# So the container mounts `.staged/`, which is gitignored and therefore
# untouched by any checkout, and this is the only thing that writes to it.
#
#   scripts/stage-nginx.sh            # validate and stage
#   scripts/stage-nginx.sh --check    # validate only, change nothing
#
# Then reload: `docker compose exec nginx nginx -s reload`
#
# Files are copied **in place** rather than replaced, and that is load-bearing.
# A single-file bind mount follows the inode, and `git checkout` replaces a file
# rather than rewriting it -- which is why the environment config inside the
# running container was four days stale while the directory beside it was
# current. `cp` truncates and writes, so the inode survives and a reload is
# enough.
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd)
src="$here/deploy/nginx"
dst="$src/.staged"
env_name=${NGINX_ENV:-dev}

[ -f "$src/$env_name.conf" ] || { echo "no such environment: $env_name" >&2; exit 1; }

# Validate the *source* before it can reach the staged copy. A configuration
# that fails here has not been staged, so a reload cannot pick it up.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp "$src/$env_name.conf" "$tmp/default.conf"
cp -r "$src/common" "$tmp/common"

if ! docker run --rm \
  -v "$tmp/default.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$tmp/common:/etc/nginx/common:ro" \
  -v "${LETSENCRYPT_DIR:-/etc/letsencrypt}:/etc/letsencrypt:ro" \
  -v "${CLOUDFLARE_CERT_DIR:-/etc/ssl/cloudflare}:/etc/ssl/cloudflare:ro" \
  nginx:alpine nginx -t >/dev/null 2>"$tmp/err"; then
  echo "refusing to stage: $env_name.conf does not pass nginx -t" >&2
  grep -E 'emerg|error' "$tmp/err" | head -3 >&2
  exit 1
fi

if [ "${1:-}" = "--check" ]; then
  echo "$env_name.conf is valid; nothing staged"
  exit 0
fi

mkdir -p "$dst/common"
cp "$src/$env_name.conf" "$dst/default.conf"
# Delete-then-copy would change inodes under the running container. Refresh the
# contents of the directory instead, and remove only what has gone.
for f in "$src"/common/*; do cp "$f" "$dst/common/$(basename "$f")"; done
for f in "$dst"/common/*; do [ -f "$src/common/$(basename "$f")" ] || rm -f "$f"; done

echo "staged $env_name.conf and common/ -> deploy/nginx/.staged"
echo "reload with: docker compose exec nginx nginx -s reload"
