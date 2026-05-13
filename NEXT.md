# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 완료된 릴리즈/조사 기록은 `CHANGELOG.md`, GitHub issue, commit history로 보낸다.

---

## Session resume entry — 2026-05-13 마지막 상태

코드 + deterministic gate는 green. 0.5.0 핵심 결정 두 개 살아있음 — (1) backend escape hatch 완전 제거 commit 통과 (백엔드 auto-compact 전역 ON, no bridge knob), (2) Claude context-pressure 축은 `hooks: {}` overlay fix로 A/B clean 확인.

- 작업 중 PR 없음. uncommitted: 0.5.0 compaction policy 단순화 변경분 (직전 commit `15abd44` 후속).
- llmlog: `~/org/llmlog/20260513T133346--acp-compaction-command-surface-investigation__acp_compaction_llmlog_pishellacp.org` — ACP 표준 + 3 backend source 조사 완료, 그대로 사용.
- LIVE 1차 baseline: Claude pass (wire), Codex pass (text), Gemini observed (`/compact` no-op). raw 결과는 §"Three-backend continuity table" 안에 인용됨.

### 다음 한 걸음 (잊지 말 것)

**Claude context-pressure 축은 닫혔다 — `hooks: {}` overlay shape fix.** 2026-05-13 15:48 KST 첫 LIVE는 compact 발동 + 두 chunk + mapping 생존을 입증했고, 17:23 KST fresh `019e206a` probe는 overlay `settings.json`에 `hooks` key가 없을 때 organic compact turn이 meta-summary로 끝나는 prompt-sacrifice failure를 드러냈다. 이후 `hooks: {}`를 명시한 `2026-05-13-claude-hooks-empty` probe에서 같은 organic compact turn이 substantive reasoning + 원래 user prompt에 대한 직접 답으로 정상화됨. 즉:

- **Pattern A — explicit `/compact`**: clean. 같은 `hooks: {}` overlay에서 compact-only turn (`Compacting...` / `Compacting completed.`, wire `used=0`) 후 다음 user turn이 compacted context로 정상 답변. regression 없음.
- **Pattern B — organic auto-compact**: clean after fix. `hooks` key absent일 때는 prompt-sacrifice가 있었지만, configured-but-empty `hooks: {}`에서는 발동 turn 안에서 원래 prompt가 정상 처리됨. operator personal hooks는 여전히 inherit하지 않음.

→ **Claude 축은 0.5.0 release-grade로 닫힘.** 원인은 backend compaction 한계가 아니라 pi-shell-acp overlay shape 결함이었다. fix는 `acp-bridge.ts` `overlaySettingsJson()`의 `hooks: {}` 한 줄이며, thin-bridge 원칙은 그대로 유지된다.

남은 두 backend 셀:
- **Codex organic context-full** — 같은 fixture 패턴 필요 (saturated Codex pi-shell-acp 세션 → resume → cheap probe). 긴 Codex 세션 부재 → GLG와 대화하며 신규 생성 중.
- **Gemini context-pressure ACP surface** — `/compact` no-op은 닫혔지만 context가 진짜로 찼을 때 wire에서 무엇이 나오는지 (stop reason / error / silent / 새 세션 필요)는 아직.

### Cross-validation 메모

