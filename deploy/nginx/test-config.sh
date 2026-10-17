#!/bin/bash
# nginx -t on the image each deployment builds, before any of them is deployed.
#
# The unit tests read routes-core.conf as text; only nginx itself says whether
# it parses. A regex with a ';' in it, unquoted, passed every test and was
# refused by `nginx -t` at deploy time -- nginx reads ';' as the end of the
# directive. So CI builds the image for each NGINX_ENV and tests it.
#
# The certificates are mounted at run time (see the Dockerfile), so a
# throwaway self-signed pair stands in for them at every path the
# configuration names.
set -euo pipefail
cd "$(dirname "$0")/../.."

work=$(mktemp -d)
images=()
# The images too: on a shared host they are a few hundred megabytes each.
trap 'rm -rf "$work"; [ ${#images[@]} -eq 0 ] || docker rmi -f "${images[@]}" >/dev/null 2>&1' EXIT
openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj /CN=localhost \
  -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null

status=0
for env in dev release production; do
  # Every certificate and key the configuration names, made under $work.
  mkdir -p "$work/$env"
  # (A configuration with no certificates is fine: nothing to stand in.)
  { grep -hoE 'ssl_certificate(_key)?\s+\S+;' "deploy/nginx/$env.conf" || true; } |
    awk '{print $2}' | tr -d ';' | sort -u |
    while read -r file; do
      mkdir -p "$work/$env$(dirname "$file")"
      case "$file" in
        *key*) cp "$work/key.pem" "$work/$env$file" ;;
        *) cp "$work/cert.pem" "$work/$env$file" ;;
      esac
    done
  image="reactome-nginx-test:$env"
  images+=("$image")
  docker build -q -f deploy/nginx/Dockerfile --build-arg "NGINX_ENV=$env" -t "$image" . >/dev/null
  mounts=()
  for dir in "$work/$env"/etc/*/; do
    [ -d "$dir" ] && mounts+=(-v "$dir:/etc/$(basename "$dir"):ro")
  done
  if docker run --rm --network host "${mounts[@]}" --entrypoint nginx "$image" -t 2>"$work/out"; then
    echo "ok   $env"
  else
    echo "FAIL $env"
    sed 's/^/     /' "$work/out"
    status=1
  fi
done
exit $status
