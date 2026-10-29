#!/usr/bin/env bash
# The library service, checked end to end (spec 015 T063, T069): the image this
# repository builds, over each exporter's own fixture graph, its answers
# compared with the expected files of the commit it is pinned to, by that
# commit's own instruments:
# - SBML over sbml-exporter's fixture: the three events' files, by its
#   ci/compare.py;
# - BioPAX over BioPAX3Exporter's fixture: events of each kind and both
#   species, each contained in its species' expected file, by its
#   ci/contained.py, with the release's per-event xml:base.
#
# Usage: deploy/java-library/check.sh [image]
# GRAPH_PORT (7687) and FILES_PORT (8097) move the fixture graph and the files
# off ports a host already uses; the service keeps its own, 4360.
# Without an image, it builds one. Needs docker, curl and python3 with
# python-libsbml 5.21.2 (pip install python-libsbml==5.21.2).
set -euo pipefail

graph_port=${GRAPH_PORT:-7687}
files_port=${FILES_PORT:-8097}

# The check's own service takes 4360 on the host's network. One already there
# (a deployment's) would answer the checks below in its place, over its graph.
# Any answer refuses, a 503 too (a deployment whose graph is down), and it is
# refused before the trap below, whose clean-up would remove another run's
# containers.
if curl -s -m 5 -o /dev/null http://127.0.0.1:4360/health; then
  echo "Something already answers on 127.0.0.1:4360; stop it, or run this elsewhere" >&2
  exit 1
fi

