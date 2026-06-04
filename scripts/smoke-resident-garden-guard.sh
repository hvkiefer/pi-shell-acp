#!/usr/bin/env bash
#
# smoke-resident-garden-guard — LIVE gate for the 0.9.0 resident garden-native
# session enforcement on `--entwurf-control` (NEXT.md "operator session garden
# identity"). Mirrors GLG's requirement: "native이든 pi-shell-acp이든 --entwurf-
# control 켜면 내 스타일로 고정 … 비-garden id가 보이면 바로 터져야 돼."
#
#   NEGATIVE (0 tokens, the must-have): raw `pi --entwurf-control` with NO
#     --session-id → pi mints a uuidv7 → the entwurf-control guard must BLOW UP
#     at session_start BEFORE any model turn:
#       - nonzero exit
#       - NO model turn (no `agent_start`; zero tokens)
#       - NO control socket created for that uuid session
#       - the "Non-garden session id" reason on stderr
#     Why this smoke exists: verified live 2026-06-04 that `ctx.shutdown()` alone
#     does NOT stop the in-flight turn (26k tokens leaked through). The guard now
#     hard-exits via process.exit(1); this smoke locks that guarantee so a
#     regression to shutdown-only (silent token leak) fails the gate.
#
#   POSITIVE (opt-in, ~1 cheap turn; set SMOKE_RGG_POSITIVE=1): garden
#     --session-id "$(./run.sh new-session-id)" → guard passes, the session file
#     header id is the garden id, and the resident name carries the `control`
#     tag (NEVER `entwurf` — that tag is the entwurf_resume marker).
#
# Cost: NEGATIVE = 0 tokens (exits before the turn). POSITIVE = ~1 cheap turn.
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTWURF_DIR="$HOME/.pi/entwurf-control"
SESSIONS_BASE="$HOME/.pi/agent/sessions"
MODEL="${SMOKE_RGG_MODEL:-claude-sonnet-4-6}"
PROVIDER="${SMOKE_RGG_PROVIDER:-pi-shell-acp}"
TIMEOUT="${SMOKE_RGG_TIMEOUT:-90}"

pass=0
fail=0
note() { printf '  %s\n' "$*"; }
ok() {
	pass=$((pass + 1))
	printf '  PASS  %s\n' "$1"
}
bad() {
	fail=$((fail + 1))
	printf '  FAIL  %s\n' "$1"
}

# ─── NEGATIVE — raw uuid session must blow up (0 tokens) ────────────────────
echo "[smoke-resident-garden-guard] NEGATIVE: raw 'pi --entwurf-control' (no --session-id)"
neg_out=""
neg_ec=0
neg_out=$(timeout "$TIMEOUT" pi --entwurf-control --provider "$PROVIDER" --model "$MODEL" \
	--mode json -p 'RGG_NEGATIVE_SHOULD_NOT_RUN' 2>&1) || neg_ec=$?