- 직전 commit `15abd44`는 0.5.0 정책 split (pi/backend knob 분리). 그 위에 쌓인 이번 uncommitted는 *backend escape hatch 완전 제거* (단일 knob — `PI_SHELL_ACP_ALLOW_PI_COMPACTION`만 남음) **+ organic compact LIVE evidence** (Claude only, 2026-05-13).
- GPT-5.4 분신 cross-review 완료 — missed residue 3건과 Codex config 문구 정밀화 fix를 GLG가 직접 반영함 (CONTRIBUTING.md, demo README, scripts/compaction-policy-smoke.ts 모두 single-knob 모델로 정렬).
- Organic 재현 명령 (5/13 첫 확정, 17:23 KST 이후 fixture 무효): `pias --session demo/compaction-policy-smoke/fixtures/pre-backend-compact--019e19e0--org-sonnet-97pct.jsonl -p "READY?"` (단 fixture는 read-only — 실제 실행 전 active session dir로 복사). `pias` alias = `PI_SHELL_ACP_DEBUG=1 pi --model pi-shell-acp/claude-sonnet-4-6 --entwurf-control --emacs-agent-socket server`. `--emacs-agent-socket server` flag는 `bridgeConfigSignature`에 포함되어 있어 빠지면 `incompatible_config`로 매핑 자동 무효화 → fresh `new` 세션으로 떨어짐 (signature는 `index.ts:836` `JSON.stringify({ base, emacsAgentSocket })`).
- **Fixture reproducibility 위기 (2026-05-13 17:10 발견)**: 오늘 commit 3개(`15abd44`, `9e88668`, `6f433a9`) 중 어딘가에서 `providerSettings.bridgeConfigSignature` (`index.ts:666` — backend, mcpServersHash, tools, skillPlugins, permissionAllow, disallowedTools, codexDisabledFeatures, appendSystemPrompt, settingSources, strictMcpConfig)가 변해, BASELINE 15:48 fixture(`acpSessionId=a01cb05f...`)는 **resume 불가** — 매번 `incompatible_config`로 invalidate되어 fresh `new`로 떨어짐. fixture .jsonl만 보존하는 contract로는 reproducibility 보장 불가. 대안 둘 — (i) fixture에 mapping cache JSON도 페어로 묶어 보존, (ii) signature 결정 필드를 명시적으로 stable한 release 식별자에 묶기. 정리는 0.5.0 release 전 결정 사항.
- **Fresh saturated session evidence (2026-05-13 17:23 KST)** — fixture 대체 보존: `demo/compaction-policy-smoke/probes/2026-05-13-claude-organic-fresh/turn-{01..04}.{stdout,stderr}` 4-turn full trace. piSessionId `019e206a-a4c6-70b9-83b1-9d127428a7be`, acpSessionId `7666d892-1faf-4fea-9e94-cd53bba0a2e8`. 사용 진행: 25k → 121k → **18.7k (organic compact)** → 22.8k. `hooks` key absent failure baseline으로 보존.
- **Hooks-empty fix evidence (2026-05-13 18:05 KST)** — `demo/compaction-policy-smoke/probes/2026-05-13-claude-hooks-empty/turn-{01..03}.{stdout,stderr}`. 같은 organic trigger shape에서 `hooks: {}` 후 turn 3이 substantive answer로 종료. 이어 explicit `/compact` Pattern A regression도 clean.
- **pi `-p` mode stdin-EOF 함정**: `pi --print` 모드에서 `< /dev/null` 미부착 시 부모 stdin socket이 EOF 안 와서 pi가 bootstrap 후 무한 대기. 분명한 hang 증상. 모든 LIVE probe shell 호출에 `< /dev/null` 필수 — 이건 BASELINE recipe README에 명시 필요.

---

## Current Priority — 0.5.0 context-pressure continuity policy

0.5.0 is **not ready for release**. The narrow guard split is implemented and static gates are green, but the real question is broader than the word "compact":

> When an ACP backend reaches context pressure, how does the session continue without pi-shell-acp becoming a second harness?

Working declaration:

| Layer | Default | Knob |
|---|---|---|
| pi JSONL compaction | blocked — pi-side summary does not reduce the backend transcript | `PI_SHELL_ACP_ALLOW_PI_COMPACTION=1` |
| backend-native context management | **always allowed (no bridge knob)** — bridge does not inject disable guards | — set backend's own native env/argv directly if needed (`DISABLE_AUTO_COMPACT=1` etc.) |
| legacy `PI_SHELL_ACP_ALLOW_COMPACTION` | rejected at spawn intent with next-action message | — |

Static gates currently green: `pnpm typecheck`, `check-mcp` (15), `check-backends` (137), `check-models` (3 passes), `check-dep-versions` (6), `check-sdk-surface`, `check-registration` (8), `smoke-compaction-policy` default (3 deterministic pass, 3 live steps skipped without `LIVE=1`; step 05 directly exercises wrapper `resolveAcpBackendLaunch` and source-verifies that the production spawn entry `createBridgeProcess` carries the same guard after a reviewer-found bypass).

### Required questions before 0.5.0 tag

For **all three ACP backends — Claude (`claude-agent-acp`), Codex (`codex-acp`), Gemini (`gemini --acp`) — ask the same questions. Do not let a Claude/Codex-only success become an accidental three-backend claim.**

1. **Backend-owned continuation path**
   - When the backend context fills, what does that backend itself do?
   - Is there an advertised ACP slash command (`available_commands_update`) such as `compact` / `compress`?
   - If a command exists, is it invoked via regular `session/prompt` text, or only through a native client-side CLI surface?
   - If there is no command, is the intended path auto-compact, new session from summary, refusal/error, or something else?

