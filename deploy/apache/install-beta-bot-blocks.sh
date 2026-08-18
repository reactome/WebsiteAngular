#!/usr/bin/env bash
#
# Installs the beta.reactome.org bot blocks into Apache and verifies them.
#
#   sudo ~/install-beta-bot-blocks.sh            # install
#   sudo ~/install-beta-bot-blocks.sh --check    # verify only, change nothing
#   sudo ~/install-beta-bot-blocks.sh --undo     # remove again
#
# Safe to run twice: it skips work already done. Every file it edits is backed
# up first, and if Apache's own config test fails it restores the backups and
# leaves the server exactly as it found it -- the vhost stays up either way.

set -euo pipefail

SRC="/home/awright/git/WebsiteAngular/deploy/apache/beta-bot-blocks.conf"
DEST="/etc/apache2/sites-common/beta-bot-blocks.conf"
INCLUDE_LINE="  Include /etc/apache2/sites-common/beta-bot-blocks.conf"
VHOSTS=(
  /etc/apache2/sites-available/002-beta-reactome.conf
  /etc/apache2/sites-available/002-beta-reactome-le-ssl.conf
)
STAMP="$(date +%Y%m%d-%H%M%S)"
MODE="${1:-install}"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo: sudo $0 ${*:-}"

# --- verification, used by every mode -------------------------------------
verify() {
  say "Checking behaviour (through Apache directly, so this works even if Cloudflare is unhappy)"
  local browser bot
  # https, not http: port 80 answers 301 before the rewrite rules run, so an
  # http check reports 301 for bots and browsers alike and proves nothing.
  browser=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
    -A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' \
    https://beta.reactome.org/ || echo 000)
  bot=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
    -A 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)' \
    https://beta.reactome.org/ || echo 000)

  printf '  browser user agent -> %s\n' "$browser"
  printf '  GPTBot user agent  -> %s\n' "$bot"

  [ "$bot" = "403" ] && ok "bots are refused" || warn "expected 403 for GPTBot, got $bot"
  case "$browser" in
    200|301|302|304) ok "a real browser still gets through" ;;
    403) die "a real browser is being blocked -- run with --undo and tell Claude" ;;
    000) warn "no answer at all: the backend may be down, which is not this config's doing" ;;
    *)   warn "browser got $browser (not a block, but worth a look)" ;;
  esac
}

if [ "$MODE" = "--check" ]; then
  [ -f "$DEST" ] && ok "config is installed at $DEST" || warn "config is NOT installed"
  for v in "${VHOSTS[@]}"; do
    grep -qF "beta-bot-blocks.conf" "$v" 2>/dev/null \
      && ok "included by $(basename "$v")" \
      || warn "not included by $(basename "$v")"
  done
  verify
  exit 0
fi

if [ "$MODE" = "--undo" ]; then
  say "Removing the bot blocks"
  for v in "${VHOSTS[@]}"; do
    if grep -qF "beta-bot-blocks.conf" "$v" 2>/dev/null; then
      cp -a "$v" "$v.bak.$STAMP"
      sed -i '\|beta-bot-blocks\.conf|d' "$v"
      ok "removed the Include from $(basename "$v") (backup: $v.bak.$STAMP)"
    fi
  done
  rm -f "$DEST" && ok "removed $DEST"
  apache2ctl configtest || die "config test failed after removal -- restore from the .bak files above"
  systemctl reload apache2 && ok "apache reloaded"
  exit 0
fi

# --- install ---------------------------------------------------------------
say "Installing the bot blocks"
[ -f "$SRC" ] || die "Cannot find $SRC -- is the repo checked out at that path?"

install -m 0644 "$SRC" "$DEST"
ok "copied the rules to $DEST"

CHANGED=()
for v in "${VHOSTS[@]}"; do
  [ -f "$v" ] || { warn "$(basename "$v") does not exist, skipping"; continue; }
  if grep -qF "beta-bot-blocks.conf" "$v"; then
    ok "$(basename "$v") already includes it"
    continue
  fi
  cp -a "$v" "$v.bak.$STAMP"
  # Insert just before the vhost closes, so the rules live inside the block.
  awk -v line="$INCLUDE_LINE" '
    /<\/VirtualHost>/ && !done { print line; done = 1 }
    { print }
  ' "$v" > "$v.new" && mv "$v.new" "$v"
  CHANGED+=("$v")
  ok "added the Include to $(basename "$v") (backup: $v.bak.$STAMP)"
done

say "Testing the Apache config before touching the running server"
if ! apache2ctl configtest; then
  warn "config test FAILED -- undoing everything"
  for v in "${CHANGED[@]}"; do cp -a "$v.bak.$STAMP" "$v"; done
  rm -f "$DEST"
  die "restored the previous config; nothing was reloaded, the site is unaffected"
fi
ok "config is valid"

say "Reloading Apache"
systemctl reload apache2
ok "reloaded (a reload finishes in-flight requests; it does not drop connections)"

verify

say "Done"
cat <<'NOTE'
  Re-check any time with:   sudo ~/install-beta-bot-blocks.sh --check
  Undo completely with:     sudo ~/install-beta-bot-blocks.sh --undo

  This blocks self-identified bots. It does not fix the other half: Tomcat is
  configured -Xmx6G and was reaching 7.9 GB within minutes, exiting on
  OutOfMemoryError and restarting cold. Fewer bots means that happens less
  often, not that it stops happening.
NOTE
