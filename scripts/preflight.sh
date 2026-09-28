#!/usr/bin/env bash
#
# Run what CI runs, the way CI runs it, before pushing.
#
# Three CI failures in one day all lived in the same blind spot: local checks ran
# against beta.reactome.org -- a deployed site with a real backend and a render
# service running -- while CI runs `ng serve` against a remote backend with no
# local services at all. Nothing verified locally could have caught them:
#
#   * a lockfile out of sync with package.json    (only `npm ci` compares them)
#   * diagram assets resolving to an unproxied
#     local path under `ng serve`                 (never used against a deployed site)
#   * a probe treating a refused connection as
#     a failure rather than an absent service     (this machine runs a render service)
#
# So this reproduces CI's conditions: a dry `npm ci` with CI's own flags, the full
# gate sequence, and an end-to-end smoke against `ng serve` with a public backend
# and the render service pointed at a dead port.
#
# It runs on the Node in `.nvmrc`, selecting it itself -- see
# `scripts/select-node.sh`, and note that you do not need to `nvm use` first. The
# lockfile check is the step that makes this matter: npm 11 records optional
# platform packages that npm 10 leaves out, so on an older Node it reports a
# desync CI will not see and misses one CI would.
#
#   npm run preflight          # everything (a few minutes)
#   npm run preflight -- fast  # skip the app build and the end-to-end smoke
#
# Fast mode is for iterating, not for deciding you are done. The smoke it skips
# is the only check that downloads a file and looks inside it, so a change to an
# exporter can sit in the tree with fast mode reporting all clear -- which is
# exactly what happened to the PowerPoint work.
#
# It is wired to pre-push. `git push --no-verify` skips it when you need it to.
set -uo pipefail

cd "$(dirname "$0")/.."

# The Node this runs on is not necessarily the one you chose in your terminal:
# hooks, editors and agent harnesses all use non-interactive shells, which do
# not load nvm. Resolve it first, because every step below is version-sensitive
# and none of them fails in a way that names the version.
. scripts/select-node.sh || exit 1

mode=${1:-full}
failed=()

step() {
  local name=$1; shift
  printf '  %-34s ' "$name"
  if output=$("$@" 2>&1); then
    echo "ok"
  else
    echo "FAILED"
    failed+=("$name")
    printf '%s\n' "$output" | tail -12 | sed 's/^/      /'
  fi
}

echo
echo "Preflight"

# `npm ci` is the only thing that compares the lockfile against package.json; a
# desynced lock is invisible to `npm ls` and fatal in CI.
#
# No `--legacy-peer-deps` any more, here or in the workflows. It was covering one
# conflict: this repo pinned vitest 3.2.7 while `@angular/build` wants `^4.0.8`.
# vitest is on 4 now and the tree resolves honestly, so a peer error here is a
# real one.
step "lockfile in sync (npm ci)" npm ci --dry-run --no-audit --no-fund
# ...and that it did not quietly re-resolve the tree, which the step above
# cannot see: a wholesale regeneration satisfies package.json perfectly.
step "lockfile drift" npm run check:lockfile
step "format" npm run format:check
# Types, lint, dead code and the unit tests all resolve the workspace libraries
# from dist/, so without this they check whatever was built there last -- which
# may not be this tree -- while CI builds them fresh.
step "libraries" npm run build:libs
step "types" npm run check:types
step "lint" npm run check:lint
step "dead code" npm run check:dead
step "unit tests" npm test
step "e2e recordings" npm run check:har

# The app build is the only check that runs Angular's template type checking
# and the bundle budgets; a broken template and a blown budget have both passed
# every step above and failed in CI. It builds into a directory of its own:
# beta is served from this working tree's dist/reactome, and building over it
# would serve a half-written site, of the wrong profile, for the whole push.
if [ "$mode" != "fast" ]; then
  app_build=$(mktemp -d)
  step "app build" npm run build -- --output-path "$app_build"
  rm -rf -- "$app_build"
fi

