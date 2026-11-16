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
containers=()
# The images too: on a shared host they are a few hundred megabytes each.
trap '[ ${#containers[@]} -eq 0 ] || docker rm -f "${containers[@]}" >/dev/null 2>&1; rm -rf "$work"; [ ${#images[@]} -eq 0 ] || docker rmi -f "${images[@]}" >/dev/null 2>&1' EXIT
openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj /CN=localhost \
  -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null

# The client the analysis report is counted by (pdf-export spec 002, T021):
# pdf-export trusts X-Reactome-Client for its share of the waiting reports, so
# nginx must set it from the address it saw and never pass on one a request
# chose. Run for real: the deployment's image, its HTTPS server, and a stand-in
# for its `analysis` upstream that answers with the headers it was sent. Both
# share a network namespace with no network, so nothing on this host or
# beyond is reached. A request naming another client in every header a
# client could use is still counted by its own address (here, loopback).
client_named() {
  local env=$1 image=$2
  shift 2
  local conf="deploy/nginx/$env.conf" host port stub server answer
  # The server that serves the site's routes, and the analysis upstream's port.
  host=$(awk '/server_name/ { n = $2 } /common\/routes\.conf/ { sub(/;$/, "", n); print n; exit }' "$conf")
  port=$(awk '/^upstream analysis \{/ { a = 1 } a && /^[[:space:]]*server[[:space:]]/ { sub(/;.*/, ""); n = split($2, p, ":"); print p[n]; exit }' "$conf")
  if [ -z "$host" ] || [ -z "$port" ]; then
    echo "no site server or analysis upstream found in $conf"
    return 1
  fi
  printf 'server {\n  listen 127.0.0.1:%s;\n  location / {\n    default_type text/plain;\n    return 200 "client=$http_x_reactome_client real=$http_x_real_ip";\n  }\n}\n' \
    "$port" >"$work/stub-$env.conf"
  stub=$(docker run -d --network none -v "$work/stub-$env.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine)
  containers+=("$stub")
  server=$(docker run -d --network "container:$stub" "$@" "$image")
  containers+=("$server")
  for _ in $(seq 50); do
    answer=$(docker exec "$stub" curl -sk -m 5 --resolve "$host:443:127.0.0.1" \
      -H 'X-Reactome-Client: 203.0.113.9' -H 'X-Real-IP: 203.0.113.9' \
      -H 'X-Forwarded-For: 203.0.113.9' -H 'CF-Connecting-IP: 203.0.113.9' \
      "https://$host/AnalysisService/report/T/9606/report.pdf" 2>/dev/null) && break
    sleep 0.2
  done
  if [ "$answer" != 'client=127.0.0.1 real=127.0.0.1' ]; then
    echo "the analysis service was sent: ${answer:-nothing}"
    docker logs "$server" 2>&1 | tail -5
    return 1
  fi
}

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
    continue
  fi
  if client_named "$env" "$image" "${mounts[@]}" >"$work/out" 2>&1; then
    echo "ok   $env: the analysis service is told the client's own address"
  else
    echo "FAIL $env: a client chose the address it is counted by"
    sed 's/^/     /' "$work/out"
    status=1
  fi
done
exit $status
