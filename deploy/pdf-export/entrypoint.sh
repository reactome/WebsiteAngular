#!/bin/bash
# The PDF service's start (deploy/pdf-export): the graph's settings from the
# file named by PDF_EXPORT_ENV_FILE, then the command given.
#
# pdf-export reads the graph's settings from its environment alone
# (NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, NEO4J_DATABASE). The credentials are
# in the file content-node and the library service read, KEY=VALUE lines read
# literally (tools/content-node/graph.ts, the library's Settings.fromFile): a
# generated password holds characters a shell eats, and compose's own env_file
# once handed content-node an empty one. So the file is never sourced: each
# line's key is what comes before its first '=', its value the rest, each
# trimmed; a line starting '#' (after spaces), or with no key, is skipped. Only
# the graph's four settings are taken, and a value the environment already
# gives wins, as the library service's settings do.
set -euo pipefail

file=${PDF_EXPORT_ENV_FILE:-}
if [ -n "$file" ]; then
  # A file that is named must be readable: a mount the service cannot read is
  # otherwise reported only as the graph refusing it.
  if [ ! -r "$file" ]; then
    echo "PDF_EXPORT_ENV_FILE names $file, which cannot be read" >&2
    exit 1
  fi
  trim() {
    local text=$1
    text=${text#"${text%%[![:space:]]*}"}
    text=${text%"${text##*[![:space:]]}"}
    printf '%s' "$text"
  }
  while IFS= read -r line || [ -n "$line" ]; do
    case "$(trim "$line")" in '#'*) continue ;; esac
    key=${line%%=*}
    # No '=', or nothing before it
    if [ "$key" = "$line" ] || [ -z "$key" ]; then continue; fi
    key=$(trim "$key")
    value=$(trim "${line#*=}")
    case "$key" in
      NEO4J_URI | NEO4J_USER | NEO4J_PASSWORD | NEO4J_DATABASE)
        # One word, expanded once: the value is taken as it is written.
        if [ -z "${!key:-}" ]; then export "$key=$value"; fi
        ;;
    esac
  done <"$file"
fi

exec "$@"
