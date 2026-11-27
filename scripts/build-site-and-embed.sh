#!/usr/bin/env bash
#
# The site and the embeddable diagram, the last step of `npm run build` and
# `npm run build:beta` (spec 009, T043):
#
#   scripts/build-site-and-embed.sh <site configuration> <diagram configuration> [--output-path <root>]
#
# One output path, for both. npm hands a script's extra arguments to its last
# command only, so while the two builds were the npm script's last two
# commands, `npm run build -- --output-path <dir>` moved one of them and left
# the other building into dist/ -- which a deployment serving from the working
# tree publishes, and which Angular empties before it builds. So the path given
# is a root laid out as dist/ is: the site in <root>/reactome, the diagram in
# <root>/reactome-diagram, which is where serve-prod.js looks for it beside the
# site. Any other argument is refused rather than handed to one build alone.
#
# BUILD_DRY_RUN=1 prints the two builds instead of running them
# (deploy/site/embed.spec.ts).
set -euo pipefail

usage() {
  echo "usage: $0 <site configuration> <diagram configuration> [--output-path <root>]" >&2
  exit 2
}

[ $# -ge 2 ] && [ -n "$1" ] && [ -n "$2" ] && [[ $1 != -* ]] && [[ $2 != -* ]] || usage
site_configuration=$1
diagram_configuration=$2
shift 2

root=
while [ $# -gt 0 ]; do
  case $1 in
    --output-path | --output-path=*)
      [ -z "$root" ] || { echo "$0: one --output-path, for both builds" >&2; exit 2; }
      if [ "$1" = --output-path ]; then
        [ $# -ge 2 ] && [ -n "$2" ] || usage
        root=$2
        shift 2
      else
        root=${1#--output-path=}
        [ -n "$root" ] || usage
        shift
      fi
      ;;
    *)
      echo "$0: $1: not taken; only --output-path <root>, which moves both builds" >&2
      exit 2
      ;;
  esac
done

site=(npx ng build reactome --configuration "$site_configuration")
diagram=(npx ng build reactome-diagram-element --configuration "$diagram_configuration")
if [ -n "$root" ]; then
  site+=(--output-path "${root%/}/reactome")
  diagram+=(--output-path "${root%/}/reactome-diagram")
fi

if [ -n "${BUILD_DRY_RUN:-}" ]; then
  echo "${site[*]}"
  echo "${diagram[*]}"
  exit 0
fi
"${site[@]}"
"${diagram[@]}"