2. **Bridge/session mapping behavior**
   - When backend-side context management happens, does the existing ACP session continue, rotate, emit `compact_boundary` / `usage_update`, or require `resume > load > new`?
   - What happens to pi-shell-acp's persisted `pi:<sessionId>` → `acpSessionId` mapping?
   - Does the pi session stay alive without hidden transcript hydration?

3. **Summary handoff boundary**
   - If a backend produces a summary, does ACP expose it as ordinary assistant text, a status/update event, usage metadata, or not at all?
   - Is pi-shell-acp expected to forward anything into the pi JSONL, or should it only surface backend output as-is?
   - What would be required to continue a pi session from a backend-produced summary **without** inventing a second harness?

### Three-backend continuity table — fill BEFORE BASELINE / README cleanup

Source columns intentionally separated so each row stays honest about *where* the answer comes from (probe / source code / unverified). "✗ unverified" is a first-class entry; do not collapse it.

#### Axis 1 — Context-pressure continuation path (what the backend itself does when full)

| Backend | Advertised ACP slash command? | Literal `/compact` over `session/prompt` works? | Auto-compact / threshold behavior? | If no compact path — what is the expected continuation? |
|---|---|---|---|---|
| **Claude** (`claude-agent-acp`) | `available_commands_update` is emitted (`acp-agent.ts:1124-1135` + `getAvailableSlashCommands` at `:1796-1826`, filters only `cost/keybindings-help/login/logout/output-style:new/release-notes/todos`). Whether the SDK's `supportedCommands()` actually includes `/compact` for the current Claude SDK build is **✗ unverified** — needs an ACP-side advertised-command-list capture from a live session. | **✓ probe-confirmed (wire signal)** — LIVE 03 (2026-05-13): `meter=acpUsageUpdate source=backend used=0` compact_boundary observed; text reply was ordinary ("READY"), so this is wire-only evidence. SDK path is `compact_boundary` event → `acp-agent.ts:781-804`. Re-tested after `hooks: {}` overlay fix: explicit `/compact` remains clean and the next user turn answers from compacted context. | **✓ probe-confirmed and fixed.** Organic compact fires and same-session mapping survives. Initial `hooks`-absent overlay reproduced prompt-sacrifice (`2026-05-13-claude-organic-fresh`), but explicit empty `hooks: {}` in `overlaySettingsJson()` fixes the turn shape (`2026-05-13-claude-hooks-empty`): compact status + substantive reasoning + direct answer to the triggering prompt. Operator hooks are still not inherited. `DISABLE_AUTO_COMPACT` can suppress this natively; bridge default allows it. | N/A — compact path exists (explicit + organic, both LIVE and clean after overlay fix). |
| **Codex** (`codex-acp`) | `available_commands_update` emission is **✗ unverified** at the wire level (no ACP-side capture yet). Source confirms first-line slash parsing at `codex-acp/src/thread.rs:3215-3234` (`compact => Op::Compact`) and `extract_slash_command` at `:4097-4116`. | **✓ probe-confirmed (text signal)** — LIVE 04 (2026-05-13): reply was literal `"Context compacted"`. Wire usage drop 17897→11918 (~34%, below our 50% wire threshold), so text is the load-bearing signal. | `model_auto_compact_token_limit` is the threshold knob (0.4.x pinned i64::MAX; 0.5.0 default unpinned). Actual threshold behavior under 0.5.0 defaults is **✗ unverified** (would require context-window fill). | N/A — compact path exists. |
| **Gemini** (`gemini --acp`) | **✓ source-confirmed negative** — `gemini-cli/packages/cli/src/acp/acpCommandHandler.ts:18-29` shows the ACP command registry does **not** include `compress` / `compact`. CLI body (`packages/cli/src/ui/commands/compressCommand.ts:10-49`) implements them, but the ACP adapter never advertises them. Unknown slash → regular prompt fallback (`acpSession.ts:240-259`). | **✓ probe-confirmed negative** — LIVE 06 (2026-05-13): no compact reply, no wire compact_boundary, sentinel not recalled. `/compact` lands as a normal user prompt. | Threshold auto-compact at the ACP layer: **✗ unverified** — Gemini CLI body has compaction, but whether the ACP adapter triggers it autonomously when context fills is **the critical unanswered question for this row**. | **✗ unverified — load-bearing for this release.** What is the expected user-visible continuation when a Gemini ACP session hits context limit? `max_tokens` stop reason? error? silent truncation? new session required? Until this is answered, the 0.5.0 claim about "bridge does not implement compaction" leaves Gemini behavior implicit. |

