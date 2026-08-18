#!/usr/bin/env bash
#
#   sudo ~/raise-apache-workers.sh
#
# Apache is capped at MaxRequestWorkers 150 and sits pinned at ~149 connections
# with its accept queue full, while Tomcat answers in 12ms and the app server in
# 2ms. Nothing is overloaded except Apache's own connection limit: Cloudflare
# alone holds hundreds of keep-alive connections to an origin, so 150 was never
# enough, and the scraper traffic just made it obvious.
#
# This raises the ceiling to 600 (24 processes x 25 threads) and trims the
# keep-alive timeout so idle proxy connections stop occupying slots.
#
# mpm_event threads are cheap here -- Apache only proxies, it renders nothing --
# so 600 costs on the order of tens of MB, against 281 MB in use today.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo $0"; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
MPM="/etc/apache2/mods-available/mpm_event.conf"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }

say "Before"
grep -E "MaxRequestWorkers|ThreadsPerChild|ServerLimit" "$MPM" | grep -v '^\s*#' | sed 's/^/  /'
printf '  connections now: %s (queue %s waiting)\n' \
  "$(ss -tn state established '( sport = :80 or sport = :443 )' | tail -n +2 | wc -l)" \
  "$(ss -ltn | awk '/:443 /{print $2}')"

cp -a "$MPM" "$MPM.bak.$STAMP"
ok "backed up to $MPM.bak.$STAMP"

say "Writing new limits"
cat > "$MPM" <<'EOF'
# Raised from the stock MaxRequestWorkers 150 after the origin spent an evening
# refusing connections while both backends answered in milliseconds. Behind
# Cloudflare, hundreds of keep-alive connections are normal, so 150 slots is the
# bottleneck rather than a safety limit.
#
# MaxRequestWorkers must equal ServerLimit x ThreadsPerChild.
<IfModule mpm_event_module>
	StartServers			 4
	MinSpareThreads		 75
	MaxSpareThreads		 250
	ThreadLimit			 64
	ThreadsPerChild		 25
	ServerLimit			 24
	MaxRequestWorkers	 600
	MaxConnectionsPerChild	 10000
</IfModule>
EOF
ok "MaxRequestWorkers 150 -> 600"

# Idle proxy connections should not hold a slot for long.
KA="/etc/apache2/apache2.conf"
if grep -qE '^\s*KeepAliveTimeout\s+5' "$KA"; then
  cp -a "$KA" "$KA.bak.$STAMP"
  sed -i 's/^\s*KeepAliveTimeout\s\+5/KeepAliveTimeout 2/' "$KA"
  ok "KeepAliveTimeout 5 -> 2 (backup: $KA.bak.$STAMP)"
fi

say "Testing config"
if ! apache2ctl configtest; then
  cp -a "$MPM.bak.$STAMP" "$MPM"
  [ -f "$KA.bak.$STAMP" ] && cp -a "$KA.bak.$STAMP" "$KA"
  echo "  configtest FAILED -- restored, nothing reloaded"
  exit 1
fi
ok "valid"

say "Restarting (a reload will not apply MPM changes)"
systemctl restart apache2
sleep 4
ok "restarted"

say "After"
grep -E "MaxRequestWorkers|ServerLimit" "$MPM" | grep -v '^\s*#' | sed 's/^/  /'
sleep 6
printf '  connections now: %s (queue %s waiting)\n' \
  "$(ss -tn state established '( sport = :80 or sport = :443 )' | tail -n +2 | wc -l)" \
  "$(ss -ltn | awk '/:443 /{print $2}')"
for u in "https://beta.reactome.org/|beta" "https://dev.reactome.org/|dev"; do
  url="${u%|*}"; label="${u#*|}"
  printf '  %-5s -> %s\n' "$label" "$(curl -s -o /dev/null -w '%{http_code} (%{time_total}s)' --max-time 30 "$url" || echo 000)"
done
