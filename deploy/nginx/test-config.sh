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

# /download/ on the release host goes to the download site (specs/032 D5):
# `current` as the release the server names in its own folder, or `current`
# when it names none; any other release kept; the site's /download-data page
# not touched. Run for real, with no network, asked from inside the container.
download_redirects() {
  local image=$1 release=$2
  shift 2
  local server failed=0 got path want
  server=$(docker run -d --network none "$@" "$image")
  containers+=("$server")
  for _ in $(seq 50); do
    docker exec "$server" curl -sk -m 2 -o /dev/null --resolve release.reactome.org:443:127.0.0.1 \
      https://release.reactome.org/ 2>/dev/null && break
    sleep 0.2
  done
  while read -r path want; do
    got=$(docker exec "$server" curl -sk -m 5 -o /dev/null -w '%{http_code} %{redirect_url}' \
      --resolve release.reactome.org:443:127.0.0.1 "https://release.reactome.org$path")
    if [ "$got" != "$want" ]; then
      echo "$path: $got, not $want"
      failed=1
    fi
  done <<EOT
/download/current/diagram/R-HSA-1.json 302 https://download.reactome.org/$release/diagram/R-HSA-1.json
/download/98/x.txt?a=1 302 https://download.reactome.org/98/x.txt?a=1
/download/current/ 302 https://download.reactome.org/$release/
EOT
  # The site's page: whatever the site answers, never the download site.
  got=$(docker exec "$server" curl -sk -m 5 -o /dev/null -w '%{redirect_url}' \
    --resolve release.reactome.org:443:127.0.0.1 https://release.reactome.org/download-data)
  case "$got" in
    *download.reactome.org*) echo "/download-data was sent to $got"; failed=1 ;;
  esac
  return $failed
}