#### Axis 2 — Bridge / persisted-mapping behavior across the context-pressure event

| Backend | Same entwurf `taskId` across the event? | Same pi JSONL appended? | Bridge `bootstrapPath` after compact: `resume / load / new`? | Persisted `pi:<sessionId>` → `acpSessionId` reused or invalidated? | Bridge-side `usage_update` / `compact_boundary` observed? |
|---|---|---|---|---|---|
| **Claude** | ✓ probe-confirmed (LIVE 03 stderr) | ✓ same `plant.sessionFile` across all three turns | `new` → `resume` → `resume` (LIVE 03 stderr) | ✓ reused — `persistedAcpSessionId === acpSessionId` across all three turns (LIVE 03 stderr) | `[pi-shell-acp:usage] meter=acpUsageUpdate source=backend backend=claude used=0 size=200000` — explicit compact_boundary marker. |
| **Codex** | ✓ probe-confirmed (LIVE 04) | ✓ same `plant.sessionFile` | `new` → `resume` → `resume` (LIVE 04 stderr — needs capture) | ✓ reused (LIVE 04 stderr) | No wire compact_boundary; `meter=acpUsageUpdate ... used=11918` (drop, not boundary). Text "Context compacted" is the marker on this backend. |
| **Gemini** | ✓ probe-confirmed (LIVE 06) | ✓ same `plant.sessionFile` | `new` → `resume` → `resume` (LIVE 06 stderr) | ✓ reused (LIVE 06 stderr) | No wire compact_boundary; `meter=componentSum source=promptResponse used=0` is a **bridge fallback when the backend emitted no usage_update at all**, NOT a compact signal — flagged in `classifyUsageEvidence` after the false-positive was observed mid-probe. |

#### Axis 3 — Summary handoff boundary (how, if at all, summary reaches pi)

| Backend | Summary surface on the ACP wire | Does pi-shell-acp need to inject anything? | What does "continue pi session without second harness" actually require? |
|---|---|---|---|
| **Claude** | claude-agent-acp emits `"Compacting..."` + `"\n\nCompacting completed."` as `agent_message_chunk` text (`acp-agent.ts:781-820`). **Pattern A (explicit `/compact`)**: compact-only turn + wire `used=0`; next user turn answers normally from compacted context. **Pattern B (organic auto-compact)**: with `hooks: {}` in the overlay, the compacting turn itself continues into substantive reasoning and a direct answer to the triggering prompt. The earlier self-summary leak was the `hooks`-absent overlay failure baseline, not the final 0.5.0 behavior. | **No** — bridge forwards backend chunks as-is. The backend owns the hidden continuation summary; pi-shell-acp does not inject, reconstruct, or hydrate transcript. The `hooks: {}` fix only gives Claude SDK the configured-empty hooks shape it expects while still inheriting no operator hooks. | Same `acpSessionId` survives both patterns. Explicit `/compact` and organic compact both keep the pi session alive; shutdown preserves mapping (`closeRemote=false invalidatePersisted=false`). |
| **Codex** | "Context compacted" lands as ordinary assistant text. The *actual* summary (what the backend kept) is internal to codex-acp's state; ACP does not expose it. | **No**. Same as Claude. | Same `acpSessionId` survives. Confirmed by LIVE 04 recall succeeding. |
| **Gemini** | No summary path observed — `/compact` was treated as a regular prompt, no compaction occurred. **The real Axis 3 question for Gemini is unanswered: when context fills, what does Gemini surface on the ACP wire?** stop reason? error? silent? | Provisional **No** until Gemini's context-pressure path is observed. | Provisional same-`acpSessionId`. But the real continuation question depends on what Gemini does when full — see Axis 1 last column. |

#### What this table tells us about 0.5.0