if [ "$mode" != "fast" ]; then
  echo
  echo "  End-to-end, in CI's configuration"
  echo "    ng serve + recorded fixtures + no render service"
  # REACTOME_BACKEND is a closed port on purpose. Backend data comes from the
  # recordings in e2e/har, so nothing here talks to a server -- and if a request
  # ever escapes them it fails at once instead of quietly reaching production.
  # This step used to name https://reactome.org, which meant the pre-push hook
  # called the public site on every push by every developer, not just CI.
  #
  # RENDER_TARGET at a closed port is what makes CI's condition reproducible here:
  # this host runs a render service and CI does not, so the "absent service" path
  # is never otherwise exercised locally.
  # diagram-behaviour opens a diagram and waits on '#cytoscape canvas', which is
  # what the asset regression broke; downloads exercises the render service, which
  # is what the probe change broke. Chosen because each caught a real failure --
  # pathway-browser.spec.ts was in here first and caught neither.
  #
  # E2E_PORT is what makes this check the working tree rather than whatever is
  # already serving on 4200. Without it, playwright reuses an existing server --
  # and on a host that keeps a deployed build there, this step silently tested
  # that build instead of the commit about to be pushed (#243). It cost a
  # `--no-verify` push on a branch that was in fact fine, and it could as easily
  # have waved through one that was not.
  step "diagram + download smoke" env \
    E2E_PORT=4201 \
    REACTOME_BACKEND=http://127.0.0.1:9 \
    RENDER_TARGET=http://127.0.0.1:1 \
    npx playwright test e2e/diagram-behaviour.spec.ts e2e/downloads.spec.ts --project=code --reporter=line

  # The render tests, for real. CI has no render service and no data, so the
  # tests that need one skip there (e2e/expected-skips.json) -- which is how a
  # bug in the renderer reached beta (#317). Where this machine has the backend
  # (Tomcat on 8080), they run here against a render service started from THIS
  # working tree, drawing pages from a dev server of this working tree. Not the
  # render container: that is the deployed renderer, drawing beta's deployed
  # pages, so it would test what is already live rather than what is about to
  # be pushed. The data comes from the local backend; the pages it draws load
  # their icons and fonts as they always do.
  #
  # Only when the push touches what a figure is made from -- it adds minutes,
  # and a pre-push that runs long enough makes GitHub drop the waiting push.
  # PREFLIGHT_RENDER=always runs it regardless.
  render_paths='^(tools/render/|projects/pathway-browser/src/app/(render|diagram|ehld|reacfoam)/|projects/pathway-browser/src/app/details/tabs/download-tab/|projects/reactome-cytoscape-style/|e2e/(downloads|download-feedback|detail-contents)\.spec\.ts$|e2e/fixtures/serves\.ts$|proxy\.conf\.js$|scripts/preflight\.sh$)'
  # With no origin/main to compare against, what changed is unknown: run it.
  if render_base=$(git merge-base HEAD origin/main 2>/dev/null); then
    render_touched=$(
      { git diff --name-only "$render_base"...HEAD; git diff --name-only HEAD; } 2>/dev/null |
        grep -E "$render_paths" | head -1
    )
  else
    render_touched="(no origin/main to compare with)"
  fi
  if [ "${PREFLIGHT_RENDER:-}" != "always" ] && [ -z "$render_touched" ]; then
    echo
    echo "  render, live: skipped -- nothing a figure is made from changed"
  elif ! curl -fsS -m 5 http://localhost:8080/ContentService/data/database/version >/dev/null 2>&1; then
    echo
    echo "  render, live: skipped -- no local backend on :8080 to draw from"
  elif curl -fsS -m 2 http://127.0.0.1:4312/health >/dev/null 2>&1; then
    # Something already answers on 4312 -- most likely a service an interrupted
    # run left behind, drawing with an older tree. Testing it would test that.
    printf '  %-34s FAILED\n' "render, live"
    echo "      port 4312 is already serving a render service; stop it and push again"
    failed+=("render, live")
  else
    render_cache=$(mktemp -d)
    RENDER_PORT=4312 RENDER_BASE=http://localhost:4202 RENDER_CACHE="$render_cache" \
      node tools/render/service.mjs >"$render_cache/service.log" 2>&1 &
    render_pid=$!
    # A hook is not an interactive shell, so Ctrl-C does not reach a background
    # job: without this an abandoned push leaves the service running.
    trap 'kill "$render_pid" 2>/dev/null; rm -rf -- "$render_cache"' EXIT
    trap 'exit 130' INT TERM
    render_up=""
    for _ in $(seq 1 60); do
      kill -0 "$render_pid" 2>/dev/null || break
      curl -fsS -m 2 http://127.0.0.1:4312/health >/dev/null 2>&1 && { render_up=1; break; }
      sleep 1
    done
    # Refused, not skipped: with no service the render tests skip themselves and
    # the step would read "ok" having checked nothing.
    if [ -z "$render_up" ]; then
      printf '  %-34s FAILED\n' "render, live"
      echo "      the render service did not start; its log:"
      tail -12 "$render_cache/service.log" | sed 's/^/      /'
      failed+=("render, live")
    else
      step "render, live" env \
      E2E_PORT=4202 \
      RENDER_TARGET=http://127.0.0.1:4312 \
      E2E_REQUIRE_RENDER=1 \
      npx playwright test e2e/downloads.spec.ts e2e/download-feedback.spec.ts e2e/detail-contents.spec.ts \
      --project=code --reporter=line
    fi
    kill "$render_pid" 2>/dev/null
    wait "$render_pid" 2>/dev/null
    rm -rf -- "$render_cache"
    trap - EXIT INT TERM
  fi
fi

echo
if [ ${#failed[@]} -eq 0 ]; then
  echo "  All clear. CI should agree."
  echo
  exit 0
fi
echo "  ${#failed[@]} failed: ${failed[*]}"
echo "  Fix these rather than pushing and reading the email."
echo
exit 1
