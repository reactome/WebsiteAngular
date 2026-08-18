#!/usr/bin/env bash
#
#   sudo ~/enable-real-ips.sh
#
# Makes Apache see the real client instead of Cloudflare.
#
# Every request currently arrives from a Cloudflare address, so the access log
# attributes all of it to Cloudflare and any IP-based rule matches Cloudflare
# rather than the client. That is why the flood cannot be identified: 578
# connections from 393 Cloudflare IPs tell us nothing about who is behind them.
#
# mod_remoteip reads the real address out of the CF-Connecting-IP header, but
# only trusts it from Cloudflare's own ranges, so it cannot be spoofed by
# anything connecting directly.
#
# Backs up what it changes and restores it if Apache's config test fails.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo $0"; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
CONF="/etc/apache2/conf-available/cloudflare-remoteip.conf"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }

say "Writing $CONF"
cat > "$CONF" <<'EOF'
# Real client IPs from Cloudflare. Ranges from https://www.cloudflare.com/ips/
# -- refresh when Cloudflare announces a change.
<IfModule mod_remoteip.c>
  RemoteIPHeader CF-Connecting-IP
  RemoteIPTrustedProxy 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22
  RemoteIPTrustedProxy 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18
  RemoteIPTrustedProxy 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22
  RemoteIPTrustedProxy 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13
  RemoteIPTrustedProxy 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22
  RemoteIPTrustedProxy 2400:cb00::/32 2606:4700::/32 2803:f800::/32
  RemoteIPTrustedProxy 2405:b500::/32 2405:8100::/32 2a06:98c0::/29
  RemoteIPTrustedProxy 2c0f:f248::/32

  # %a is the restored client address; the stock combined format uses %h, which
  # would keep showing Cloudflare.
  LogFormat "%a %l %u %t \"%r\" %>s %O \"%{Referer}i\" \"%{User-Agent}i\"" cloudflare
</IfModule>
EOF
ok "written"

say "Enabling the module and config"
a2enmod -q remoteip || true
a2enconf -q cloudflare-remoteip || true
ok "enabled"

say "Pointing the beta vhosts' access log at the new format"
for v in /etc/apache2/sites-available/002-beta-reactome.conf \
         /etc/apache2/sites-available/002-beta-reactome-le-ssl.conf; do
  [ -f "$v" ] || continue
  if grep -q 'CustomLog.*cloudflare' "$v"; then ok "$(basename "$v") already uses it"; continue; fi
  cp -a "$v" "$v.bak.$STAMP"
  if grep -q 'CustomLog' "$v"; then
    sed -i 's|\(CustomLog[^\n]*\) combined|\1 cloudflare|' "$v"
    ok "$(basename "$v") switched to the cloudflare format (backup: $v.bak.$STAMP)"
  else
    ok "$(basename "$v") has no CustomLog of its own; it inherits the global one"
  fi
done

say "Testing config"
if ! apache2ctl configtest; then
  a2disconf -q cloudflare-remoteip || true
  echo "  config test failed -- disabled again, nothing reloaded"
  exit 1
fi
ok "valid"

say "Restarting"
systemctl restart apache2
sleep 3
ok "restarted"

say "Who is actually hitting the site (10 seconds of fresh log)"
sleep 10
LOG=$(ls -t /var/log/apache2/*access*.log 2>/dev/null | head -1)
echo "  log: $LOG"
echo "  --- top client IPs (these are real clients now, not Cloudflare) ---"
tail -3000 "$LOG" | awk '{print $1}' | sort | uniq -c | sort -rn | head -10
echo "  --- top user agents ---"
tail -3000 "$LOG" | grep -oE '"[^"]*"$' | sort | uniq -c | sort -rn | head -8
echo "  --- most requested paths ---"
tail -3000 "$LOG" | awk '{print $7}' | sort | uniq -c | sort -rn | head -8