root=$(cd "$(dirname "$0")/../.." && pwd)
image=${1:-}
work=$(mktemp -d)
# Named for this run, so a run that stops early removes only its own.
neo=java-library-check-graph-$$
service=java-library-check-$$
neo2=java-library-check-graph2-$$
service2=java-library-check2-$$
# shellcheck disable=SC2317 # called by the trap
cleanup() {
  docker rm -f -v "$neo" "$service" "$neo2" "$service2" >/dev/null 2>&1 || true
  if [ -n "${server:-}" ]; then kill "$server" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

if [ -z "$image" ]; then
  image=java-library-check
  docker build -q -f "$root/deploy/java-library/Dockerfile" -t "$image" "$root" >/dev/null
fi

# The fixture and the instruments, at the commit the image's library is built from.
commit=$(sed -n 's/^ARG SBML_EXPORTER_COMMIT=\([0-9a-f]\{40\}\)$/\1/p' "$root/deploy/java-library/Dockerfile" | sort -u)
[ "$(printf '%s\n' "$commit" | wc -l)" -eq 1 ] || { echo "The Dockerfile names more than one sbml-exporter commit" >&2; exit 1; }
mkdir "$work/sbml-exporter"
curl -fsSL "https://codeload.github.com/reactome/sbml-exporter/tar.gz/$commit" \
  | tar -xz -C "$work/sbml-exporter" --strip-components=1 --wildcards '*/ci/*'
ci="$work/sbml-exporter/ci"

# A fixture graph, on loopback: start_graph <container> <fixture.cypher>
start_graph() {
  docker run -d --name "$1" -p "127.0.0.1:$graph_port:7687" \
    -e NEO4J_AUTH=neo4j/fixturepass -e NEO4J_dbms_default__database=graph.db \
    -v "$2:/fixture.cypher:ro" neo4j:4.4.48-community >/dev/null
  for _ in $(seq 90); do
    docker exec "$1" cypher-shell -u neo4j -p fixturepass -d graph.db 'RETURN 1' >/dev/null 2>&1 && break
    sleep 2
  done
  docker exec "$1" cypher-shell -u neo4j -p fixturepass -d graph.db -f /fixture.cypher >/dev/null
}

# The service over it, answering its health check: start_service <container>
start_service() {
  docker run -d --name "$1" --network host \
    -e NEO4J_URI="bolt://127.0.0.1:$graph_port" -e NEO4J_USER=neo4j -e NEO4J_PASSWORD=fixturepass \
    -e DIAGRAM_BASE="http://127.0.0.1:$files_port/" -e SBML_CACHE=/cache "$image" >/dev/null
  for _ in $(seq 90); do
    curl -fs http://127.0.0.1:4360/health >/dev/null && break
    sleep 2
  done
  if ! curl -fsS http://127.0.0.1:4360/health; then
    echo "The service did not answer its health check. Its log:" >&2
    docker logs "$1" 2>&1 | tail -60 >&2
    exit 1
  fi
  echo
}

start_graph "$neo" "$ci/fixture/fixture.cypher"

# The release's download directory, as far as the fixture needs it.
mkdir -p "$work/www/97/diagram"
cp "$ci"/fixture/R-*.json "$work/www/97/diagram/"
python3 -m http.server "$files_port" --bind 127.0.0.1 --directory "$work/www" >/dev/null 2>&1 &
server=$!

start_service "$service"

status() { curl -s -o "$2" -w '%{http_code}' "http://127.0.0.1:4360/sbml/$1"; }
fail=0
mkdir "$work/out"
for id in $(find "$ci/fixture/expected" -name 'R-*.sbml' -exec basename {} .sbml \; | sort); do
  code=$(status "$id" "$work/out/$id.sbml")
  [ "$code" = 200 ] || { echo "$id: $code, expected 200" >&2; fail=1; }
done
code=$(status R-HSA-1 /dev/null)
[ "$code" = 404 ] || { echo "R-HSA-1 (not in the graph): $code, expected 404" >&2; fail=1; }
code=$(status R-HSA-9613354.1 /dev/null)
[ "$code" = 400 ] || { echo "R-HSA-9613354.1 (not a bare stable id): $code, expected 400" >&2; fail=1; }

python3 "$ci/validate.py" "$work/out" || fail=1
python3 "$ci/compare.py" "$ci/fixture/expected" "$work/out" || fail=1

# BioPAX, over BioPAX3Exporter's fixture graph (release 98), in a graph and a
# service of their own.
docker rm -f -v "$neo" "$service" >/dev/null
bcommit=$(sed -n 's/^ARG BIOPAX3_EXPORTER_COMMIT=\([0-9a-f]\{40\}\)$/\1/p' "$root/deploy/java-library/Dockerfile" | sort -u)
[ "$(printf '%s\n' "$bcommit" | wc -l)" -eq 1 ] || { echo "The Dockerfile names more than one BioPAX3Exporter commit" >&2; exit 1; }
mkdir "$work/BioPAX3Exporter"
curl -fsSL "https://codeload.github.com/reactome/BioPAX3Exporter/tar.gz/$bcommit" \
  | tar -xz -C "$work/BioPAX3Exporter" --strip-components=1 --wildcards '*/ci/*'
bci="$work/BioPAX3Exporter/ci"
start_graph "$neo2" "$bci/fixture/fixture.cypher"
start_service "$service2"

# Events of each kind and both species, chosen by the graph: the first of each by
# database id. Each line: stId, dbId, species.
events=$(docker exec "$neo2" cypher-shell -u neo4j -p fixturepass -d graph.db --format plain '
  CALL {
    MATCH (e:TopLevelPathway {speciesName: "Homo sapiens"}) RETURN e ORDER BY e.dbId LIMIT 1
    UNION ALL MATCH (e:Reaction {speciesName: "Homo sapiens"}) RETURN e ORDER BY e.dbId LIMIT 1
    UNION ALL MATCH (e:BlackBoxEvent {speciesName: "Homo sapiens"}) RETURN e ORDER BY e.dbId LIMIT 1
    UNION ALL MATCH (e:ReactionLikeEvent {dbId: 174731}) RETURN e
    UNION ALL MATCH (e:Pathway {speciesName: "Plasmodium falciparum"}) RETURN e ORDER BY e.dbId LIMIT 1
  }
  RETURN e.stId + " " + e.dbId + " " + replace(e.speciesName, " ", "_")' | tail -n +2 | tr -d '"')
[ "$(printf '%s\n' "$events" | wc -l)" -eq 5 ] || { echo "Expected five events in the fixture, got: $events" >&2; exit 1; }

bstatus() { curl -s -o "$2" -w '%{http_code}' "http://127.0.0.1:4360/biopax/$1"; }
mkdir -p "$work/owl/Homo_sapiens" "$work/owl/Plasmodium_falciparum"
while read -r id dbid species; do
  file="$work/owl/$species/$id.owl"
  code=$(bstatus "$id" "$file")
  [ "$code" = 200 ] || { echo "$id: $code, expected 200" >&2; fail=1; continue; }
  # The release's per-event base: Reactome's BioPAX namespace, the release, the event's database id
  grep -q "xml:base=\"http://www.reactome.org/biopax/98/$dbid#\"" "$file" \
    || { echo "$id: not the release's per-event xml:base" >&2; fail=1; }
done <<<"$events"
code=$(bstatus R-HSA-1 /dev/null)
[ "$code" = 404 ] || { echo "R-HSA-1 (not in the graph): $code, expected 404" >&2; fail=1; }
code=$(bstatus R-HSA-174731.1 /dev/null)
[ "$code" = 400 ] || { echo "R-HSA-174731.1 (not a bare stable id): $code, expected 400" >&2; fail=1; }

# Each event's file holds nothing its species' file lacks, and is whole
for species in Homo_sapiens Plasmodium_falciparum; do
  python3 -I "$bci/contained.py" "$bci/fixture/expected/$species.owl" "$work/owl/$species"/*.owl || fail=1
done
exit $fail
