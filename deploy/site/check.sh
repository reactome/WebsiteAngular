#!/bin/bash
# The site's image serves what beta serves (specs/032 T008): /health names the
# bundle it was built with, / is the application's page with the deployment
# SITE_PROFILE names written into it (release, and production for reactome.org,
# T034; an unknown name stops it), the page's own script is served, and so is
# the embeddable diagram.
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
containers=()
trap 'docker rm -f "${containers[@]}" >/dev/null 2>&1' EXIT
# The image as a deployment would run it, on $1's port, named as $2 says.
start() {
  docker run -d --network host -e PORT="$1" -e SITE_PROFILE="$2" \
    -e HEALTH_CONTENT_NODE=$down -e HEALTH_RENDER=$down -e HEALTH_MCP=$down \
    ${SITE_CHECK_ARGS:-} "$image"
}
container=$(start "$port" release)
containers+=("$container")

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

# The same image is reactome.org's, named production (specs/032 T034), and a
# name it does not know stops it rather than serving as some other deployment.
prod_port=$((port + 1))
prod=$(start "$prod_port" production)
containers+=("$prod")
page=''
for _ in $(seq 60); do
  page=$(curl -sf "http://127.0.0.1:$prod_port/") && break
  sleep 0.5
done
grep -qF '<script>window.__APP_ENV="production";</script>' <<<"$page" ||
  fail "production's / does not name production"
echo "ok   SITE_PROFILE=production is served, named production"

unknown=$(start "$((port + 2))" prod)
containers+=("$unknown")
code=$(timeout 30 docker wait "$unknown") || fail "an unknown SITE_PROFILE is still running after 30 s"
[ "$code" = 1 ] || fail "an unknown SITE_PROFILE exited $code, not 1"
docker logs "$unknown" 2>&1 | grep -qF 'SITE_PROFILE "prod"' ||
  fail "an unknown SITE_PROFILE stopped without saying why"
echo "ok   an unknown SITE_PROFILE stops the start"

script=$(grep -oE 'src="main-[A-Za-z0-9]+\.js"' <<<"$page" | head -1 | cut -d'"' -f2)
[ -n "$script" ] || fail "/ names no main script"
type=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$base/$script")
[[ $type == "200 "*javascript* ]] || fail "$script answered $type"
echo "ok   its script is served"

type=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$base/embed/diagram/v1/reactome-diagram.js")
[[ $type == "200 "*javascript* ]] || fail "the embeddable diagram answered $type"
echo "ok   the embeddable diagram is served"

# The image serves beta, the release server and reactome.org, so the diagram's
# code must load its chunks and pictures from the host that served it, not from
# an address written into the build (spec 009, T043): main.js and every chunk
# it reaches name no host's /embed/diagram/v1/.
named=$(node -e '
  const base = process.argv[1] + "/embed/diagram/v1/";
  const seen = new Set(), named = [];
  (async () => {
    const queue = ["main.js"];
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file)) continue;
      seen.add(file);
      const res = await fetch(base + file);
      if (!res.ok) throw new Error(file + " answered " + res.status);
      const text = await res.text();
      for (const m of text.matchAll(/https?:\/\/[^"\x27`)\s]*\/embed\/diagram\/v1\//g))
        named.push(file + ": " + m[0]);
      for (const m of text.matchAll(/\.\/(chunk-[A-Z0-9]+\.js)/g)) queue.push(m[1]);
    }
    if (seen.size < 2) throw new Error("main.js reaches no chunk");
    console.log(named.join("\n"));
  })().catch((e) => { console.error(e.message); process.exit(1); });
' "$base") || fail "could not read the diagram's code"
[ -z "$named" ] || fail "the diagram's code names a host: $named"
echo "ok   the diagram's code loads from the host that serves it"

# Pages written for the old diagram widget load it from its old address
# (spec 009, T048): the loader, not the site's page.
type=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$base/DiagramJs/diagram/diagram.nocache.js")
[[ $type == "200 "*javascript* ]] || fail "the old widget's address answered $type"
echo "ok   the old widget's address is served"
