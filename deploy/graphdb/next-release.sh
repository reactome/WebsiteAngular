#!/usr/bin/env bash
# Moves the site to the release docker-compose.yml names, and clears everything that
# held the previous one, so every page reads the new release. Run with sudo from the
# repository, after pulling the change that names the new release:
#
#   sudo bash deploy/graphdb/next-release.sh check      what serves now; changes nothing
#   sudo bash deploy/graphdb/next-release.sh switch     move to the new release
#   sudo bash deploy/graphdb/next-release.sh rollback   back to what served before: the host database,
#                                                       or the previous release's image and volume
#   sudo bash deploy/graphdb/next-release.sh cleanup    once the new release is checked:
#                                                       remove the previous releases' graphs
#
# `switch` builds the release's read-only image (on the image the release published) and
# fills its volume while the current graph still serves (from a container of its own,
# so the serving one is not touched), then stops that graph, starts the new one, and restarts each service that holds the release in memory --
# content-node, java-library, Tomcat -- clearing the figure and file caches, and checks
# each. If anything fails once the old graph is stopped, it goes back by itself. Each of
# these was a step done by hand before, and a missed restart served the previous release
# with no error.
#
# Run it inside tmux or screen: a dropped connection during the graph's start would
# otherwise end it there. (It goes back if interrupted before the graph has started,
# and says where it stopped after.)
#
# Last, by hand: purge the edge cache and warm it (printed at the end).
set -euo pipefail
# Run as `... | tee log` and the session lost, a write into the dead pipe killed the
# script outright (SIGPIPE), a rollback included; ignored, the write just fails.
trap '' PIPE

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
compose_file="$repo/docker-compose.yml"
user_home="$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)"
# compose's default for this is under ~, which is root's home under sudo.
export CONTENT_NODE_ENV_FILE="${CONTENT_NODE_ENV_FILE:-$user_home/.content-node.env}"
GRAPH_WAIT="${GRAPH_WAIT:-600}"
SERVICE_WAIT="${SERVICE_WAIT:-600}"
TOMCAT_LOGS="${TOMCAT_LOGS:-/var/log/tomcat9}"
# What served before the switch, for rollback, with the override rollback writes: in a
# directory only root can write to, outside the checkout.
STATE="${NEXT_RELEASE_STATE:-/var/lib/reactome-next-release/state}"
OLD_STATE="${NEXT_RELEASE_OLD_STATE:-/var/tmp/reactome-next-release.state}"