# /download/ on production and beta, proxied to the download site (specs/032
# T037). Run for real, with no network: a stand-in for the download site on
# loopback, over TLS with a certificate for download.reactome.org from a CA
# made here, and the deployment's image pointed at it. Only for the test is the
# upstream's address changed -- a copy of download-site.conf with its one
# `server` line replaced, mounted over the image's -- and the CA bundle
# replaced by that CA; the name sent, the certificate check and everything else
# are the image's own. The stand-in echoes what it was sent (X-Seen), answers a
# missing file as the bucket does (403, XML), and adds a header of the CDN's.
download_proxied() {
  local env=$1 image=$2
  shift 2
  local conf="deploy/nginx/$env.conf" host stub server failed=0 dl="$work/download-$env"
  host=$(awk '/server_name/ { n = $2 } /common\/routes\.conf/ { sub(/;$/, "", n); print n; exit }' "$conf")
  mkdir -p "$dl/files/98" "$dl/files/97" "$dl/good" "$dl/bad" "$dl/none"
  printf 'pathways 98' >"$dl/files/98/ReactomePathways.txt"
  printf 'spaced' >"$dl/files/98/a b.txt"
  printf 'old 97' >"$dl/files/97/old.txt"
  printf '%s 98;\n' "$host" >"$dl/good/download-release.map"
  printf '%s download.example;\n' "$host" >"$dl/bad/download-release.map"
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj /CN=test-ca \
    -keyout "$dl/ca.key" -out "$dl/ca.pem" 2>/dev/null
  openssl req -nodes -newkey rsa:2048 -subj /CN=download.reactome.org \
    -keyout "$dl/site.key" -out "$dl/site.csr" 2>/dev/null
  printf 'subjectAltName=DNS:download.reactome.org\n' >"$dl/san"
  openssl x509 -req -days 1 -in "$dl/site.csr" -CA "$dl/ca.pem" -CAkey "$dl/ca.key" \
    -CAcreateserial -extfile "$dl/san" -out "$dl/site.pem" 2>/dev/null
  # Readable by the stand-in's workers.
  chmod 644 "$dl/site.key"
  # The image's own file, its upstream moved to the stand-in: one line, or the
  # test is not testing what it says.
  sed 's/^\( *\)server download\.reactome\.org:443 resolve;$/\1server 127.0.0.1:8443;/' \
    deploy/nginx/common/download-site.conf >"$dl/download-site.conf"
  if [ "$(diff deploy/nginx/common/download-site.conf "$dl/download-site.conf" | grep -c '^>')" != 1 ]; then
    echo "download-site.conf has no \`server download.reactome.org:443 resolve;\` line to move"
    return 1
  fi
  cat >"$dl/stub.conf" <<'EOT'
server {
  listen 127.0.0.1:8443 ssl;
  server_name download.reactome.org;
  ssl_certificate     /stub/site.pem;
  ssl_certificate_key /stub/site.key;
  root /stub/files;
  add_header X-Seen "host=$host sni=$ssl_server_name uri=$request_uri cookie=$http_cookie auth=$http_authorization fwd=$http_x_forwarded_for" always;
  add_header X-Amz-Cf-Id stub always;
  location / { try_files $uri @missing; }
  location @missing {
    default_type application/xml;
    return 403 "<Error><Code>AccessDenied</Code></Error>";
  }
}
EOT
  stub=$(docker run -d --network none -v "$dl/stub.conf:/etc/nginx/conf.d/default.conf:ro" \
    -v "$dl:/stub:ro" nginx:alpine)
  containers+=("$stub")
  # $1: the site-local folder; $2, if given: the CA bundle.
  dl_start() {
    local ca=()
    [ -z "${2:-}" ] || ca=(-v "$2:/etc/ssl/certs/ca-certificates.crt:ro")
    [ -z "${server:-}" ] || docker rm -f "$server" >/dev/null 2>&1
    server=$(docker run -d --network "container:$stub" "${mounts[@]}" \
      -v "$dl/download-site.conf:/etc/nginx/common/download-site.conf:ro" \
      -v "$1:/etc/nginx/site-local:ro" "${ca[@]}" "$image")
    containers+=("$server")
    for _ in $(seq 50); do
      docker exec "$stub" curl -sk -m 2 -o /dev/null --resolve "$host:443:127.0.0.1" \
        "https://$host/download-data" 2>/dev/null && break
      sleep 0.2
    done
  }
  # Asks $1 (with curl's options after it); the answer, status line, headers
  # and body, in $got.
  dl_ask() {
    local path=$1
    shift
    got=$(docker exec "$stub" curl -sk -i -m 5 --resolve "$host:443:127.0.0.1" "$@" \
      "https://$host$path" | tr -d '\r')
  }
  # Fails unless $got has a line matching $2 (or, with `!`, has none).
  dl_expect() {
    local what=$1 pattern=$2 negate=${3:-}
    if printf '%s\n' "$got" | grep -qiE "$pattern"; then
      [ -z "$negate" ] && return 0
    else
      [ -n "$negate" ] && return 0
    fi
    echo "$what: ${negate:+no line }/$pattern/ expected in:"
    printf '%s\n' "$got" | sed 's/^/  | /'
    failed=1
  }
  local mounts=("$@") seen='^x-seen: host=download\.reactome\.org sni=download\.reactome\.org'

  dl_start "$dl/good" "$dl/ca.pem"
  dl_ask /download/current/ReactomePathways.txt -H 'Cookie: a=b' -H 'Authorization: Basic eA==' \
    -H 'X-Forwarded-For: 203.0.113.9'
  dl_expect current '^HTTP/[0-9.]+ 200'
  dl_expect current '^content-type: text/plain'
  dl_expect current '^pathways 98$'
  dl_expect current "$seen uri=/98/ReactomePathways\.txt cookie= auth= fwd=$"
  dl_expect current '^cache-control: public, max-age=3600$'
  dl_expect current '^x-amz-cf-id' '!'
  dl_ask /download/97/old.txt?x=1
  dl_expect numbered '^old 97$'
  dl_expect numbered "$seen uri=/97/old\.txt "
  dl_ask '/download/current/a%20b.txt'
  dl_expect escaped "$seen uri=/98/a%20b\.txt "
  dl_ask /download/current/ReactomePathways.txt -r 0-3
  dl_expect range '^HTTP/[0-9.]+ 206'
  dl_expect range '^path$'
  dl_ask /download/current/missing.txt
  dl_expect missing '^HTTP/[0-9.]+ 404'
  dl_expect missing '^Not found\.$'
  dl_expect missing 'Error|<html' '!'
  # A folder asked for as a page: the download site lists none, so the site's
  # own Download Data page, and nothing asked of the download site.
  for path in /download /download/ /download/current /download/current/ /download/97 /download/97/; do
    dl_ask "$path"
    dl_expect "folder $path" '^HTTP/[0-9.]+ 302'
    dl_expect "folder $path" '^location: (https://[^/]+)?/download-data'
    dl_expect "folder $path" '^x-seen' '!'
  done
  dl_ask /download/current/ReactomePathways.txt -X POST
  dl_expect post '^HTTP/[0-9.]+ 405'
  dl_expect post '^x-seen' '!'
  local path
  for path in /download/current/../../../etc/passwd /download/current/%2e%2e/%2e%2e/%2e%2e/etc/passwd \
    /download/..%2f..%2fetc/passwd /download/%2e%2e/%2e%2e/x; do
    dl_ask "$path" --path-as-is
    dl_expect "$path" '^x-seen' '!'
    dl_expect "$path" '^HTTP/[0-9.]+ 200' '!'
  done

  # A line naming something other than a release, and the image's own CA
  # bundle: `current` refused, and the stand-in's certificate is not trusted.
  dl_start "$dl/bad"
  dl_ask /download/current/ReactomePathways.txt
  dl_expect 'bad map' '^HTTP/[0-9.]+ 503'
  dl_expect 'bad map' 'names no release'
  dl_ask /download/97/old.txt
  dl_expect 'untrusted certificate' '^HTTP/[0-9.]+ 502'
  dl_expect 'untrusted certificate' '^x-seen' '!'
  dl_start "$dl/none" "$dl/ca.pem"
  dl_ask /download/current/ReactomePathways.txt
  dl_expect 'no map' '^HTTP/[0-9.]+ 503'
  dl_expect 'no map' 'names no release'
  dl_ask /download/97/old.txt
  dl_expect 'no map, a numbered release' '^old 97$'
  return $failed
}

