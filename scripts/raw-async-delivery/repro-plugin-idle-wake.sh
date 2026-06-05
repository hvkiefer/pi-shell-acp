#!/usr/bin/env bash
# repro-plugin-idle-wake.sh — single-session smoke for the PLUGIN reception unit.
#
# Two checks:
#   probe  — deterministic, no tmux: does the plugin's SessionStart hook fire at
#            STARTUP and arm a per-session watchPath? (A bare skill does NOT —
#            its hooks register only on invocation, after SessionStart passed.)
#   live   — one interactive session goes IDLE, then an ADDRESSED external write
#            (cc-enqueue-addressed.sh <sessionId>) wakes it with zero typing.
#
# For the multi-session isolation proof ("send to A, only A wakes, B undisturbed")
# see repro-addressed-routing.sh.
#
# COST: free for the wake (subscription continuation). `probe` uses one
#   `claude -p` (free before the 2026-06-15 metering change).
# REQUIRES: claude 2.x; tmux for `live`. Tested on 2.1.163.
# USAGE: ./repro-plugin-idle-wake.sh [probe|live]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN="$HERE/plugin-entwurf-receive"
T="${CC_REPRO_DIR:-/tmp/cc-plugin-repro}"
ROOT="$T/mailbox"
SESSION="ccplugrepro"

probe() {
  echo "== PROBE: does the plugin SessionStart hook fire at startup (per-session arm)? =="
  rm -rf "$T"; mkdir -p "$ROOT"
  ( cd "$T" && CC_MAILBOX_ROOT="$ROOT" timeout 120 claude -p "Say only PONG. No tools." \
        --plugin-dir "$PLUGIN" --dangerously-skip-permissions >/dev/null 2>"$T/p.err" ) || true
  if grep -rqs "SESSIONSTART armed" "$ROOT"/*/hook.log; then
    echo "PASS: plugin SessionStart hook fired and armed a per-session watchPath"
    grep -rhs "SESSIONSTART armed" "$ROOT"/*/hook.log
  else
    echo "FAIL: SessionStart hook did not fire (no per-session hook.log)"; exit 1
  fi
}

sid_for_cwd() {
  python3 - "$1" <<'PY'
import json, glob, os, sys
cwd = sys.argv[1]
for f in glob.glob(os.path.expanduser("~/.claude/sessions/*.json")):
    try: d = json.load(open(f))
    except Exception: continue
    if d.get("cwd") == cwd and d.get("kind") == "interactive":
        print(d.get("sessionId")); break
PY
}

live() {
  command -v tmux >/dev/null || { echo "tmux required for live test"; exit 1; }
  echo "== LIVE: addressed idle active-wake on one real interactive session =="
  rm -rf "$T"; mkdir -p "$ROOT" "$T/cwd"
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  tmux new-session -d -s "$SESSION" -x 200 -y 50
  tmux send-keys -t "$SESSION" "export CC_MAILBOX_ROOT='$ROOT'" Enter
  tmux send-keys -t "$SESSION" "cd '$T/cwd' && claude --plugin-dir '$PLUGIN' --dangerously-skip-permissions" Enter

  echo "-- resolving sessionId + waiting for per-session watch arm --"
  SID=""
  for _ in $(seq 1 40); do
    [ -z "$SID" ] && SID=$(sid_for_cwd "$T/cwd")
    [ -n "$SID" ] && [ -f "$ROOT/$SID/hook.log" ] && break
    sleep 1
  done
  [ -n "$SID" ] || { echo "FAIL: session never armed"; exit 1; }
  echo "session $SID armed: $(cat "$ROOT/$SID/hook.log")"

  echo "-- driving one turn so the session goes IDLE --"
  sleep 2
  tmux send-keys -t "$SESSION" "Reply with exactly the single word READY and then stop. No tools." Enter
  sleep 1; tmux send-keys -t "$SESSION" Enter
  for _ in $(seq 1 30); do tmux capture-pane -t "$SESSION" -p | grep -qE '●\s*READY' && break; sleep 1; done
  echo "session idle (READY)"

  echo "-- ADDRESSED external enqueue to $SID (NO typing) --"
  CC_MAILBOX_ROOT="$ROOT" "$HERE/cc-enqueue-addressed.sh" "$SID" \
    "REPRO-WAKE: external async ping. Confirm you woke from IDLE and state your model name."

  echo "-- waiting for FileChanged deliver --"
  for _ in $(seq 1 20); do grep -qs FILECHANGED "$ROOT/$SID/hook.log" && break; sleep 1; done
  if grep -qs FILECHANGED "$ROOT/$SID/hook.log"; then
    echo "PASS: idle session woken by addressed external write"
  else
    echo "FAIL: FileChanged never delivered"; exit 1
  fi
  cat "$ROOT/$SID/hook.log"

  echo "-- capturing the model's confirmation --"
  for _ in $(seq 1 40); do
    tmux capture-pane -t "$SESSION" -p | grep -qiE 'model|claude-opus|claude-sonnet|claude-haiku' && break; sleep 2
  done
  echo "================= PANE ================="
  tmux capture-pane -t "$SESSION" -p | grep -vE '^\s*$' | tail -18
  echo "======================================="
  echo "(session '$SESSION' left alive; 'tmux kill-session -t $SESSION' to end)"
}

case "${1:-live}" in
  probe) probe ;;
  live)  probe; echo; live ;;
  *) echo "usage: $0 [probe|live]"; exit 2 ;;
esac
