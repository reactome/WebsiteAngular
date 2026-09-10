#!/usr/bin/env bash
#
# Routes beta.reactome.org/chat to the React-to-Me chatbot container on :8000.
#
#   sudo ./install-beta-chat-proxy.sh            # install
#   sudo ./install-beta-chat-proxy.sh --check    # verify only, change nothing
#   sudo ./install-beta-chat-proxy.sh --undo     # remove again
#
# Safe to run twice: it skips work already done. Every file it edits is backed
# up first, and if Apache's own config test fails it restores the backups and
# reloads nothing -- so a bad rule cannot take the beta vhost down.
#
# Unlike beta-bot-blocks.conf, the Include goes at the TOP of each vhost. Apache
# matches ProxyPass rules in source order, and these vhosts already proxy / to
# the Angular server, so an Include at the bottom would never fire.

set -euo pipefail

SRC="/home/awright/git/WebsiteAngular/deploy/apache/beta-chat-proxy.conf"
DEST="/etc/apache2/sites-common/beta-chat-proxy.conf"
INCLUDE_LINE="  Include /etc/apache2/sites-common/beta-chat-proxy.conf"
VHOSTS=(
  /etc/apache2/sites-available/002-beta-reactome.conf
  /etc/apache2/sites-available/002-beta-reactome-le-ssl.conf
)
BACKEND="http://127.0.0.1:8000/chat/"
STAMP="$(date +%Y%m%d-%H%M%S)"
MODE="${1:-install}"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo: sudo $0 ${*:-}"

verify() {
  say "Checking the backend is actually up"
  local direct
  direct=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BACKEND" || true)
  printf '  %s -> %s\n' "$BACKEND" "$direct"
  case "$direct" in
    200) ok "chatbot container is answering" ;;
    000) warn "nothing is listening on :8000 -- start the container, or /chat will 503" ;;
    *)   warn "backend answered $direct" ;;
  esac

  say "Checking beta.reactome.org/chat/ through Apache"
  local through
  through=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
    -A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' \
    https://beta.reactome.org/chat/ || true)
  printf '  https://beta.reactome.org/chat/ -> %s\n' "$through"

  # The Angular wildcard also answers 200, so a status code alone proves
  # nothing. The landing page is the only thing that says React-to-Me.
  local body
  body=$(curl -s --max-time 20 \
    -A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' \
    https://beta.reactome.org/chat/ || true)
  if grep -qi 'React-to-Me' <<<"$body"; then
    ok "/chat/ is served by the chatbot"
  elif grep -qi '<title>Reactome</title>' <<<"$body"; then
    warn "/chat/ is still the Angular app -- the Include may be below the catch-all ProxyPass"
  else
    warn "/chat/ returned something unrecognised"
  fi
}

# proxy_wstunnel is the one that is usually missing, and it is the one Chainlit
# cannot work without -- socket.io upgrades to a websocket.
modules_ok() {
  local missing=()
  for m in proxy proxy_http proxy_wstunnel rewrite; do
    a2query -m "$m" >/dev/null 2>&1 || missing+=("$m")
  done
  if [ ${#missing[@]} -eq 0 ]; then
    ok "required modules enabled (proxy, proxy_http, proxy_wstunnel, rewrite)"
    return 0
  fi
  if [ "${1:-}" = "--enable" ]; then
    say "Enabling missing Apache modules: ${missing[*]}"
    a2enmod "${missing[@]}" >/dev/null
    ok "enabled ${missing[*]} (reload happens below)"
    return 0
  fi
  warn "missing Apache modules: ${missing[*]}"
  printf '    enable with: sudo a2enmod %s\n' "${missing[*]}"
  return 1
}

if [ "$MODE" = "--check" ]; then
  [ -f "$DEST" ] && ok "config installed at $DEST" || warn "config is NOT installed"
  for v in "${VHOSTS[@]}"; do
    grep -qF "beta-chat-proxy.conf" "$v" 2>/dev/null \
      && ok "included in $(basename "$v")" \
      || warn "NOT included in $(basename "$v")"
  done
  modules_ok || true
  verify
  exit 0
fi

BACKUPS=()
restore() {
  warn "restoring backups"
  for b in "${BACKUPS[@]}"; do
    cp -a "$b" "${b%.bak.*}"
  done
}

if [ "$MODE" = "--undo" ]; then
  say "Removing the /chat proxy"
  for v in "${VHOSTS[@]}"; do
    [ -f "$v" ] || continue
    cp -a "$v" "$v.bak.$STAMP"; BACKUPS+=("$v.bak.$STAMP")
    sed -i '\|Include /etc/apache2/sites-common/beta-chat-proxy.conf|d' "$v"
    ok "include removed from $(basename "$v")"
  done
  rm -f "$DEST" && ok "removed $DEST"
elif [ "$MODE" = "install" ]; then
  say "Installing the /chat proxy"
  modules_ok --enable

  install -D -m 0644 "$SRC" "$DEST"
  ok "installed $DEST"

  for v in "${VHOSTS[@]}"; do
    [ -f "$v" ] || { warn "no such vhost: $v"; continue; }
    if grep -qF "beta-chat-proxy.conf" "$v"; then
      ok "already included in $(basename "$v")"
      continue
    fi
    cp -a "$v" "$v.bak.$STAMP"; BACKUPS+=("$v.bak.$STAMP")
    # Insert immediately after the <VirtualHost ...> opening tag so these
    # ProxyPass rules precede the vhost's own catch-all.
    awk -v line="$INCLUDE_LINE" '
      /^[[:space:]]*<VirtualHost/ && !done { print; print line; done = 1; next }
      { print }
    ' "$v" > "$v.new" && mv "$v.new" "$v"
    ok "included at the top of $(basename "$v")"
  done
else
  die "unknown mode: $MODE (use --check or --undo)"
fi

say "Testing Apache config"
if apache2ctl configtest 2>&1 | tee /dev/stderr | grep -qi "Syntax OK"; then
  ok "syntax OK"
else
  restore
  die "configtest failed -- backups restored, nothing reloaded"
fi

systemctl reload apache2 && ok "apache reloaded"
verify
