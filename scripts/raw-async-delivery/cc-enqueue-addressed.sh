#!/usr/bin/env bash
# cc-enqueue-addressed.sh — ADDRESSED async delivery to ONE live Claude Code
# session, by sessionId. Only that session's per-session watchPath matches, so
# ONLY that session wakes and processes — siblings stay idle and undisturbed.
#
# COST: free (file writes + the target's own subscription-session continuation).
# LIVE SSOT: ~/.claude/sessions/<pid>.json whose sessionId == <session_id>.
# PAIRS WITH: watch-sessionstart.sh (per-session watchPath) + watch-filechanged.sh.
# USAGE: [CC_MAILBOX_ROOT=<root>] cc-enqueue-addressed.sh <session_id> <message...>
set -euo pipefail
SID="${1:?session_id (target one specific live session)}"; shift
CONTENT="${*:?message}"
ROOT="${CC_MAILBOX_ROOT:-$HOME/.claude/mailbox}"

# Verify the target is a live interactive session and surface its identity.
LIVE=$(python3 - "$SID" <<'PY'
import json, glob, os, sys
sid = sys.argv[1]
for f in glob.glob(os.path.expanduser("~/.claude/sessions/*.json")):
    try:
        d = json.load(open(f))
    except Exception:
        continue
    if d.get("sessionId") == sid:
        print(f"pid={d['pid']} status={d.get('status')} cwd={d.get('cwd')}")
        break
PY
)
[ -n "$LIVE" ] || { echo "session $SID not live (no marker in ~/.claude/sessions/)" >&2; exit 1; }

DIR="$ROOT/$SID"; mkdir -p "$DIR"
TS=$(date -u +%Y%m%dT%H%M%S%N)
printf '%s\n' "$CONTENT" > "$DIR/$TS.msg"
printf 'ping %s\n' "$(date -u +%s%N)" >> "$DIR/inbox.signal"   # poke ONLY this session's signal
echo "delivered -> $SID ($LIVE) :: $DIR/$TS.msg"
