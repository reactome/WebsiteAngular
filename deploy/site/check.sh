#!/bin/bash
# The site's image serves what beta serves (specs/032 T008): /health names the
# bundle it was built with, / is the application's page with the deployment
# SITE_PROFILE names written into it, the page's own script is served, and so
# is the embeddable diagram.
#
# The services behind it are pointed at a closed port: the image must serve
# without them (it reports them down, it does not fail), which is how a host
# finds it during a restart of everything else.
#
#     deploy/site/check.sh <image>
set -euo pipefail
image=${1:-site}
port=${SITE_CHECK_PORT:-4299}
base="http://127.0.0.1:$port"
down=http://127.0.0.1:9/health
container=$(docker run -d --network host -e PORT="$port" -e SITE_PROFILE=release \
  -e HEALTH_CONTENT_NODE=$down -e HEALTH_RENDER=$down -e HEALTH_MCP=$down \
  ${SITE_CHECK_ARGS:-} "$image")
trap 'docker rm -f "$container" >/dev/null 2>&1' EXIT

fail() {
  echo "FAIL: $*"
  docker logs "$container" 2>&1 | tail -10 | sed 's/^/     /'
  exit 1
}

health=''
for _ in $(seq 60); do
  health=$(curl -sf "$base/health") && break
  sleep 0.5
done
[ -n "$health" ] || fail "no /health in 30 s"
node -e '
  const h = JSON.parse(process.argv[1]);
  if (h.ok !== true) throw new Error("not ok: " + process.argv[1]);
  if (typeof h.bundle !== "string" || !/^[A-Z0-9]{8}$/.test(h.bundle)) throw new Error("no bundle: " + process.argv[1]);
' "$health" || fail "/health: $health"
echo "ok   /health names its bundle"

page=$(curl -sf "$base/") || fail "/ did not answer"
grep -q '<app-root' <<<"$page" || fail "/ is not the application's page"
grep -qF '<script>window.__APP_ENV="release";</script>' <<<"$page" || fail "/ does not name the deployment"
echo "ok   / is the application, named as SITE_PROFILE says"

script=$(grep -oE 'src="main-[A-Za-z0-9]+\.js"' <<<"$page" | head -1 | cut -d'"' -f2)
[ -n "$script" ] || fail "/ names no main script"
type=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$base/$script")
[[ $type == "200 "*javascript* ]] || fail "$script answered $type"
echo "ok   its script is served"

type=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$base/embed/diagram/v1/reactome-diagram.js")
[[ $type == "200 "*javascript* ]] || fail "the embeddable diagram answered $type"
echo "ok   the embeddable diagram is served"
