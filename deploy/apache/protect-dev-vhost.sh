#!/usr/bin/env bash
#
#   sudo ~/protect-dev-vhost.sh
#
# Two things:
#
#  1. The bot blocks are currently only on the beta vhosts. The flood is landing
#     on dev.reactome.org, which has none of them -- 300 requests/second walking
#     /content/schema/instance/browser/ across every species, each one an
#     expensive Neo4j query. This installs the same rules there.
#
#  2. The access log still shows Cloudflare addresses because vhost_combined
#     logs %h. %a is the remoteip-aware one. This adds a format that uses it, so
#     the log finally names real clients.
#
# Backs up everything it touches; restores and reloads nothing if configtest fails.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo $0"; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
CONF="/etc/apache2/sites-common/beta-bot-blocks.conf"
INCLUDE_LINE="  Include /etc/apache2/sites-common/beta-bot-blocks.conf"
DEV_VHOSTS=(/etc/apache2/sites-available/001-reactome.conf)
BACKUPS=()
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }

[ -f "$CONF" ] || { echo "$CONF missing -- run install-beta-bot-blocks.sh first"; exit 1; }

say "1. Protecting the dev.reactome.org vhost"
for v in "${DEV_VHOSTS[@]}"; do
  [ -f "$v" ] || { echo "  $v not found, skipping"; continue; }
  if grep -qF "beta-bot-blocks.conf" "$v"; then ok "$(basename "$v") already includes the rules"; continue; fi
  cp -a "$v" "$v.bak.$STAMP"; BACKUPS+=("$v")
  awk -v line="$INCLUDE_LINE" '
    /<\/VirtualHost>/ && !done { print line; done = 1 }
    { print }
  ' "$v" > "$v.new" && mv "$v.new" "$v"
  ok "added to $(basename "$v") (backup: $v.bak.$STAMP)"
done

say "2. Making the access log show real client IPs"
LOGCONF="/etc/apache2/conf-available/cloudflare-remoteip.conf"
if ! grep -q "vhost_combined_real" "$LOGCONF" 2>/dev/null; then
  cat >> "$LOGCONF" <<'EOF'

# vhost_combined logs %h, which still shows the proxy. %a is the remoteip-aware
# field, so this format names the actual client.
LogFormat "%v:%p %a %l %u %t \"%r\" %>s %O \"%{Referer}i\" \"%{User-Agent}i\"" vhost_combined_real
EOF
  ok "added a vhost_combined_real format"
fi
OVH="/etc/apache2/conf-available/other-vhosts-access-log.conf"
if [ -f "$OVH" ] && ! grep -q vhost_combined_real "$OVH"; then
  cp -a "$OVH" "$OVH.bak.$STAMP"; BACKUPS+=("$OVH")
  sed -i 's/vhost_combined$/vhost_combined_real/' "$OVH"
  ok "other_vhosts_access.log now uses it (backup: $OVH.bak.$STAMP)"
fi

say "Testing config"
if ! apache2ctl configtest; then
  for b in "${BACKUPS[@]}"; do cp -a "$b.bak.$STAMP" "$b"; done
  echo "  configtest FAILED -- everything restored, nothing reloaded"
  exit 1
fi
ok "valid"

say "Reloading"
systemctl reload apache2
ok "reloaded"

say "Checking the rules apply on dev.reactome.org too"
for ua in "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0 Safari/537.36|browser" \
          "Mozilla/5.0 (compatible; GPTBot/1.2)|GPTBot" \
          "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amzn-SearchBot/0.1)|Amzn-SearchBot"; do
  agent="${ua%|*}"; label="${ua#*|}"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -A "$agent" https://dev.reactome.org/ || echo 000)
  printf '  %-16s -> %s\n' "$label" "$code"
done

say "Done. Give it a minute of traffic, then:  sudo ~/traffic-report.sh"
