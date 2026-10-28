#!/usr/bin/env bash
# Moves the site to the release docker-compose.yml names, and clears everything that
# held the previous one, so every page reads the new release. Run with sudo from the
# repository, after pulling the change that names the new release:
#
#   sudo bash deploy/graphdb/next-release.sh check      what serves now; changes nothing
#   sudo bash deploy/graphdb/next-release.sh switch     move to the new release
#   sudo bash deploy/graphdb/next-release.sh rollback   back to what served before
#   sudo bash deploy/graphdb/next-release.sh cleanup    once the new release is checked:
#                                                       remove the previous releases' graphs
#
# `switch` stops whatever serves the graph's port, starts the release's read-only image
# (built on the image the release published), then restarts each service that holds
# the release in memory -- content-node, java-library, Tomcat -- clears the figure and
# file caches, and checks that each answers the new release. If the graph or
# content-node does not come up on it, it goes back by itself. Each of these was a step
# done by hand before, and a missed one served the previous release with no error:
# java-library answered the old release for days until it was restarted.
#
# Last, by hand: purge the edge cache and warm it (printed at the end).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
compose_file="$repo/docker-compose.yml"
user_home="$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)"
# compose's default for this is under ~, which is root's home under sudo.
export CONTENT_NODE_ENV_FILE="${CONTENT_NODE_ENV_FILE:-$user_home/.content-node.env}"
GRAPH_WAIT="${GRAPH_WAIT:-900}"    # seconds; the first start fills a 3.2 GB volume
SERVICE_WAIT="${SERVICE_WAIT:-600}"

