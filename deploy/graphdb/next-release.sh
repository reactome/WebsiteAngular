#!/usr/bin/env bash
# Moves the site to the release docker-compose.yml names, and clears everything that
# held the previous one, so every page reads the new release. Run with sudo from the
# repository, after pulling the change that names the new release:
#
#   sudo bash deploy/graphdb/next-release.sh check      what serves now; changes nothing
#   sudo bash deploy/graphdb/next-release.sh switch     move to the new release
#   sudo bash deploy/graphdb/next-release.sh rollback   back to the host database, if it served before
#   sudo bash deploy/graphdb/next-release.sh cleanup    once the new release is checked:
#                                                       remove the previous releases' graphs
#
# `switch` builds the release's read-only image (on the image the release published) and
# fills its volume while the current graph still serves, then stops that graph, starts
# the new one, and restarts each service that holds the release in memory --
# content-node, java-library, Tomcat -- clearing the figure and file caches, and checks
# each. If anything fails once the old graph is stopped, it goes back by itself. Each of
# these was a step done by hand before, and a missed restart served the previous release
# with no error.
#
# Last, by hand: purge the edge cache and warm it (printed at the end).
set -euo pipefail
# The rollback trap set in do_switch must fire for a failure inside a function too
# (dc, above all): without errtrace, set -e exited there and left nothing serving.
set -o errtrace

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
compose_file="$repo/docker-compose.yml"
user_home="$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)"
# compose's default for this is under ~, which is root's home under sudo.
export CONTENT_NODE_ENV_FILE="${CONTENT_NODE_ENV_FILE:-$user_home/.content-node.env}"
GRAPH_WAIT="${GRAPH_WAIT:-600}"
SERVICE_WAIT="${SERVICE_WAIT:-600}"
# What served before the switch, for rollback; outside the checkout.
STATE="${NEXT_RELEASE_STATE:-/var/tmp/reactome-next-release.state}"