# Writing never stops the script: after a dropped connection every write fails, and
# under set -e the first one ended it wherever it was, a rollback included.
say() { printf '\n== %s\n' "$*" || true; }
note() { printf '  %s\n' "$*" || true; }
die() { printf 'STOPPED: %s\n' "$*" >&2 || true; exit 2; }

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
  if [ -f "$STATE" ]; then
    note "before the last switch: $(tr '\n' ' ' < "$STATE")"
  elif [ -f "$OLD_STATE" ]; then
    note "before the last switch (moved on the next switch, rollback or cleanup): $(tr '\n' ' ' < "$OLD_STATE")"
  elif [ -d "$(dirname "$STATE")" ] && [ ! -r "$(dirname "$STATE")" ]; then
    note "the record of what served before is root's: run check with sudo to see it"
  fi
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
  # Only what Tomcat writes from this restart on: read whole, catalina.out's old
  # lines raised the warning on every switch.
  local since file
  local -A size=()
  since="$(date '+%Y-%m-%d %H:%M:%S')"
  for file in "$TOMCAT_LOGS"/*; do
    [ -f "$file" ] && size[$file]="$(stat -c %s "$file")"
  done
  systemctl restart tomcat9 || return 1
  wait_for contentservice "$SERVICE_WAIT" || return 1
  note "AnalysisService answers $(analysis) (from its own analysis file, not the graph)"
  if { journalctl -u tomcat9 --since "$since" 2>/dev/null
    for file in "$TOMCAT_LOGS"/*; do
      [ -f "$file" ] && tail -c "+$((${size[$file]:-0} + 1))" "$file" 2>/dev/null
    done
    # Under pipefail the loop's last test would otherwise decide, not grep.
    true; } |
    grep 'no longer accepts writes' >/dev/null; then
    note "WARNING: a web application tried to write to the read-only graph (journalctl -u tomcat9, /var/log/tomcat9)"
  fi
}

rolled_back=''
do_rollback() {
  # Not to be cut short, and first, before anything else can be interrupted: a second
  # Ctrl-C here stopped the graph and never started what served before.
  trap '' INT TERM HUP
  # Once only: a rollback that itself fails must not start another.
  [ -z "$rolled_back" ] || return 1
  rolled_back=yes
  set +e
  say "Rolling back"
  if grep -qx 'host_neo4j=active' "$STATE" 2>/dev/null; then
    rollback_to_host
  elif ! rollback_to_previous_release; then
    note "nothing here to go back to: neither the host database nor a previous release's"
    note "image and volume; to return to one, check out its docker-compose.yml and run switch again"
    status
    return 1
  fi
  # The services read the release at start: restart them on the graph that serves now,
  # and drop figures made from the release being left.
  dc restart content-node java-library >/dev/null 2>&1
  restart_with_cleared_cache render render-cache
  systemctl restart tomcat9
  sleep 30
  status
  return 0
}

rollback_to_host() {
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
  if port_listening; then
    note "host database listening on 7687"
  else
    # Stopped first, and the host database did not come: the graph that served is
    # started again rather than leaving the port empty.
    note "nothing listening on 7687 after 300s: starting the graph that served again"
    dc start graphdb >/dev/null 2>&1 || note "it could not be started either: nothing serves 7687"
  fi
}

# The release that served before this switch, from its own image and volume (kept until
# cleanup), through compose with an override naming them, so the container is the one
# compose manages. docker-compose.yml still names the new release afterwards.
rollback_to_previous_release() {
  local previous
  previous="$(sed -nE 's/^previous_release=([0-9]+)$/\1/p' "$STATE" 2>/dev/null | head -1 || true)"
  [ -n "$previous" ] || return 1
  docker image inspect "reactome/graphdb_readonly:Release$previous" >/dev/null 2>&1 || return 1
  docker volume inspect "websiteangular_graphdb-release$previous" >/dev/null 2>&1 || return 1
  local override="$STATE.release$previous.yml"
  printf '%s\n' \
    'services:' \
    '  graphdb:' \
    "    image: reactome/graphdb_readonly:Release$previous" \
    '    build:' \
    '      args:' \
    "        GRAPHDB_IMAGE: public.ecr.aws/reactome/graphdb:Release$previous" \
    '    volumes:' \
    "      - graphdb-release$previous:/var/lib/neo4j/data" \
    'volumes:' \
    "  graphdb-release$previous: {}" > "$override" || {
    note "could not write $override"
    return 1
  }
  if [ "$(docker inspect -f '{{.Config.Image}} {{.State.Running}}' websiteangular-graphdb-1 2>/dev/null)" = "reactome/graphdb_readonly:Release$previous true" ]; then
    note "release $previous already serves"
    return 0
  fi
  local since waited=0
  since="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  dc -f docker-compose.yml -f "$override" up -d --no-build graphdb >/dev/null 2>&1 || {
    note "release $previous could not be started again"
    return 1
  }
  until docker logs --since "$since" websiteangular-graphdb-1 2>&1 | grep 'Started\.$' >/dev/null; do
    if [ "$(docker inspect -f '{{.State.Running}}' websiteangular-graphdb-1 2>/dev/null)" != true ] || [ "$waited" -ge "$GRAPH_WAIT" ]; then
      note "release $previous did not start again"
      return 1
    fi
    sleep 5
    waited=$((waited + 5))
  done
  note "release $previous serves again; docker-compose.yml still names $release:"
  note "revert that change before anything runs docker compose up (override kept: $override)"
}

# The state's directory: made private if new, and refused if anyone else could write
# to it -- never chmod-ed, which run as root on a chosen /tmp would have locked the host
# out of it. A record an earlier version of this script left in a shared directory is
# taken in only if it is a plain file this user owns, and only its well-formed lines.
state_dir() {
  local dir owner mode
  dir="$(dirname "$STATE")"
  [ -d "$dir" ] || mkdir -m 700 -p "$dir" || die "could not make $dir"
  owner="$(stat -c %u "$dir")" || die "could not read $dir"
  mode="$(stat -c %a "$dir")" || die "could not read $dir"
  [ "$owner" = "$EUID" ] && [ $((8#$mode & 8#022)) = 0 ] ||
    die "$dir is not yours alone (owner $owner, mode $mode): choose another NEXT_RELEASE_STATE"
  if [ -f "$OLD_STATE" ] && [ ! -L "$OLD_STATE" ] && [ ! -f "$STATE" ] &&
    [ "$(stat -c '%u:%h' "$OLD_STATE")" = "$EUID:1" ]; then
    # The old file goes only once its record is safely in place: kept if nothing in it
    # was a record, or the write failed (a full disk lost it).
    local record
    record="$(grep -E '^(host_neo4j=(active|inactive)|previous_release=[0-9]+)$' "$OLD_STATE" || true)"
    if [ -z "$record" ]; then
      note "$OLD_STATE holds no record; left as it is"
    elif printf '%s\n' "$record" > "$STATE.new" && mv "$STATE.new" "$STATE"; then
      rm -f "$OLD_STATE"
      note "the record of what served before moved to $STATE"
    else
      rm -f "$STATE.new" 2>/dev/null || true
      die "could not write $STATE; the record stays in $OLD_STATE"
    fi
  fi
}

do_switch() {
  [ "$(id -u)" = 0 ] || die "run with sudo"
  state_dir
  [ -f "$CONTENT_NODE_ENV_FILE" ] || die "no credentials file at $CONTENT_NODE_ENV_FILE (set CONTENT_NODE_ENV_FILE)"
  status
  if ! docker volume inspect "websiteangular_graphdb-release$release" >/dev/null 2>&1; then
    local free_kb
    free_kb="$(df --output=avail -k / | tail -1 | tr -d ' ')"
    [ "$free_kb" -gt $((5 * 1024 * 1024)) ] || die "under 5 GB free: the new graph's volume needs 3.2 GB (run cleanup, or free space)"
  fi

  # Already done (a second run, or one interrupted after the graph started): the
  # services are restarted and checked again, and nothing else is touched. Without
  # this, an unchanged container is left running by up -d, logs no new Started., and
  # the wait gave up and rolled back to the host database.
  if [ "$(docker inspect -f '{{.Config.Image}} {{.State.Running}}' websiteangular-graphdb-1 2>/dev/null)" = "reactome/graphdb_readonly:Release$release true" ] &&
    docker inspect -f '{{range .Mounts}}{{println .Name}}{{end}}' websiteangular-graphdb-1 2>/dev/null | grep -qx "websiteangular_graphdb-release$release" &&
    ! host_neo4j_active; then
    note "the graph already serves release $release"
    restart_services || {
      note "a service did not come up on release $release; nothing was changed in the graph"
      note "run switch again, or rollback"
      exit 1
    }
    say "Done: release $release"
    status
    return 0
  fi

  # The record is what rollback goes back to: kept from an earlier switch, it would send
  # a failed switch back to a release older than the one serving.
  # After a rollback to the recorded previous release, the record is current, and a
  # second attempt at this release is allowed.
  local serving recorded
  serving="$(docker inspect -f '{{.Config.Image}}' websiteangular-graphdb-1 2>/dev/null || true)"
  recorded="$(sed -nE 's/^previous_release=([0-9]+)$/\1/p' "$STATE" 2>/dev/null | head -1 || true)"
  if [ -f "$STATE" ] && ! host_neo4j_active &&
    [ "$serving" != "reactome/graphdb_readonly:Release$release" ] &&
    { [ -z "$recorded" ] || [ "$serving" != "reactome/graphdb_readonly:Release$recorded" ]; }; then
    die "the record of what served before ($STATE) is from an earlier switch: run cleanup first"
  fi

  say "Building the read-only image on the release's, and filling its volume"
  dc build --pull graphdb
  local volume="websiteangular_graphdb-release$release"
  local filled=/var/lib/neo4j/data/.next-release-filled
  local marked=''
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    # Asked for an answer, so a Docker error is not taken for "not filled", which would
    # remove the volume.
    marked="$(docker run --rm --entrypoint sh -v "$volume:/var/lib/neo4j/data" "reactome/graphdb_readonly:Release$release" \
      -c "if test -f $filled; then echo yes; else echo no; fi" 2>/dev/null || true)"
    case "$marked" in
      yes | no) ;;
      *) die "could not look inside $volume (docker run failed); nothing was changed" ;;
    esac
  fi
  if [ "$marked" = no ]; then
    # Not marked filled. The graph's own container was given it filled by Docker; any
    # other (a filler of ours killed part way) proves nothing.
    if [ -n "$(docker ps -aq --filter "volume=$volume" --filter label=com.docker.compose.service=graphdb)" ]; then
      docker run --rm --entrypoint sh -v "$volume:/var/lib/neo4j/data" "reactome/graphdb_readonly:Release$release" -c "touch $filled"
    else
      docker volume rm "$volume" >/dev/null || die "$volume is not marked filled and could not be removed"
      note "removed $volume, which an earlier run did not finish filling"
    fi
  fi
  if ! docker volume inspect "$volume" >/dev/null 2>&1; then
    # Filled by a container of its own, labelled as compose labels its volumes: the
    # serving graph keeps running while the release's 3.2 GB store is copied in.
    docker volume create --label com.docker.compose.project=websiteangular \
      --label "com.docker.compose.volume=graphdb-release$release" "$volume" >/dev/null
    # A volume left half-filled would be skipped by the next run and opened as it is:
    # failed or interrupted, it is removed.
    trap 'set +e; docker volume rm "$volume" >/dev/null 2>&1; exit 130' INT TERM HUP
    # Marked once the copy is done, so an interrupted fill is recognised next time
    # even if removing it failed.
    docker run --rm --entrypoint sh -v "$volume:/var/lib/neo4j/data" "reactome/graphdb_readonly:Release$release" -c "touch $filled" || {
      docker volume rm "$volume" >/dev/null 2>&1 && die "could not fill $volume; it is removed, and nothing else was changed"
      die "could not fill $volume, nor remove it; nothing else was changed (the next run removes it)"
    }
    trap - INT TERM HUP
    note "filled $volume"
  fi

  say "Stopping what serves the graph's port"
  # Only a switch away from the host database records it; a second switch keeps the
  # first one's record, so rollback still knows where it came from.
  if host_neo4j_active; then
    printf 'host_neo4j=active\n' > "$STATE"
    trap 'set +e; do_rollback; note "interrupted before the graph started"; exit 130' INT TERM HUP
    systemctl stop neo4j || { note "the host database did not stop cleanly"; do_rollback; exit 1; }
    systemctl disable neo4j >/dev/null 2>&1 || true
    note "host Neo4j stopped and disabled (its package stays: rollback starts it again)"
  elif [ ! -f "$STATE" ]; then
    # From one release's image to the next: the one serving is what rollback restores.
    {
      printf 'host_neo4j=inactive\n'
      case "$serving" in
        "reactome/graphdb_readonly:Release$release") ;;
        reactome/graphdb_readonly:Release[0-9]*) printf 'previous_release=%s\n' "${serving##*:Release}" ;;
      esac
    } > "$STATE"
  fi

  # From here, any failure goes back: each step says so itself.
  # Rollback first and with set -e off: after a hang-up the terminal is gone, and a
  # note written to it first failed and ended the script before the rollback.
  trap 'set +e; do_rollback; note "interrupted before the graph started"; exit 130' INT TERM HUP
  say "Starting the graph on release $release"
  local since
  since="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  dc up -d graphdb || { note "the graph could not be started"; do_rollback; exit 1; }
  local waited=0
  # This start's log only: an earlier start of the same container logged Started. too.
  until docker logs --since "$since" websiteangular-graphdb-1 2>&1 | grep 'Started\.$' >/dev/null; do
    if [ "$(docker inspect -f '{{.State.Running}}' websiteangular-graphdb-1 2>/dev/null)" != true ] || [ "$waited" -ge "$GRAPH_WAIT" ]; then
      note "the graph did not start; its last lines:"
      docker logs --tail 15 websiteangular-graphdb-1 2>&1 | grep -viE 'password|auth' | sed 's/^/    /' || true
      do_rollback
      exit 1
    fi
    sleep 5
    waited=$((waited + 5))
  done
  note "started after ${waited}s"
  # The graph serves now: an interruption leaves it serving, and a second run finishes.
  trap 'set +e; note "interrupted: the graph serves release $release; run switch again to finish, or rollback"; exit 130' INT TERM HUP

  if ! restart_services; then
    note "a service did not come up on release $release"
    do_rollback
    exit 1
  fi

  trap - INT TERM HUP
  say "Done: release $release"
  status
  local listeners
  listeners="$(ss -Hltn 'sport = :7687' 2>/dev/null | wc -l)"
  [ "$listeners" -le 1 ] || note "WARNING: $listeners listeners on 7687"
  cat <<EOF || true

Last, by hand, once the site looks right:
  1. Purge the edge cache by prefix /ContentService/ (Cloudflare dashboard).
  2. As yourself, not root:  node tools/content-node/warm.ts https://<site> $release
  3. When happy:             sudo bash deploy/graphdb/next-release.sh cleanup
EOF
}

do_cleanup() {
  [ "$(id -u)" = 0 ] || die "run with sudo"
  state_dir
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
  rollback) [ "$(id -u)" = 0 ] || die "run with sudo"; state_dir; do_rollback ;;
  cleanup) do_cleanup ;;
  *) echo "usage: sudo bash $0 check|switch|rollback|cleanup" >&2; exit 2 ;;
esac
