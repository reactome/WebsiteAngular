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
# So this reproduces CI's conditions: a dry `npm ci`, the full gate sequence, and
# an end-to-end smoke against `ng serve` with a public backend and the render
# service pointed at a dead port.
#
#   npm run preflight          # everything (a few minutes)
#   npm run preflight -- fast  # skip the end-to-end smoke
#
# It is wired to pre-push. `git push --no-verify` skips it when you need it to.
set -uo pipefail

cd "$(dirname "$0")/.."
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
step "lockfile in sync (npm ci)" npm ci --dry-run --no-audit --no-fund
step "format" npm run format:check
step "types" npm run check:types
step "lint" npm run check:lint
step "dead code" npm run check:dead
step "unit tests" npm test

if [ "$mode" != "fast" ]; then
  echo
  echo "  End-to-end, in CI's configuration"
  echo "    ng serve + REACTOME_BACKEND=https://reactome.org + no render service"
  # RENDER_TARGET at a closed port is what makes CI's condition reproducible here:
  # this host runs a render service and CI does not, so the "absent service" path
  # is never otherwise exercised locally.
  # diagram-behaviour opens a diagram and waits on '#cytoscape canvas', which is
  # what the asset regression broke; downloads exercises the render service, which
  # is what the probe change broke. Chosen because each caught a real failure --
  # pathway-browser.spec.ts was in here first and caught neither.
  step "diagram + download smoke" env \
    REACTOME_BACKEND=https://reactome.org \
    RENDER_TARGET=http://127.0.0.1:1 \
    npx playwright test e2e/diagram-behaviour.spec.ts e2e/downloads.spec.ts --project=code --reporter=line
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