say() { printf '\n== %s\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die() { printf 'STOPPED: %s\n' "$*" >&2; exit 2; }

release="$(sed -nE 's/^ *image: reactome\/graphdb_readonly:Release([0-9]+) *$/\1/p' "$compose_file")"
[ -n "$release" ] || die "docker-compose.yml names no reactome/graphdb_readonly:ReleaseNN"

dc() { (cd "$repo" && docker compose "$@"); }

# The release a service answers, or nothing.
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

# Waits until a compose service's container reports healthy, for at most $2 seconds.
wait_healthy() {
  local service="$1" limit="$2" state="" waited=0
  while [ "$waited" -lt "$limit" ]; do
    state="$(docker inspect -f '{{.State.Health.Status}}' "websiteangular-$service-1" 2>/dev/null || true)"
    [ "$state" = healthy ] && { note "$service healthy"; return 0; }
    sleep 5
    waited=$((waited + 5))
  done
  note "$service is ${state:-not running}, not healthy, after ${limit}s"
  return 1
}

host_neo4j_active() { systemctl is-active --quiet neo4j 2>/dev/null; }
port_listening() { [ -n "$(ss -Hltn 'sport = :7687' 2>/dev/null)" ]; }

clear_volume() {
  # The service's own image, so nothing is pulled; as root, so every file goes.
  local volume="$1" image="$2"
  docker run --rm --user 0 --entrypoint sh -v "$volume:/cache" "$image" \
    -c 'rm -rf /cache/* /cache/.[!.]* 2>/dev/null; [ -z "$(ls -A /cache)" ]' || {
    note "could not clear $volume"
    return 1
  }
  note "cleared $volume"
}

restart_with_cleared_cache() {
  local service="$1" volume="$2" image
  image="$(docker inspect -f '{{.Config.Image}}' "websiteangular-$service-1")" || return 1
  dc stop "$service" >/dev/null || return 1
  clear_volume "websiteangular_$volume" "$image" || return 1
  dc up -d "$service" >/dev/null || return 1
}

status() {
  say "Release $release named by docker-compose.yml"
  if host_neo4j_active; then note "host Neo4j: active"; else note "host Neo4j: not active"; fi
  note "graphdb container: $(docker inspect -f '{{.Config.Image}} {{.State.Status}}' websiteangular-graphdb-1 2>/dev/null || echo none)"
  note "listening on 7687: $(ss -Hltnp 'sport = :7687' 2>/dev/null | sed -nE 's/.*users:\(\("([^"]+)".*/\1/p' | sort -u | tr '\n' ' ')"
  note "content-node: $(content_node)   java-library: $(java_library)   ContentService: $(contentservice)   AnalysisService: $(analysis)"
  note "free on /: $(df -h --output=avail / | tail -1 | tr -d ' ')"
  [ -f "$STATE" ] && note "before the last switch: $(cat "$STATE")"
  return 0
}

# Every step is checked here: this runs inside `if`, where `set -e` does not stop it.
restart_services() {
  say "Restarting what holds the release in memory, and clearing its caches"
  dc restart content-node >/dev/null || return 1
  wait_for content_node "$SERVICE_WAIT" || return 1
  restart_with_cleared_cache java-library java-library-cache || return 1
  wait_for java_library "$SERVICE_WAIT" || return 1
  # Figures are cached by what was asked for, not by release, so an old figure
  # would be served for the new release until cleared.
  restart_with_cleared_cache render render-cache || return 1
  wait_healthy render "$SERVICE_WAIT" || return 1
  systemctl restart tomcat9 || return 1
  wait_for contentservice "$SERVICE_WAIT" || return 1
  note "AnalysisService answers $(analysis) (from its own analysis file, not the graph)"
  local since
  since="$(date -d '-15 min' '+%Y-%m-%d %H:%M:%S')"
  if { journalctl -u tomcat9 --since "$since" 2>/dev/null
    find /var/log/tomcat9 -type f -newermt "$since" -exec cat {} + 2>/dev/null; } |
    grep 'no longer accepts writes' >/dev/null; then
    note "WARNING: a web application tried to write to the read-only graph (journalctl -u tomcat9, /var/log/tomcat9)"
  fi
}

do_rollback() {
  set +e
  say "Rolling back"
  if ! grep -qx 'host_neo4j=active' "$STATE" 2>/dev/null; then
    # Nothing to go back to on this host: leave whatever serves now running.
    note "the host database did not serve before the last switch, so there is nothing here to go back to;"
    note "to return to a previous release, check out its docker-compose.yml and run switch again"
    note "(its volume is kept until cleanup)"
    status
    return 1
  fi
  dc stop graphdb >/dev/null 2>&1
  systemctl enable neo4j >/dev/null 2>&1
  if ! systemctl start neo4j; then
    note "the host database did not start: see journalctl -u neo4j"
  fi
  local waited=0
  until port_listening || [ "$waited" -ge 300 ]; do
    sleep 5
    waited=$((waited + 5))
  done
  port_listening && note "host database listening on 7687" || note "nothing listening on 7687 after 300s"
  # The services read the release at start: restart them on the graph that serves now.
  dc restart content-node java-library >/dev/null 2>&1
  systemctl restart tomcat9
  sleep 30
  status
  return 0
}

do_switch() {
  [ "$(id -u)" = 0 ] || die "run with sudo"
  [ -f "$CONTENT_NODE_ENV_FILE" ] || die "no credentials file at $CONTENT_NODE_ENV_FILE (set CONTENT_NODE_ENV_FILE)"
  status
  if ! docker volume inspect "websiteangular_graphdb-release$release" >/dev/null 2>&1; then
    local free_kb
    free_kb="$(df --output=avail -k / | tail -1 | tr -d ' ')"
    [ "$free_kb" -gt $((5 * 1024 * 1024)) ] || die "under 5 GB free: the new graph's volume needs 3.2 GB (run cleanup, or free space)"
  fi

  say "Building the read-only image on the release's, and filling its volume"
  dc build --pull graphdb
  # Created, not started: Docker copies the release's 3.2 GB store into the new
  # volume now, while the current graph still serves, rather than after it stops.
  dc up --no-start graphdb
  note "the graph is ready to start"

  say "Stopping what serves the graph's port"
  # Only a switch away from the host database records it; a second switch keeps the
  # first one's record, so rollback still knows where it came from.
  if host_neo4j_active; then
    printf 'host_neo4j=active\n' > "$STATE"
    systemctl stop neo4j
    systemctl disable neo4j >/dev/null 2>&1 || true
    note "host Neo4j stopped and disabled (its package stays: rollback starts it again)"
  elif [ ! -f "$STATE" ]; then
    printf 'host_neo4j=inactive\n' > "$STATE"
  fi

  # From here, any failure goes back.
  trap 'note "failed at line $LINENO"; do_rollback; exit 1' ERR

  say "Starting the graph on release $release"
  local since
  since="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  dc up -d graphdb
  local waited=0
  # This start's log only: an earlier start of the same container logged Started. too.
  until docker logs --since "$since" websiteangular-graphdb-1 2>&1 | grep 'Started\.$' >/dev/null; do
    if [ "$(docker inspect -f '{{.State.Running}}' websiteangular-graphdb-1)" != true ] || [ "$waited" -ge "$GRAPH_WAIT" ]; then
      note "the graph did not start; its last lines:"
      docker logs --tail 15 websiteangular-graphdb-1 2>&1 | grep -viE 'password|auth' | sed 's/^/    /' || true
      trap - ERR
      do_rollback
      exit 1
    fi
    sleep 5
    waited=$((waited + 5))
  done
  note "started after ${waited}s"

  trap - ERR
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
  local volume image
  for volume in $(docker volume ls -q | grep -E '^websiteangular_graphdb-release' | grep -vx "websiteangular_graphdb-release$release"); do
    docker volume rm "$volume" >/dev/null && note "removed volume $volume"
  done
  for image in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^(public\.ecr\.aws/reactome/graphdb|reactome/graphdb_readonly|local-test/graphdb):' | grep -v "Release$release\$"); do
    docker rmi "$image" >/dev/null && note "removed image $image"
  done
  # With the host database's data still on disk, rollback to it stays possible;
  # removing the record only ends this script's offer to do it.
  rm -f "$STATE"
  note "a compose override file that named an earlier graph image now names one that is gone: retire it"
  note "free on /: $(df -h --output=avail / | tail -1 | tr -d ' ')"
}

case "${1:-}" in
  check) status ;;
  switch) do_switch ;;
  rollback) [ "$(id -u)" = 0 ] || die "run with sudo"; do_rollback ;;
  cleanup) do_cleanup ;;
  *) echo "usage: sudo bash $0 check|switch|rollback|cleanup" >&2; exit 2 ;;
esac