# The release server's other sites, from the site-local examples (specs/032
# US3), answered as their files say, and a name nobody configured still
# refused -- an example claiming it would take every unknown name. Run for
# real, with no network: a stand-in for the build service on the example's
# port answers 200, so its path is seen to reach it rather than the site (whose
# upstream, absent here, would answer 502).
site_local_hosts() {
  local image=$1
  shift
  local stub server failed=0 host path want got
  printf 'server {\n  listen 127.0.0.1:8081;\n  location / { return 200 "build service"; }\n}\n' \
    >"$work/stub-build.conf"
  stub=$(docker run -d --network none -v "$work/stub-build.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine)
  containers+=("$stub")
  server=$(docker run -d --network "container:$stub" "$@" "$image")
  containers+=("$server")
  for _ in $(seq 50); do
    docker exec "$stub" curl -sk -m 2 -o /dev/null --resolve release.reactome.org:443:127.0.0.1 \
      https://release.reactome.org/ 2>/dev/null && break
    sleep 0.2
  done
  while read -r host path want; do
    got=$(docker exec "$stub" curl -sk -m 5 -o /dev/null -w '%{http_code} %{redirect_url}' \
      --resolve "$host:443:127.0.0.1" --resolve "$host:80:127.0.0.1" "$path")
    got=${got% }
    if [ "$got" != "$want" ]; then
      echo "$path: $got, not $want"
      failed=1
    fi
  done <<EOT
unknown.example https://unknown.example/ 503
wiki.example http://wiki.example/x 301 https://wiki.example/x
redirect.example https://redirect.example/a?b=1 301 https://target.example/a?b=1
release.reactome.org https://release.reactome.org/build/job/x 200
release.reactome.org https://release.reactome.org/builds/ 502
release.reactome.org https://release.reactome.org/site-local-probe 200
EOT
  return $failed
}

# A renewal's challenge, answered from the folder certbot writes to (specs/032
# T025): compose mounts CERTBOT_WEBROOT at /var/www/certbot, where every
# configuration routes the challenge path. Without that mount the folder in the
# container is empty and a webroot renewal through this nginx fails -- which it
# did, unnoticed, until T002. Asked over plain HTTP, as the CA asks.
challenge_served() {
  local image=$1 host=$2
  shift 2
  local server token=probe-$$ got
  mkdir -p "$work/webroot/.well-known/acme-challenge"
  printf 'challenge %s' "$token" >"$work/webroot/.well-known/acme-challenge/$token"
  server=$(docker run -d --network none "$@" "$image")
  containers+=("$server")
  for _ in $(seq 50); do
    got=$(docker exec "$server" curl -s -m 2 --resolve "$host:80:127.0.0.1" \
      "http://$host/.well-known/acme-challenge/$token" 2>/dev/null) && [ -n "$got" ] && break
    sleep 0.2
  done
  if [ "$got" != "challenge $token" ]; then
    echo "http://$host/.well-known/acme-challenge/$token answered: ${got:-nothing}"
    return 1
  fi
}

status=0
for env in dev release production; do
  # Every certificate and key the configuration names, made under $work.
  mkdir -p "$work/$env"
  # (A configuration with no certificates is fine: nothing to stand in.)
  # The release configuration's site-local examples name certificates of
  # their own, stood in for the same way.
  sources=("deploy/nginx/$env.conf")
  [ "$env" = release ] && sources+=($(find deploy/nginx/site-local-examples -name '*.conf'))
  { grep -hoE 'ssl_certificate(_key)?\s+\S+;' "${sources[@]}" || true; } |
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
  # Each folder at the depth compose mounts it: /etc/ssl/cloudflare, not
  # /etc/ssl, which would hide the image's CA bundle (/etc/ssl/certs) that the
  # download proxy checks the download site's certificate against.
  for dir in "$work/$env"/etc/*/; do
    [ -d "$dir" ] || continue
    if [ "$(basename "$dir")" = ssl ]; then
      for sub in "$dir"*/; do
        [ -d "$sub" ] && mounts+=(-v "$sub:/etc/ssl/$(basename "$sub"):ro")
      done
    else
      mounts+=(-v "$dir:/etc/$(basename "$dir"):ro")
    fi
  done
  if docker run --rm --network host "${mounts[@]}" --entrypoint nginx "$image" -t 2>"$work/out"; then
    echo "ok   $env"
  else
    echo "FAIL $env"
    sed 's/^/     /' "$work/out"
    status=1
    continue
  fi
  # The release server's own configuration is mounted at run time, never
  # baked (specs/032 FR-004); the run above is the image with nothing mounted.
  # Again with every documented example in place, so an example that stops
  # loading -- or a change here that breaks one -- fails before a server
  # copies it.
  if [ "$env" = release ]; then
    if docker run --rm --network host "${mounts[@]}" \
      -v "$PWD/deploy/nginx/site-local-examples:/etc/nginx/site-local:ro" \
      --entrypoint nginx "$image" -t 2>"$work/out"; then
      echo "ok   $env with the site-local examples"
      if download_redirects "$image" 99 "${mounts[@]}" \
        -v "$PWD/deploy/nginx/site-local-examples:/etc/nginx/site-local:ro" >"$work/out" 2>&1; then
        echo "ok   $env: /download/ goes to the release the server names"
      else
        echo "FAIL $env: /download/ with the server's release named"
        sed 's/^/     /' "$work/out"
        status=1
      fi
      if download_redirects "$image" current "${mounts[@]}" >"$work/out" 2>&1; then
        echo "ok   $env: /download/ goes to the current release when none is named"
      else
        echo "FAIL $env: /download/ with no release named"
        sed 's/^/     /' "$work/out"
        status=1
      fi
      if site_local_hosts "$image" "${mounts[@]}" \
        -v "$PWD/deploy/nginx/site-local-examples:/etc/nginx/site-local:ro" >"$work/out" 2>&1; then
        echo "ok   $env: the examples' sites answer, and unknown names are still refused"
      else
        echo "FAIL $env: the site-local examples' sites"
        sed 's/^/     /' "$work/out"
        status=1
      fi
    else
      echo "FAIL $env with the site-local examples"
      sed 's/^/     /' "$work/out"
      status=1
    fi
  fi
  if [ "$env" = release ]; then
    # The folder this mounts is the one compose mounts on a host.
    if ! grep -qE '^ +- \$\{CERTBOT_WEBROOT:-[^}]+\}:/var/www/certbot:ro$' docker-compose.yml; then
      echo "FAIL $env: docker-compose.yml does not mount CERTBOT_WEBROOT at /var/www/certbot"
      status=1
    elif challenge_served "$image" release.reactome.org "${mounts[@]}" \
      -v "$work/webroot:/var/www/certbot:ro" >"$work/out" 2>&1; then
      echo "ok   $env: a renewal's challenge is served from the mounted webroot"
    else
      echo "FAIL $env: a renewal's challenge"
      sed 's/^/     /' "$work/out"
      status=1
    fi
  fi
  if [ "$env" != release ]; then
    if download_proxied "$env" "$image" "${mounts[@]}" >"$work/out" 2>&1; then
      echo "ok   $env: /download/ is the download site's, at this address"
    else
      echo "FAIL $env: /download/ through the download site"
      sed 's/^/     /' "$work/out"
      status=1
    fi
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
