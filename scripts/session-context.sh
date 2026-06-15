#!/bin/bash
# T4C SessionStart-context — wordt automatisch ingeladen bij elke claude-sessie in /opt/t4c.
# 100% read-only. Toont: bron van waarheid + harde regels + waar-we-waren + live-staat.
echo "═══════════ T4C SESSIE-START (automatisch ingeladen) ═══════════"
echo "📍 BRON VAN WAARHEID: /opt/t4c/docs/00-SYSTEEMKAART-T4C.md  (alles wat draait/gewired/dood is)"
echo "🖥️  COCKPIT (visueel, read-only): ssh -L 3300:127.0.0.1:3300 t4c → http://localhost:3300  (Admin / Prive12345!)"
echo
echo "⚠️  HARDE REGELS — NIET BREKEN:"
echo "   • live t4c.db = sql.js IN-MEMORY (export elke 30s). NOOIT extern met sqlite3 schrijven → wijzig via app-db-laag (run/forceSave) of met service gestopt."
echo "   • 1 fix per keer · backup vóór wijziging (bash /opt/t4c/scripts/t4c-backup.sh) · node --check na JS-edit · pm2 restart --update-env · daarna verifiëren."
echo "   • niks definitief wissen zonder OK · pricing-logica bevroren behalve geteste wijziging · nooit sed op server.js."
echo "   • t4c-server start traag (~10s, laadt 182MB in geheugen) → health pas na enkele seconden."
echo
echo "──────── WAAR WE WAREN (SESSION-STATE.md) ────────"
sed -n '1,45p' /opt/t4c/SESSION-STATE.md 2>/dev/null || echo "(geen SESSION-STATE.md)"
echo
echo "──────── LIVE STAAT NU (t4c-state.sh) ────────"
timeout 35 bash /opt/t4c/scripts/t4c-state.sh 2>/dev/null || echo "(t4c-state.sh timeout/fout — draai handmatig)"
echo "═══════════ EINDE AUTO-CONTEXT ═══════════"
