#!/usr/bin/env bash
# repro-addressed-routing.sh — proof of ADDRESSED idle-wake routing.
#
# Launches TWO live Claude Code sessions (A, B) with the per-session plugin,
# drives both to IDLE, then delivers to A's sessionId ONLY. Asserts:
#   - A wakes (its per-session hook.log gets FILECHANGED; pane shows Stop hook feedback)
#   - B stays idle (no FILECHANGED in B's hook.log; pane unchanged)
# i.e. "send to the one you want, only it processes; siblings undisturbed."
#
# REQUIRES: claude 2.x + tmux. Sessions are mapped to sessionId by their cwd via
# ~/.claude/sessions/<pid>.json, so this never touches your real sessions.
# Uses an isolated CC_MAILBOX_ROOT under /tmp — real ~/.claude/mailbox untouched.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN="$HERE/plugin-entwurf-receive"
T="${CC_ROUTE_DIR:-/tmp/cc-addr-route}"
ROOT="$T/mailbox"
CWD_A="$T/a"; CWD_B="$T/b"

rm -rf "$T"; mkdir -p "$ROOT" "$CWD_A" "$CWD_B"

launch() { # <tmux-name> <cwd>
  local name="$1" cwd="$2"
  tmux kill-session -t "$name" 2>/dev/null || true
  tmux new-session -d -s "$name" -x 200 -y 50
  tmux send-keys -t "$name" "export CC_MAILBOX_ROOT='$ROOT'" Enter
  tmux send-keys -t "$name" "cd '$cwd' && claude --plugin-dir '$PLUGIN' --dangerously-skip-permissions" Enter
}

sid_for_cwd() { # <cwd> -> sessionId from the live marker
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

drive_idle() { # <tmux-name>
  local name="$1"
  sleep 2
  tmux send-keys -t "$name" "Reply with exactly the single word READY and then stop. No tools." Enter
  sleep 1; tmux send-keys -t "$name" Enter
  for _ in $(seq 1 30); do tmux capture-pane -t "$name" -p | grep -qE '●\s*READY' && break; sleep 1; done
}

echo "== launching A ($CWD_A) and B ($CWD_B) =="
launch ccA "$CWD_A"; launch ccB "$CWD_B"

echo "-- resolving sessionIds + waiting for per-session watch arm --"
SID_A=""; SID_B=""
for _ in $(seq 1 40); do
  [ -z "$SID_A" ] && SID_A=$(sid_for_cwd "$CWD_A")
  [ -z "$SID_B" ] && SID_B=$(sid_for_cwd "$CWD_B")
  [ -n "$SID_A" ] && [ -n "$SID_B" ] && \
    [ -f "$ROOT/$SID_A/hook.log" ] && [ -f "$ROOT/$SID_B/hook.log" ] && break
  sleep 1
done
echo "A = $SID_A"; echo "B = $SID_B"
[ -n "$SID_A" ] && [ -n "$SID_B" ] || { echo "FAIL: could not resolve both sessionIds"; exit 1; }
grep -h SESSIONSTART "$ROOT/$SID_A/hook.log" "$ROOT/$SID_B/hook.log"

echo "-- driving both to IDLE --"
drive_idle ccA; drive_idle ccB
echo "both idle (READY)"

echo "== DELIVER to A ONLY (sessionId $SID_A) =="
CC_MAILBOX_ROOT="$ROOT" "$HERE/cc-enqueue-addressed.sh" "$SID_A" \
  "ADDRESSED-ROUTE: you (and only you) were targeted. Confirm you woke from IDLE and print your sessionId + model."

echo "-- waiting for A to deliver --"
for _ in $(seq 1 20); do grep -q FILECHANGED "$ROOT/$SID_A/hook.log" 2>/dev/null && break; sleep 1; done
sleep 8   # give B a fair chance to (wrongly) wake before asserting it did not

echo "================= ASSERTIONS ================="
A_FIRED=$(grep -c FILECHANGED "$ROOT/$SID_A/hook.log" 2>/dev/null || true); A_FIRED=${A_FIRED:-0}
B_FIRED=$(grep -c FILECHANGED "$ROOT/$SID_B/hook.log" 2>/dev/null || true); B_FIRED=${B_FIRED:-0}
echo "A FILECHANGED count = $A_FIRED (want >=1)"
echo "B FILECHANGED count = $B_FIRED (want 0)"
echo "--- A hook.log ---"; cat "$ROOT/$SID_A/hook.log"
echo "--- B hook.log ---"; cat "$ROOT/$SID_B/hook.log"
echo "--- A pane (should show Stop hook feedback / wake) ---"
tmux capture-pane -t ccA -p | grep -vE '^\s*$' | tail -8
echo "--- B pane (should still be just READY, no wake) ---"
tmux capture-pane -t ccB -p | grep -vE '^\s*$' | tail -8

if [ "$A_FIRED" -ge 1 ] && [ "$B_FIRED" -eq 0 ]; then
  echo "RESULT: PASS — addressed routing works (only A woke)"
else
  echo "RESULT: FAIL — routing leaked or A did not wake"
fi
echo "(sessions ccA/ccB left alive; tmux kill-session -t ccA -t ccB to end)"