say() { printf '\n== %s\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die() { printf 'STOPPED: %s\n' "$*" >&2; exit 2; }

release="$(sed -nE 's/^ *image: reactome\/graphdb_readonly:Release([0-9]+) *$/\1/p' "$compose_file")"
[ -n "$release" ] || die "docker-compose.yml names no reactome/graphdb_readonly:ReleaseNN"

dc() { (cd "$repo" && docker compose "$@"); }

# The release a service answers, or "none".
answer() {
  local body
  body="$(curl -s -m 20 "$1" 2>/dev/null || true)"
  case "$2" in
    json) printf '%s' "$body" | sed -nE 's/.*"release":"?([0-9]+)"?.*/\1/p' | head -1 ;;
    *) printf '%s' "$body" | grep -E '^[0-9]+$' || true ;;
  esac
}
content_node() { answer http://127.0.0.1:4400/health json; }
java_library() { answer http://127.0.0.1:4360/health json; }
contentservice() { answer http://127.0.0.1:8080/ContentService/data/database/version plain; }
analysis() { answer http://127.0.0.1:8080/AnalysisService/database/version plain; }

# Waits until $1 (a function) answers $release, for at most $2 seconds.
wait_for() {
  local what="$1" limit="$2" got="" waited=0
  while [ "$waited" -lt "$limit" ]; do
    got="$("$what")"
    [ "$got" = "$release" ] && { note "$what answers $release"; return 0; }
    sleep 5
    waited=$((waited + 5))
  done
  note "$what answers ${got:-nothing}, not $release, after ${limit}s"
  return 1
}

host_neo4j_active() { systemctl is-active --quiet neo4j 2>/dev/null; }

clear_volume() {
  # The service's own image, so nothing is pulled; as root, so every file goes.
  local volume="$1" image="$2"
  docker run --rm --user 0 --entrypoint sh -v "$volume:/cache" "$image" -c 'rm -rf /cache/* /cache/.[!.]* 2>/dev/null; true'
  note "cleared $volume"
}

restart_with_cleared_cache() {
  local service="$1" volume="$2" image
  image="$(docker inspect -f '{{.Config.Image}}' "websiteangular-$service-1")"
  dc stop "$service" >/dev/null
  clear_volume "websiteangular_$volume" "$image"
  dc up -d "$service" >/dev/null
}

status() {
  say "Release $release named by docker-compose.yml"
  if host_neo4j_active; then note "host Neo4j: active (serves the graph's port)"; else note "host Neo4j: not active"; fi
  note "graphdb container: $(docker inspect -f '{{.Config.Image}} {{.State.Status}}' websiteangular-graphdb-1 2>/dev/null || echo none)"
  note "listening on 7687: $(ss -Hltnp 'sport = :7687' 2>/dev/null | sed -nE 's/.*users:\(\("([^"]+)".*/\1/p' | sort -u | tr '\n' ' ')"
  note "content-node: $(content_node)   java-library: $(java_library)   ContentService: $(contentservice)   AnalysisService: $(analysis)"
  note "free on /: $(df -h --output=avail / | tail -1 | tr -d ' ')"
}

restart_services() {
  say "Restarting what holds the release in memory, and clearing its caches"
  dc restart content-node >/dev/null
  wait_for content_node "$SERVICE_WAIT" || return 1
  restart_with_cleared_cache java-library java-library-cache
  wait_for java_library "$SERVICE_WAIT" || return 1
  # Figures are cached by what was asked for, not by release, so an old figure
  # would be served for the new release until cleared.
  restart_with_cleared_cache render render-cache
  systemctl restart tomcat9
  wait_for contentservice "$SERVICE_WAIT" || return 1
  note "AnalysisService answers $(analysis) (from its own analysis file, not the graph)"
  if journalctl -u tomcat9 --since "-15 min" 2>/dev/null | grep -q "no longer accepts writes"; then
    note "WARNING: Tomcat tried to write to the read-only graph; see journalctl -u tomcat9"
  fi
}

do_rollback() {
  say "Rolling back"
  dc stop graphdb >/dev/null 2>&1 || true
  if [ -f "$(state_file)" ] && grep -q '^host_neo4j=active$' "$(state_file)"; then
    systemctl enable neo4j >/dev/null 2>&1 || true
    systemctl start neo4j
    note "host Neo4j started"
  else
    # From one release's image to the next, the previous one is the previous
    # commit's compose file, and its volume is still there until cleanup.
    note "nothing served the graph from the host before this switch: to go back, check out the"
    note "previous release's docker-compose.yml and run switch again (its volume is kept until cleanup)"
  fi
  dc restart content-node java-library >/dev/null || true
  systemctl restart tomcat9 || true
  sleep 20
  status
}

# What served before the switch, for rollback; outside the checkout.
state_file() { printf '%s' "${NEXT_RELEASE_STATE:-/var/tmp/reactome-next-release.state}"; }

do_switch() {
  [ "$(id -u)" = 0 ] || die "run with sudo"
  [ -f "$CONTENT_NODE_ENV_FILE" ] || die "no credentials file at $CONTENT_NODE_ENV_FILE (set CONTENT_NODE_ENV_FILE)"
  status
  if ! docker volume inspect "websiteangular_graphdb-release$release" >/dev/null 2>&1; then
    local free_kb
    free_kb="$(df --output=avail -k / | tail -1 | tr -d ' ')"
    [ "$free_kb" -gt $((5 * 1024 * 1024)) ] || die "under 5 GB free: the new graph's volume needs 3.2 GB (run cleanup, or free space)"
  fi

  say "Building the read-only image on the release's (pulls it if needed)"
  dc build --pull graphdb

  say "Stopping what serves the graph's port"
  if host_neo4j_active; then
    printf 'host_neo4j=active\n' > "$(state_file)"
    systemctl stop neo4j
    systemctl disable neo4j >/dev/null 2>&1 || true
    note "host Neo4j stopped and disabled (its package stays: rollback starts it again)"
  else
    printf 'host_neo4j=inactive\n' > "$(state_file)"
  fi

  say "Starting the graph on release $release"
  dc up -d graphdb
  local waited=0
  until docker logs websiteangular-graphdb-1 2>&1 | grep -q 'Started\.$'; do
    if [ "$(docker inspect -f '{{.State.Running}}' websiteangular-graphdb-1)" != true ] || [ "$waited" -ge "$GRAPH_WAIT" ]; then
      note "the graph did not start; its last lines:"
      docker logs --tail 15 websiteangular-graphdb-1 2>&1 | grep -viE 'password|auth' | sed 's/^/    /'
      do_rollback
      exit 1
    fi
    sleep 5
    waited=$((waited + 5))
  done
  note "started after ${waited}s"

  if ! restart_services; then
    note "a service did not come up on release $release"
    do_rollback
    exit 1
  fi

  say "Done: release $release"
  status
  local listeners
  listeners="$(ss -Hltn 'sport = :7687' 2>/dev/null | wc -l)"
  [ "$listeners" -le 1 ] || note "WARNING: $listeners listeners on 7687"
  cat <<EOF

Last, by hand, once the site looks right:
  1. Purge the edge cache by prefix /ContentService/ (Cloudflare dashboard).
  2. As yourself, not root:  node tools/content-node/warm.ts https://<site> $release
  3. When happy:             sudo bash deploy/graphdb/next-release.sh cleanup
EOF
}

do_cleanup() {
  [ "$(id -u)" = 0 ] || die "run with sudo"
  [ "$(docker inspect -f '{{.State.Running}}' websiteangular-graphdb-1 2>/dev/null)" = true ] || die "the graph container is not running"
  [ "$(content_node)" = "$release" ] || die "content-node does not answer $release: not removing anything"
  say "Removing the previous releases' graphs"
  for volume in $(docker volume ls -q | grep -E '^websiteangular_graphdb-release' | grep -vx "websiteangular_graphdb-release$release"); do
    docker volume rm "$volume" >/dev/null && note "removed volume $volume"
  done
  for image in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^(public\.ecr\.aws/reactome/graphdb|reactome/graphdb_readonly|local-test/graphdb):' | grep -v "Release$release\$"); do
    docker rmi "$image" >/dev/null && note "removed image $image"
  done
  rm -f "$(state_file)"
  note "free on /: $(df -h --output=avail / | tail -1 | tr -d ' ')"
}

case "${1:-}" in
  check) status ;;
  switch) do_switch ;;
  rollback) [ "$(id -u)" = 0 ] || die "run with sudo"; do_rollback ;;
  cleanup) do_cleanup ;;
  *) echo "usage: sudo bash $0 check|switch|rollback|cleanup" >&2; exit 2 ;;
esac
