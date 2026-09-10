#!/usr/bin/env bash
#
# Where each branch's build actually goes, and how old each one is.
#
# This exists because a whole day's verification was aimed at the wrong URL.
# deploy.yml publishes under a release number it computes at build time:
#
#   main   ->  <prod release + 1>/website/     the next release's artifact
#   prod   ->  <prod release>/website/         the current release's artifact
#
# Reading the `aws s3 sync` line alone suggests one path; the version step above
# it decides which. So anything checking a published artifact should ask this
# rather than assume, and anything reporting on one should name the URL it used.
#
#   npm run deployed
set -uo pipefail

prod=$(curl -sf --max-time 20 https://reactome.org/ContentService/data/database/version || echo "")
if [ -z "$prod" ]; then
  echo "  could not reach reactome.org for the current release number"
  exit 1
fi
next=$((prod + 1))

echo
echo "Current release, per reactome.org: $prod"
echo

report() {
  local label=$1 url=$2
  local hdr code modified
  hdr=$(curl -sk -D - -o /dev/null --max-time 25 "$url" 2>/dev/null)
  code=$(printf '%s' "$hdr" | head -1 | awk '{print $2}')
  modified=$(printf '%s' "$hdr" | grep -i '^last-modified:' | tr -d '\r' | cut -d' ' -f2-)
  printf '  %-26s %s\n' "$label" "$url"
  printf '  %-26s HTTP %s   %s\n' "" "${code:-?}" "${modified:-no last-modified}"
}

report "main publishes here" "https://download.reactome.org/$next/website/index.html"
report "prod publishes here" "https://download.reactome.org/$prod/website/index.html"

echo
echo "  beta.reactome.org serves dist/reactome/browser from this checkout,"
echo "  not the bucket -- ~/rebuild-beta.sh --check compares those two."
echo
echo "  A published artifact is served from the bucket, which has no backend, so"
echo "  it reaches the host named in SITE_PROFILES.production -- not its own"
echo "  origin. Check what it actually calls before concluding anything:"
echo "    the network panel, or a request log, on the URL above."
echo
