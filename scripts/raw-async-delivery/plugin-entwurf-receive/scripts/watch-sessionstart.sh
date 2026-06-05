#!/usr/bin/env bash
# watch-sessionstart.sh — plugin SessionStart hook (ADDRESSED / per-session).
#
# WHY A PLUGIN AND NOT A BARE SKILL:
#   A bare ~/.claude/skills/<name>/ skill registers its hooks only when the
#   model *invokes* the skill (mid-session, via getPromptForCommand). By then
#   SessionStart has already fired, so a skill-declared SessionStart hook never
#   runs and watchPaths is never armed. A PLUGIN's hooks/hooks.json is loaded at
#   startup, so THIS SessionStart hook actually fires and arms the watch.
#
# ADDRESSED DELIVERY (the whole point of this version):
#   The watchPath is PER-SESSION: <root>/<session_id>/inbox.signal. session_id
#   arrives on stdin (Claude Code hook envelope). A sender that pokes ONE
#   session's signal wakes ONLY that session — not every live session. This is
#   the entwurf sessionId-addressing model: "send to the one you want, only it
#   processes." A fixed shared signal would broadcast and bother everyone.
#
# ENV: CC_MAILBOX_ROOT  mailbox root (default ~/.claude/mailbox)
IN=$(cat)
SID=$(printf '%s' "$IN" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("session_id",""))' 2>/dev/null)
[ -n "$SID" ] || { printf '{}\n'; exit 0; }   # no session id -> nothing to address
ROOT="${CC_MAILBOX_ROOT:-$HOME/.claude/mailbox}"
DIR="$ROOT/$SID"
mkdir -p "$DIR"
SIG="$DIR/inbox.signal"; [ -f "$SIG" ] || : > "$SIG"
echo "$(date +%H:%M:%S) SESSIONSTART armed sid=$SID watch=$SIG" >> "$DIR/hook.log"
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","watchPaths":["%s"]}}\n' "$SIG"
