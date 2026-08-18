#!/usr/bin/env bash
# Full restart of Apache, for when it has stopped accepting connections.
#
#   sudo ~/fix-apache.sh
#
# A reload only re-reads config; it does not recycle workers that have stopped
# draining the accept queue. This restarts the service and then checks that the
# bot rules are still doing their job afterwards.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo $0"; exit 1; }

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }

say "Before"
printf '  accept queue : %s\n' "$(ss -ltn | awk '/:80 /{print $2" waiting, backlog "$3}')"
printf '  connections  : %s\n' "$(ss -tn state established '( sport = :80 or sport = :443 )' | tail -n +2 | wc -l)"

say "Checking config first"
apache2ctl configtest

say "Restarting"
systemctl restart apache2
sleep 3
ok "restarted"

say "After"
printf '  accept queue : %s\n' "$(ss -ltn | awk '/:80 /{print $2" waiting, backlog "$3}')"
for ua in "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0 Safari/537.36|browser" \
          "Mozilla/5.0 (compatible; GPTBot/1.2)|GPTBot"; do
  agent="${ua%|*}"; label="${ua#*|}"
  # https, not http: port 80 answers 301 before the rewrite rules run, so an
  # http check reports 301 for bots and browsers alike and proves nothing.
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -A "$agent" https://beta.reactome.org/ || echo 000)
  printf '  %-8s -> %s\n' "$label" "$code"
done

say "Externally"
curl -s -o /dev/null -w '  beta.reactome.org -> %{http_code} (%{time_total}s)\n' --max-time 30 https://beta.reactome.org/ || true
