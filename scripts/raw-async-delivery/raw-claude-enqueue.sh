#!/usr/bin/env bash
# raw-claude-enqueue.sh — PIGGYBACK enqueue into a LIVE Claude Code session's
# per-session mailbox (addressed by sessionId). Writes the message only; the
# session's Stop hook (cc-mailbox-rewake.sh) PULLS it at the NEXT turn boundary.
# For ACTIVE idle-wake (poke the watched signal too), use cc-enqueue-addressed.sh.
#
# COST: FREE. Just writes a file. (Claude Code has NO local external-push API; its
#       --remote-control is cloud-bridged through Anthropic, a different path.)
# LIVE SSOT: ~/.claude/sessions/<pid>.json with matching sessionId + status
#            (idle|busy), kind=interactive. NOT db/wal files.
# ENV: CC_MAILBOX_ROOT (default ~/.claude/mailbox).
# USAGE: raw-claude-enqueue.sh <session_id> <message...>
set -euo pipefail
SID="${1:?session_id}"; shift
CONTENT="${*:?message}"
LIVE=$(python3 - "$SID" <<'PY'
import json,glob,os,sys
sid=sys.argv[1]
for f in glob.glob(os.path.expanduser("~/.claude/sessions/*.json")):
    try: d=json.load(open(f))
    except: continue
    if d.get("sessionId")==sid:
        print(f"pid={d['pid']} status={d.get('status')} kind={d.get('kind')}"); break
PY
)
[ -n "$LIVE" ] || { echo "session $SID not live (no marker in ~/.claude/sessions/)" >&2; exit 1; }
MB="${CC_MAILBOX_ROOT:-$HOME/.claude/mailbox}/$SID"; mkdir -p "$MB"
TS=$(date -u +%Y%m%dT%H%M%S%N)
printf '%s\n' "$CONTENT" > "$MB/$TS.msg"
echo "enqueued -> live $SID ($LIVE) :: $MB/$TS.msg"
