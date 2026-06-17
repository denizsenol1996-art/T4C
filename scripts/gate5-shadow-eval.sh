#!/usr/bin/env bash
# gate5-shadow-eval.sh — one-shot wrapper voor RSPP Gate 5 shadow-analyse.
# Draait het read-only node-analyse-script en VERWIJDERT daarna zijn eigen
# cron-regel, zodat dit niet volgend jaar 18-06 opnieuw vuurt.
set -uo pipefail

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[$TS] Gate 5 shadow-eval start"

/usr/bin/node /opt/t4c/scripts/analyze-engine-shadow.js
RC=$?
echo "[$TS] node exit-code: $RC"

# Self-remove: strip alleen de regel die naar dit script verwijst.
if crontab -l 2>/dev/null | grep -q 'gate5-shadow-eval.sh'; then
  crontab -l 2>/dev/null | grep -v 'gate5-shadow-eval.sh' | crontab -
  echo "[$TS] cron-regel verwijderd (one-shot afgerond)"
fi

exit $RC
