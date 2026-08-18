#!/usr/bin/env bash
#
#   sudo ~/traffic-report.sh
#
# Writes a traffic summary to ~/apache-traffic-report.txt, readable without
# sudo, so it can be looked at without copying anything out of the terminal.
# Run it after enable-real-ips.sh, when the client addresses are real.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo $0"; exit 1; }

OUT="/home/awright/apache-traffic-report.txt"
LOG="${LOG_OVERRIDE:-$(ls -t /var/log/apache2/*access*.log 2>/dev/null | head -1)}"
LINES="${1:-20000}"

# other_vhosts_access.log prefixes every line with "vhost:port", so the client
# address is field 2 there and field 1 in a normal access log. Detect which,
# rather than guessing and reporting the vhost name as the top talker.
if tail -5 "$LOG" | awk '{print $1}' | grep -qE ':(80|443)$'; then
  IPF=2
else
  IPF=1
fi

{
  echo "generated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo "log: $LOG   (last $LINES lines, client address in field $IPF)"
  echo "remoteip: $([ -f /etc/apache2/conf-enabled/cloudflare-remoteip.conf ] && echo 'enabled - addresses below are real clients' || echo 'NOT enabled - addresses below are Cloudflare, not clients')"

  echo
  echo "== requests per minute, last 15 minutes =="
  tail -"$LINES" "$LOG" | awk '{split($4,a,":"); print a[2]":"a[3]}' | sort | uniq -c | tail -15

  echo
  echo "== top 20 client IPs =="
  tail -"$LINES" "$LOG" | awk -v f=$IPF '{print $f}' | sort | uniq -c | sort -rn | head -20

  echo
  echo "== top 15 user agents =="
  tail -"$LINES" "$LOG" | sed -n 's/.*"\([^"]*\)"$/\1/p' | sort | uniq -c | sort -rn | head -15

  echo
  echo "== top 20 requested paths =="
  tail -"$LINES" "$LOG" | awk -v f=$IPF '{print $(f+6)}' | cut -c1-90 | sort | uniq -c | sort -rn | head -20

  echo
  echo "== response codes =="
  tail -"$LINES" "$LOG" | awk -v f=$IPF '{print $(f+8)}' | sort | uniq -c | sort -rn | head -10

  echo
  echo "== chrome versions seen (a real population clusters on the latest few) =="
  tail -"$LINES" "$LOG" | grep -oE 'Chrome/[0-9]+' | sort | uniq -c | sort -rn | head -12

  echo
  echo "== platform mix =="
  tail -"$LINES" "$LOG" | grep -oE '\(Windows NT [0-9._]+|\(Macintosh|\(X11|\(iPhone|\(Linux' | sort | uniq -c | sort -rn | head -6

  echo
  echo "== busiest IPs: what are they asking for? =="
  for ip in $(tail -"$LINES" "$LOG" | awk -v f=$IPF '{print $f}' | sort | uniq -c | sort -rn | head -3 | awk '{print $2}'); do
    echo "--- $ip ($(tail -"$LINES" "$LOG" | awk -v i="$ip" -v f=$IPF '$f==i' | wc -l) requests) ---"
    tail -"$LINES" "$LOG" | awk -v i="$ip" -v f=$IPF '$f==i' | sed -n 's/.*"\([^"]*\)"$/  ua: \1/p' | sort -u | head -3
    tail -"$LINES" "$LOG" | awk -v i="$ip" -v f=$IPF '$f==i {print "  path: "$(f+6)}' | cut -c1-90 | sort | uniq -c | sort -rn | head -5
  done
} > "$OUT" 2>&1

chmod 644 "$OUT"
chown awright:awright "$OUT" 2>/dev/null || true
echo "Written to $OUT"
echo "Tell Claude it is ready; it can read that file directly."
