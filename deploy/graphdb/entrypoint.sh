#!/bin/bash
# Starts Reactome's graph database image with authentication on, using the
# credentials the services that read it already hold.
#
# The published image is built with authentication off, which is fine for a
# laptop and not for a server: anything that can reach the port could query it.
# Here the database keeps the user and password it has always had, so the
# services connecting to it need no change.
#
# The credentials file is read literally -- KEY=VALUE split at the first '=',
# trimmed, never evaluated -- exactly as tools/content-node/graph.ts reads it.
# A generated password holds characters a shell or compose's env_file parser
# would change, and both have produced an empty password here before.
set -euo pipefail

file="${GRAPHDB_CREDENTIALS_FILE:-/run/secrets/graphdb.env}"

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

user=''
password=''
while IFS= read -r line || [ -n "$line" ]; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" == *=* ]] || continue
  key="$(trim "${line%%=*}")"
  [ -n "$key" ] || continue
  value="$(trim "${line#*=}")"
  case "$key" in
    NEO4J_USER) user="$value" ;;
    NEO4J_PASSWORD) password="$value" ;;
  esac
done < "$file"

if [ -z "$user" ] || [ -z "$password" ]; then
  # Refuse rather than start open: the image's own default is no
  # authentication, and silently falling back to it is the failure to avoid.
  echo >&2 "graphdb: NEO4J_USER and NEO4J_PASSWORD not found in $file; not starting without authentication"
  exit 1
fi

# The image's entrypoint takes NEO4J_AUTH only as neo4j/<password>. Given
# anything else it prints the whole value -- password included -- to the
# container log and stops; a password ending /true would also expire on first
# use. So these are refused here, and the messages never name the values.
if [ "$user" != "neo4j" ]; then
  echo >&2 "graphdb: NEO4J_USER in $file must be neo4j for this image; not starting"
  exit 1
fi
if [[ "$password" == */* ]]; then
  echo >&2 "graphdb: NEO4J_PASSWORD in $file contains '/', which this image cannot take; not starting"
  exit 1
fi
if [ "$password" = "neo4j" ]; then
  echo >&2 "graphdb: NEO4J_PASSWORD in $file is the default, which this image refuses; not starting"
  exit 1
fi

export NEO4J_AUTH="$user/$password"
export NEO4J_dbms_security_auth__enabled=true
unset user password

# The image's own entrypoint. Overridable only so the parsing above can be
# tested without the image (deploy/graphdb/entrypoint.spec.ts).
if [ -n "${GRAPHDB_EXEC:-}" ]; then
  exec "$GRAPHDB_EXEC" "$@"
fi

# tini comes from the PATH: Reactome's Neo4j 4.3 image keeps it in /sbin, the
# 4.4 one in /usr/bin, and naming /sbin/tini made the move to 4.4 restart-loop
# on "/sbin/tini: No such file or directory". The entrypoint is the first of
# these the image has: 4.4's is /startup/docker-entrypoint.sh (with
# /docker-entrypoint.sh linked to it), 4.3's only /docker-entrypoint.sh.
IFS=':' read -r -a candidates <<< "${GRAPHDB_ENTRYPOINTS:-/startup/docker-entrypoint.sh:/docker-entrypoint.sh}"
for entrypoint in "${candidates[@]}"; do
  if [ -x "$entrypoint" ]; then
    exec tini -g -- "$entrypoint" "$@"
  fi
done
echo >&2 "graphdb: no entrypoint found in this image (looked for ${candidates[*]}); not starting"
exit 1
