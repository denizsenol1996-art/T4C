#!/bin/bash
# T4C PostToolUse-hook — logt elke Edit/Write naar de maand-changelog zodat wijzigingen
# zichzelf bijhouden. Faalt ALTIJD stil (exit 0) → kan een claude-sessie nooit blokkeren.
IN=$(cat 2>/dev/null)
echo "$IN" | python3 -c "
import sys, json, datetime, os
try:
    d = json.load(sys.stdin)
    ti = d.get('tool_input', {}) or {}
    f = ti.get('file_path') or ti.get('path') or ''
    tool = d.get('tool_name', '?')
    if f:
        os.makedirs('/opt/t4c/data/claude-log', exist_ok=True)
        ts = datetime.datetime.utcnow()
        line = '- ' + ts.strftime('%Y-%m-%d %H:%M UTC') + ' — ' + tool + ': ' + f + '\n'
        with open('/opt/t4c/data/claude-log/' + ts.strftime('%Y-%m') + '.md', 'a') as fh:
            fh.write(line)
except Exception:
    pass
" 2>/dev/null
exit 0