- **Claude axis is closed after the hooks-empty overlay fix.** Pattern A (explicit `/compact`) remains clean; Pattern B (organic auto-compact) now answers the triggering prompt in the compacting turn. The observed prompt-sacrifice was caused by the overlay `settings.json` omitting `hooks`, not by a backend-native compaction limitation. `hooks: {}` is now an overlay invariant and does not inherit operator hooks.
- Codex `/compact` (explicit) is closed for the release claim. Organic auto-compact threshold under 0.5.0 defaults is still **✗ unverified** — same fixture pattern shape, with a saturated Codex pi-shell-acp session as the resume target. 긴 Codex 세션 부재 → GLG 대화로 신규 생성 중.
- Gemini `/compact` is closed as a **negative** (no ACP adapter surface) — sufficient. Gemini's actual context-pressure continuation path on the ACP wire (Axis 1 last column, Axis 3) is still the unverified row that blocks "all three backends honest" for the tag.
- Release tag is gated on: (a) Codex organic/default-threshold decision — live proof if feasible, otherwise an explicit recorded `unverified/default threshold not observed` scope; (b) Gemini's context-pressure ACP surface (stop reason / error / silent / new-session required). Claude no longer blocks the tag.

### Immediate next steps

1. **Finish ACP standard + backend surface investigation**
   - llmlog in progress: `/home/junghan/org/llmlog/20260513T133346--acp-compaction-command-surface-investigation__acp_compaction_llmlog_pishellacp.org`.
   - Use precise wording: ACP appears to define a **generic slash-command surface** (`available_commands_update` + regular `session/prompt` invocation), not a dedicated compaction RPC. Therefore compact/compress semantics are backend/adapter-specific.
   - Before README edits, check this against `/home/junghan/repos/3rd/acp/agent-client-protocol` and the three backend implementations.

2. **Update verification plan to include Gemini deliberately**
   - Do not leave Gemini out merely because Claude/Codex probes exist.
   - If Gemini ACP has no compact/compress command surface, record that as a first-class result: what is Gemini's context-pressure continuation path under ACP?
   - 0.5.0 may still choose to limit live compact-command evidence to Claude/Codex, but only after the Gemini answer is explicit.

3. **Record actual live evidence in BASELINE only after scope is clear**
   - Claude + Codex live probes passed under the dual classifier; Gemini step 06 remains exploratory and belongs to the open context-pressure investigation. Keep the raw outcomes, but do not turn them into a release claim until the three-backend scope is written correctly.
   - BASELINE should distinguish: command advertisement/invocation, compact evidence, `usage_update`/boundary evidence, sentinel recall, and mapping/session survival.

4. **Then clean docs, not before**
   - README should end up short. Detailed backend differences belong in VERIFY / BASELINE / llmlog.

5. **Follow-up verification after the simplification commit**
   - Add one small smoke for operator override usability: prove the bridge still loses to native operator override on purpose (`DISABLE_AUTO_COMPACT=1` for Claude; Codex via `CODEX_ACP_COMMAND` and/or exported `CODEX_HOME`).
   - Keep the claim precise until that lands: current smoke proves bridge policy and source-guard placement, not a full production runtime spawn for the operator override path.
   - Do not add a user-facing `/acp-compact` unless the investigation proves a true cross-backend semantic contract. Current evidence points against adding it.

### Explicit non-goals for 0.5.0 (carried forward)

- compact→new-session handoff
- `ctx.newSession()` / `switchSession()` from `session_before_compact`
- hidden session manager inside pi-shell-acp
- reading backend transcript files
- manual ACP hydration from pi JSONL
- semantic-memory/day-query/llmlog recap policy
- OpenClaw changes
- public `PI_SHELL_ACP_RECAP_HINT(_FILE)` interface
- assuming Claude/Codex evidence automatically covers Gemini
- claiming a cross-backend `/compact` semantic unless the ACP standard + backend implementations prove it
- L5 50-turn soak with periodic context-pressure events + sentinel recall (a 0.6.x candidate)
- #10 peer-handle / contact_peer / sessionId-only carrier RFC implementation (parked; cwd-authority portion landed in 0.4.17)

---

## Parked, not current

- **#11** remote SSH resume cwd alignment — 나중에. 0.4.x 영역 아님.
- **#10** broader ontology RFC (peer handle, `contact_peer` verb, registry) — cwd-authority 부분은 0.4.17에서 닫음. 나머지는 새 evidence가 쌓일 때 재논의.
- **#8** ACP `entwurf_send` 메시지 UX visibility — #10 재논의 이후.
- **#2** pi-first context meter — 0.5.0 이후 영역.

---

## Completion rule

0.5.0 guard split이 끝나면 NEXT.md 전체를 다음 actual priority로 교체. 릴리즈 로그는 여기 남기지 않는다.
