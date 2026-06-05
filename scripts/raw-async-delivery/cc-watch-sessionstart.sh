#!/usr/bin/env bash
# cc-watch-sessionstart.sh — settings.json SessionStart hook (ADDRESSED).
# Registers a PER-SESSION mailbox signal as a watchPath so FileChanged fires
# when an external actor enqueues to THIS session — even while it is IDLE.
# session_id arrives on stdin; the watchPath is <root>/<session_id>/inbox.signal.
# A sender that targets one session's signal wakes ONLY that session.
# Pair with cc-watch-filechanged.sh. ENV: CC_MAILBOX_ROOT (default ~/.claude/mailbox).
IN=$(cat)
SID=$(printf '%s' "$IN" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("session_id",""))' 2>/dev/null)
[ -n "$SID" ] || { printf '{}\n'; exit 0; }
ROOT="${CC_MAILBOX_ROOT:-$HOME/.claude/mailbox}"
DIR="$ROOT/$SID"; mkdir -p "$DIR"
SIG="$DIR/inbox.signal"; [ -f "$SIG" ] || : > "$SIG"
echo "$(date +%H:%M:%S) SESSIONSTART armed sid=$SID watch=$SIG" >> "$DIR/hook.log"
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","watchPaths":["%s"]}}\n' "$SIG"
