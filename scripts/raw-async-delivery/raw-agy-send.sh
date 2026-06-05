#!/usr/bin/env bash
# raw-agy-send.sh — deliver a message INTO a LIVE agy (Antigravity CLI) session.
#
# COST: FREE. Injects into an already-running *subscription* session; the host
#       wakes the bound main model (e.g. Gemini 3.1 Pro) as an in-session
#       continuation. No new process, no `-p`, no credit draw.
# LIVE SSOT: `pgrep -x agy` (process) + an LS socket that answers
#            get-conversation-metadata. NOT db-shm/db-wal (those vanish on
#            WAL checkpoint while the session is still live).
# USAGE: raw-agy-send.sh <conversation_id> <message...>
set -euo pipefail
CONV="${1:?conversation_id}"; shift
CONTENT="${*:?message content}"
AGY="${AGY_BIN:-$HOME/.local/bin/agy}"

PID=$(pgrep -x agy | head -1) || true
[ -n "${PID:-}" ] || { echo "no live agy process (target not live)" >&2; exit 1; }

# LS port is per-process; resolve at delivery time by probing which port answers.
LS=""
for p in $(ss -lntp 2>/dev/null | grep "pid=${PID}," | grep -oE '127\.0\.0\.1:[0-9]+' | cut -d: -f2); do
  if ANTIGRAVITY_LS_ADDRESS="127.0.0.1:$p" timeout 8 "$AGY" agentapi \
        get-conversation-metadata "$CONV" 2>/dev/null | grep -q conversationMetadata; then
    LS="127.0.0.1:$p"; break
  fi
done
[ -n "$LS" ] || { echo "agy live but no LS port served conv $CONV" >&2; exit 2; }

ANTIGRAVITY_LS_ADDRESS="$LS" "$AGY" agentapi send-message "$CONV" "$CONTENT"
