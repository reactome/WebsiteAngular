# Put the Node that `.nvmrc` asks for on PATH, or say plainly why it is not.
#
# Source this; do not run it. It edits PATH in the calling shell.
#
#   . scripts/select-node.sh || exit 1
#
# Why this exists. nvm is a shell function loaded from `~/.bashrc`, and the
# stock `~/.bashrc` returns early when the shell is not interactive. Git hooks
# are not interactive -- husky runs them with `sh -e` -- so a hook sees whatever
# node the operating system ships, not the one you selected in your terminal.
# Editors, cron and agent harnesses are in the same position.
#
# That is not a theoretical mismatch. Under Ubuntu's Node 18 this repository
# fails in four different places, none of which names the cause:
#
#   npm ci        prints its usage page, because the flags are newer than npm 9
#   check:dead    "knip produced no parseable report: Unexpected end of JSON input"
#   npm test      vitest dies loading its config with ERR_REQUIRE_ESM
#   e2e           "Playwright requires Node.js 20 or higher"
#   lint-staged   TypeError: util.styleText is not a function
#
# Reading those, the natural conclusion is that the tree is broken. It is not.
#
# Deliberately not `nvm use`. nvm is bash/zsh shell code and hooks run under
# `sh`, so this resolves the binary directly from nvm's directory instead --
# which also works for anyone who installed Node another way, as long as the
# version on PATH is new enough.
#
# Written POSIX: it is sourced by `sh` hooks and by bash scripts alike.

_sn_root=$(git rev-parse --show-toplevel 2>/dev/null) || _sn_root=
[ -n "$_sn_root" ] || _sn_root=$PWD

# No version file, nothing to enforce. Not this repository's business.
if [ ! -f "$_sn_root/.nvmrc" ]; then
  unset _sn_root
  return 0 2>/dev/null || exit 0
fi

# `.nvmrc` may say `24`, `v24` or `24.15.0`; the major is what matters, and it
# is the same number as `engines.node` in package.json.
_sn_want=$(head -1 "$_sn_root/.nvmrc" | tr -d ' \t\r') || _sn_want=
_sn_want=${_sn_want#v}
_sn_want_major=${_sn_want%%.*}

# An empty or unreadable file pins nothing. Do not invent a requirement from it.
if [ -z "$_sn_want_major" ]; then
  unset _sn_root _sn_want _sn_want_major
  return 0 2>/dev/null || exit 0
fi

# The `|| _sn_have=` matters: hooks run under `sh -e`, and an unguarded
# assignment from a command that is not installed exits the shell there and
# then -- silently, which is the failure this file exists to stop.
_sn_have=$(node -v 2>/dev/null) || _sn_have=
_sn_have=${_sn_have#v}
_sn_have_major=${_sn_have%%.*}

# Already good enough: say nothing at all, so the common case stays quiet.
if [ -n "$_sn_have_major" ] && [ "$_sn_have_major" -ge "$_sn_want_major" ] 2>/dev/null; then
  unset _sn_root _sn_want _sn_want_major _sn_have _sn_have_major
  return 0 2>/dev/null || exit 0
fi

# Otherwise look through nvm's installed versions. An exact major match wins:
# preflight's lockfile step compares against npm 11, and a newer Node brings a
# newer npm that records optional platform packages differently -- reporting a
# desync CI will not see. A newer major is the fallback, not the preference.
#
# `sort -V` is what orders 24.9 before 24.15; a plain sort does not.
_sn_best=
_sn_best_v=
_sn_exact=
_sn_exact_v=
for _sn_bin in "${NVM_DIR:-$HOME/.nvm}"/versions/node/v*/bin/node; do
  [ -x "$_sn_bin" ] || continue
  _sn_v=${_sn_bin%/bin/node}
  _sn_v=${_sn_v##*/v}
  _sn_m=${_sn_v%%.*}
  [ "$_sn_m" -ge "$_sn_want_major" ] 2>/dev/null || continue
  if [ -z "$_sn_best" ] ||
    [ "$(printf '%s\n%s\n' "$_sn_best_v" "$_sn_v" | sort -V | tail -1)" = "$_sn_v" ]; then
    _sn_best=$_sn_bin
    _sn_best_v=$_sn_v
  fi
  if [ "$_sn_m" = "$_sn_want_major" ] &&
    { [ -z "$_sn_exact" ] ||
      [ "$(printf '%s\n%s\n' "$_sn_exact_v" "$_sn_v" | sort -V | tail -1)" = "$_sn_v" ]; }; then
    _sn_exact=$_sn_bin
    _sn_exact_v=$_sn_v
  fi
done

# The exact major if it is installed; otherwise the newest that satisfies it.
if [ -n "$_sn_exact" ]; then
  _sn_best=$_sn_exact
  _sn_best_v=$_sn_exact_v
fi

if [ -n "$_sn_best" ]; then
  PATH="${_sn_best%/node}:$PATH"
  export PATH
  echo "  node: using v$_sn_best_v from nvm (PATH had ${_sn_have:-none}, .nvmrc asks for $_sn_want)"
  unset _sn_root _sn_want _sn_want_major _sn_have _sn_have_major _sn_best _sn_best_v _sn_exact _sn_exact_v _sn_bin _sn_v _sn_m
  return 0 2>/dev/null || exit 0
fi

# Nothing suitable. One honest message beats five confusing ones.
echo "  node: this repository needs Node $_sn_want_major or newer; PATH has ${_sn_have:-no node at all}." >&2
echo "        Nothing under ${NVM_DIR:-$HOME/.nvm}/versions/node fits either." >&2
echo "        With nvm:  nvm install && nvm use          (reads .nvmrc)" >&2
echo "        Otherwise: install Node $_sn_want_major and put it ahead on PATH." >&2
unset _sn_root _sn_want _sn_want_major _sn_have _sn_have_major _sn_best _sn_best_v _sn_exact _sn_exact_v _sn_bin _sn_v _sn_m
return 1 2>/dev/null || exit 1