# The session header pi minted (uuidv7) is printed on the --mode json stream.
neg_sid=$(printf '%s\n' "$neg_out" | grep -o '"type":"session"[^}]*"id":"[^"]*"' | head -1 | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"$//')

if [ "$neg_ec" -ne 0 ]; then
	ok "nonzero exit ($neg_ec)"
else
	bad "expected nonzero exit, got 0 (guard did not blow up)"
fi

if printf '%s\n' "$neg_out" | grep -q "Non-garden session id"; then
	ok "guard reason on stderr (Non-garden session id)"
else
	bad "guard reason 'Non-garden session id' not found in output"
fi

if printf '%s\n' "$neg_out" | grep -q '"type":"agent_start"'; then
	bad "agent_start present — the model turn RAN (token leak; shutdown-only regression?)"
else
	ok "no agent_start — model turn never started (0 tokens)"
fi

if printf '%s\n' "$neg_out" | grep -qE '"totalTokens":[1-9]'; then
	bad "nonzero token usage observed — turn leaked through the guard"
else
	ok "no token usage observed"
fi

if [ -n "$neg_sid" ] && [ -e "$ENTWURF_DIR/$neg_sid.sock" ]; then
	bad "control socket created for the uuid session ($neg_sid.sock) — server not refused"
else
	ok "no control socket created for the refused session"
fi

# The refused uuid session must not have been left on disk either (it exits
# before the first assistant turn, so _persist never writes the file).
if [ -n "$neg_sid" ] && find "$SESSIONS_BASE" -name "*_${neg_sid}.jsonl" 2>/dev/null | grep -q .; then
	bad "uuid session file written ($neg_sid) — turn progressed past session_start"
else
	ok "no uuid session file written"
fi

# ─── REPLACEMENT — in-process new/clone must be CANCELLED, not hard-exit ─────
# Under --entwurf-control, /new and /fork|/clone mint a non-garden uuid in-process
# (no --session-id reaches an in-process switch, and the pre-switch hook result
# carries only { cancel } — it cannot inject a garden id). Before 0.9.0's pre-event
# guard these reached the session_start hard guard and process.exit(1) the WHOLE
# pi process — a routine /new killed the session. Now session_before_switch /
# session_before_fork cancel the mint: the session survives on its garden id at
# zero tokens. (GPT zero-token RPC repro, 2026-06-04.)
echo "[smoke-resident-garden-guard] REPLACEMENT: in-process new/clone cancelled (RPC, 0 tokens)"
rep_sid=$(bash "$REPO/run.sh" new-session-id)
rep_err=$(mktemp)
rep_out=$(printf '%s\n' '{"type":"get_state"}' '{"type":"new_session"}' '{"type":"clone"}' '{"type":"get_state"}' |
	timeout "$TIMEOUT" pi --session-id "$rep_sid" --entwurf-control --provider "$PROVIDER" \
		--model "$MODEL" --mode rpc 2>"$rep_err") || true

if printf '%s\n' "$rep_out" | grep -q '"command":"new_session","success":true,"data":{"cancelled":true}'; then
	ok "/new (new_session) cancelled in-process"
else
	bad "/new was NOT cancelled — in-process uuid mint reached the hard guard"
fi

if printf '%s\n' "$rep_out" | grep -q '"command":"clone","success":true,"data":{"cancelled":true}'; then
	ok "/clone (fork) cancelled in-process"
else
	bad "/clone was NOT cancelled — fork mint reached the hard guard"
fi

# Both get_state calls must report the original garden id (process survived, the
# session was never replaced by a uuid).
rep_ids=$(printf '%s\n' "$rep_out" | grep -o '"sessionId":"[^"]*"' | sort -u)
if [ "$rep_ids" = "\"sessionId\":\"$rep_sid\"" ]; then
	ok "session stayed on the garden id ($rep_sid) — process survived, not replaced"
else
	bad "sessionId drifted from $rep_sid — got: ${rep_ids:-<none>}"
fi

# The hard guard's "Non-garden session id" must NOT appear — the pre-switch cancel
# caught it first (our friendly "blocked under --entwurf-control" guidance is fine).
if grep -q "Non-garden session id" "$rep_err"; then
	bad "hard guard fired (Non-garden session id) — pre-switch cancel missed a path"
else
	ok "hard guard never fired (pre-switch cancel caught it; no process exit)"
fi

# No control socket may exist for any uuid (the cancelled mints never booted).
if find "$ENTWURF_DIR" -name '*-*-*-*-*.sock' 2>/dev/null | grep -q .; then
	bad "a uuid-shaped control socket exists — a cancelled mint leaked a server"
else
	ok "no uuid control socket leaked"
fi
rm -f "$rep_err"

# ─── POSITIVE — garden session passes + control name (opt-in, costs a turn) ──
if [ "${SMOKE_RGG_POSITIVE:-0}" = "1" ]; then
	echo "[smoke-resident-garden-guard] POSITIVE: garden --session-id (SMOKE_RGG_POSITIVE=1)"
	pos_sid=$(bash "$REPO/run.sh" new-session-id)
	pos_ec=0
	pos_out=$(timeout "$TIMEOUT" pi --session-id "$pos_sid" --entwurf-control --provider "$PROVIDER" \
		--model "$MODEL" --mode json -p 'reply OK only' 2>&1) || pos_ec=$?

	if [ "$pos_ec" -eq 0 ] && ! printf '%s\n' "$pos_out" | grep -q "Non-garden session id"; then
		ok "garden session not refused (exit 0, no guard)"
	else
		bad "garden session was refused (exit=$pos_ec) — false positive in the guard"
	fi

	pos_file=$(find "$SESSIONS_BASE" -name "*_${pos_sid}.jsonl" 2>/dev/null | head -1)
	if [ -n "$pos_file" ] && grep -q "\"type\":\"session\"[^}]*\"id\":\"$pos_sid\"" "$pos_file"; then
		ok "garden header id on disk ($pos_sid)"
	else
		bad "garden header id not found on disk for $pos_sid"
	fi

	if [ -n "$pos_file" ] && grep -q "\"name\":\"${pos_sid}==[^\"]*__control\"" "$pos_file"; then
		ok "resident name carries the 'control' tag"
	else
		bad "resident name with 'control' tag not found"
	fi
	if [ -n "$pos_file" ] && grep -oE "\"name\":\"${pos_sid}==[^\"]*\"" "$pos_file" | grep -q "entwurf"; then
		bad "resident name carries the 'entwurf' tag — would be resumable as a child"
	else
		ok "resident name does NOT carry the 'entwurf' tag"
	fi
else
	note "POSITIVE skipped (set SMOKE_RGG_POSITIVE=1 to run; costs ~1 cheap turn)"
fi

echo "[smoke-resident-garden-guard] PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
