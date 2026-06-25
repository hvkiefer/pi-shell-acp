# VERIFY.md

Replicant-testing-replicant verification guide for `entwurf`.

> **Current surface note.** The live release surface is one bundled MCP server, `entwurf-bridge`, exposing four tools: `entwurf_v2`, `entwurf_peers`, `entwurf_self`, `entwurf_inbox_read`. The 0.4.x `session-bridge` adapter and the v1 entwurf verbs are retired; history rows that mention `session-bridge` / `pi-tools-bridge` / v1 tool surfaces are retained in CHANGELOG/git as historical baseline records, not as the current expectation. Native pi entwurf routing (e.g. `openai-codex/gpt-5.4` without `provider="entwurf"`) does not enroll `entwurf-bridge` as an MCP at all — pi delivers entwurf capability via extension surface on the native path, so "MCP not visible" is the correct PASS on native, while ACP-routed targets MUST see `entwurf-bridge`.

This document is a **working document, not a metrics document**.
Even if scripts break, an agent that follows these steps and reads the results should be able to immediately determine:

- Whether ACP is broken in single-turn mode
- Whether multi-turn sessions are genuinely continuing
- Whether cross-process continuity is working
- Whether bridge invariants are not leaking
- Whether tool call / event mapping is visible
- Whether processes/cache are not left behind as garbage
- Whether pi session records are usable as a shared memory axis for andenken embedding

VERIFY.md is the **agent-driven** verification surface; BASELINE.md is the operator-driven one. One ACP-bridged model runs the script against another ACP-bridged model and writes down what it sees — if the bridge is faithful, two replicants looking at the same mirror produce the same description of the mirror. This is in-bridge cross-validation, not external evidence: both verifier and subject share the same bridge, MCP servers, and operator-config overlay, so any uniform corruption of those would not surface here. The recipe is up front; the historical R2R narrative, claims ledger, and run history are compressed into the appendix and live in full in CHANGELOG/git.

## Strengthened verification rules (post-0.4.1)

These supersede the per-section rules they touch — the original sections are kept for context, but the rules below are what must hold:

- **§1A.4 Layer 3 pass criterion** is **8 turns / 3+ early facts / one verbatim string injected before turn 5**, not 5 turns. Real bridge runs at 9-turn / 4-fact / 100% recall with the current code; lowering the bar to 5 turns hides regressions.
- **§10.3 process-count formula** counts **distinct alive `(sessionKey, backend, modelId, bridgeConfigSignature)` tuples**, not entwurf sessionIds. A single process-scoped ACP session can serve multiple turns for the same `(sessionKey, backend, modelId, bridgeConfigSignature)` tuple (`pi-extensions/lib/acp/session-store.ts` + `backend.ts` retained connection). Delta=0 against a verifier already holding that live bridge session is the **expected** state, not an under-count.
- **§1A.5 Layer 4 prerequisite**: a verifier already running through `entwurf` cannot dispatch to direct Claude Code via standard MCP tools — it can only call its sibling via entwurf. Layer 4 requires either a human in the loop or a verifier that holds both transport handles.
- **§12.1 `ENTWURF_CHILD_STDERR_LOG` self-spawn limit**: `export` from a shell already bound to a running bridge process does **not** propagate into that bridge — the env must be present at bridge-process spawn time. Restart the parent session with the env exported, or run VERIFY.md from a plain shell that has not yet bound the bridge.

## Evidence Levels

Every claim in this document — and every History entry — implicitly sits on one of these rungs. Make the rung explicit so neither narrative nor reader overreaches.

> **Namespace note.** These `L0–L5` rungs measure evidence quality for bridge verification. Native async message delivery has its own capability namespace, `D0–D8`, in [DELIVERY.md](./DELIVERY.md). Operator-driven identity baseline uses `Q-L1..Q-L5` surface-isolation layers in [BASELINE.md](./BASELINE.md). Do not conflate "high-quality evidence" with "high delivery capability": a backend can have L3 evidence for only D0/D1 capability, or L2 evidence for D6 capability that still needs L3 corroboration.

| Level | What it is | Closes | Does not close |
|---|---|---|---|
| **L0** | Narrative / self-report | Author/agent description of the system | Anything that depends on actual behaviour |
| **L1** | Transcript cross-check | Two or more bridged identities agree on what they see | Echo chamber risk (shared prompt, shared carrier) |
| **L2** | Objective MCP tool call | Real on-disk / on-socket payload returned through the bridge | Shared-implementation corruption (same buggy bridge for both sides) |
| **L3** | On-disk / process / socket corroboration outside the bridge | What the bridge says ↔ what `ls`, `pgrep`, `lsof`, raw socket connect, session JSONL on disk say | Time-extended drift (auth, version, cache, memory) |
| **L4** | Human or direct-native side-by-side comparison | A real person (or a non-bridged direct Claude/Codex/Gemini path) reaches the same answer the bridge does for matched prompts | Production-shape workload (long sessions, tool bursts, fault injection) |
| **L5** | Long-haul soak | The bridge stays correct under hours-to-days of real use, including partial failures and concurrent multi-session pressure | Nothing higher proposed yet — this is the operational ceiling for now |

When you write a new History entry or a new section, mark which rung it stands on. "L1 only" is fine — it is honest. "L2 reached" is stronger evidence than "L1 only" but does not silently imply L3 is also true.

---

## 0A. Execution Policy — Transparent Mode (Real-World Baseline)

The verification in this document is not a benchmark. In production, we continuously exchange **short sync turns** like `entwurf` / `entwurf_resume` to check state, and stop immediately to isolate the cause before resuming when something looks off.

This document records only **verification intent (what we're looking at) and pass criteria (how to judge)**. The execution shape is determined by the agent using the most reasonable tools in its environment. The same intent can be verified in different ways — as long as the pass criteria are met.

### Default Execution Shape — current v2 orchestration

- Deterministic floor: run `pnpm check` and inspect the named `check-*` gates.
- Live floor: run `LIVE=1 ./run.sh release-gate <scratch-project-dir>` and judge only the MUST tier for cut readiness.
- Garden-id delivery verification: discover a target with `entwurf_peers`, then use `entwurf_v2` with the correct intent (`fire-and-forget` for a live/replyable target, `owned-outcome` only for a dormant record-backed pi citizen). The old v1 `entwurf` / `entwurf_resume` surfaces are gone.
- ACP continuity verification: use the `smoke-acp-*-live` gates or a direct `pi --provider entwurf --model <claude-model>` turn; multi-turn reuse is proven by `smoke-acp-session-reuse-live` rather than by v1 resume tools.

### Live gates — the current release floor

These are the live, on-demand gates (not in the deterministic `pnpm check` floor). Run them before any release that touches the entwurf surface.

> **Command surface (0.12.0).** The v2-only migration retired the v1 runtime-smoke surface. The two canonical entry points are now `pnpm check` (the full deterministic floor — every `check-*` gate) and `LIVE=1 ./run.sh release-gate <dir>` (the live floor — `pnpm check` + the v2-native live gates + the ACP plugin acceptance floor). Live runtime invariants are covered by the `smoke-entwurf-v2-*-live` gates and the ten `smoke-acp-*-live` gates. There is no standalone `smoke-all` / `smoke-claude` / `smoke-async-resume` / `smoke-entwurf-resume` / `check-mcp` / `check-backends` anymore; where a v1 invariant still has a current gate it is named below, and where the dedicated v1 smoke was dropped (cancel, transcript-poison live repro) that is called out explicitly.

- **Async resume** — `LIVE=1 ./run.sh smoke-entwurf-v2-spawn-resume-live` (the v2 spawn-bg resume lifecycle the v1 deprecation is predicated on). A real `pi --entwurf-control` child resumes a dormant Entwurf session and does a model turn; the replyable MCP → `spawn_async_resume` control-RPC → native async launcher path is exercised here, and `❌ resume` is fail-closed, not PASS. Re-run after any change to `pi-extensions/lib/entwurf-async.ts`, `mcp/entwurf-bridge/src/{index,resume-mode}.ts`, or `pi-extensions/entwurf-control.ts`.
- **Resident garden-native session** — `./run.sh smoke-resident-garden-guard`. The deterministic half is `./run.sh check-entwurf-session-identity` (in `pnpm check`): `assertGardenNativeSessionId` (uuid→throw / garden→pass), `buildGardenSessionName`, `computeResidentStatusLabel`, the rule that a `control`-tagged resident session is NOT `entwurf_resume`-able, and the `/gnew` writer's fail-closed guarantees. The live half covers four slices: NEGATIVE (default, **0 tokens** — raw `pi --entwurf-control` with no `--session-id` must exit nonzero before any model turn: no `agent_start`, no tokens, no socket, no session file), REPLACEMENT (`/new`/`/clone` cancelled in-process), GNEW (same-terminal garden birth, socket rebound, no uuid leak), and POSITIVE (`SMOKE_RGG_POSITIVE=1`, ~1 cheap turn — garden header on disk + post-`/gnew` `entwurf_self` reports the new garden id). **Release scoping:** the deterministic half (`SMOKE_RGG_POSITIVE=0`) is **MUST**; the positives-enabled run is **BEHAVIOR (advisory)** because the added turns depend on the backend autonomously calling `entwurf_self`.
- **ACP-provider RGG** — `./run.sh smoke-acp-rgg-live` drives the same runner against the `entwurf` provider target (`ENTWURF_LIVE_TARGET=entwurf/claude-sonnet-4-6`, override via `ENTWURF_RGG_TARGET`), deterministic half only. The GNEW T3 `entwurf_self` turn is **N/A by ACP boundary**: the ACP child is spawned with `mcpServers:[]`, so it has no `entwurf_self` call surface — a T3 FAIL under an ACP target is an expected boundary result, not a regression.
- **Release gate** — `LIVE=1 ./run.sh release-gate <scratch-project-dir>` (`--allow-skip-gemini` is accepted-but-ignored for back-compat). Runs the full deterministic floor (`pnpm check`) plus every live gate and reports a **two-tier summary**: a **MUST** tier (release-blocking — owns the exit code; "green" applies only here) covering function — `pnpm check`, `smoke-entwurf-v2-spawn-resume-live`, `smoke-entwurf-v2-matrix-live`, `check-bridge`, the retargeted `smoke-session-id-name`, the resident-garden-guard negative/id-safety + `/gnew` zero-token half, and the ten `smoke-acp-*-live` ACP plugin smokes (socket-citizen / raw-turn / overlay / provider / session-reuse / carrier-augment / rgg / mcp / skill / bundled-mcp); and a **BEHAVIOR** tier (advisory, non-blocking) — resident-garden-guard positive (the model-in-loop `entwurf_self` turn). LIVE-gated MUST steps honest-skip when `LIVE!=1`; a real cut needs `LIVE=1` with `SKIP=0`. A BEHAVIOR FAIL is surfaced with its artifact path but **never blocks the cut**. A green MUST gate is necessary but not sufficient; GLG authorizes the cut.
- **entwurf_v2 dispatch substrate** — verified bottom-up. **Deterministic** (in `pnpm check`): `check-entwurf-v2-contract` (contract freeze), `check-entwurf-v2-lock` (per-gid lockfile), `check-entwurf-v2-decider` (pure liveness→transport decider), `check-entwurf-v2-release` (release-policy reducer), `check-entwurf-v2-send` / `check-entwurf-v2-send-fallback`, `check-entwurf-v2-mailbox` (enqueue-only body), `check-entwurf-v2-runner` / `check-entwurf-v2-production`, `check-entwurf-v2-surface` (pi-native + MCP verb surface), `check-entwurf-v2-spawn` / `check-entwurf-v2-spawn-production`, `check-entwurf-v2-matrix`. **Live** (release gate / on demand): `smoke-entwurf-v2-spawn-live`, `smoke-entwurf-v2-spawn-resume-live` (a real `pi --entwurf-control` child stands its socket up, resumes a dormant Entwurf session, does a model turn), `smoke-entwurf-v2-matrix-live`.
- **Bridge MCP contract** — `./run.sh check-bridge` + `mcp/entwurf-bridge/test.sh` pin `tools/list` and the negative paths objectively (not via model self-report).

> **Cut evidence.** Per-release pre-cut logs (release-gate PASS/FAIL counts, sentinel/async-resume/session-messaging artifacts) live in `CHANGELOG.md` and git history. They are not duplicated here so this document stays a recipe, not a ledger. The most recent recorded floor baseline is in BASELINE.md's HISTORY section.

### What NOT to Do — Bypassing the Operational Path

The following patterns **bypass the delegation logic itself** that we're trying to verify. Even if continuity appears to hold on the surface, these are not the real operational path (entwurf → entwurf_resume), so passing does not mean production is healthy.

- ✗ Creating session files directly with `mktemp /tmp/entwurf-verify-XXXXXX.jsonl`
- ✗ Manual calls of the form `pi -e <REPO> --session <FILE> --model <M> -p '...'`
- ✗ Faking multi-turn by passing the same session file twice

In the past, writing these commands out directly caused agents to copy them verbatim and bypass the operational path. This document contains only intent and pass criteria. The manual `pi --session` path is used only when (a) the entwurf path itself is broken and an isolated debug bypass is needed, or (b) §6-style boundary verification requires directly hitting the bridge's internal API.

### Operational Principles

- **Execute one command at a time.** (Do not chain multiple steps with `;`)
- **Preserve full stdout/stderr** at each step.
- If something goes wrong, do not proceed to the next step — **stop and hold** (preserve session/cache/process state first if needed).

### Verification wording — avoid safety-interpretation contamination

When injecting a fact and retrieving it during continuity verification, use **plaintext facts that do not trigger model safety interpretation**. Avoid `secret token`, `test-token-123`, `password`, `API key`, `credential`, and meta-directives like "secret" / "sensitive" / "do not leak" — such wording makes Claude treat the prompt as a prompt-injection / exfiltration attempt and answer "I won't share that," which makes **continuity look broken even when it is alive**. This actually happened once (`test-token-123` received a refusal and was misdiagnosed as a delegation-logic failure).

Instead: ✓ `The password is owl → reply in one word → owl`; code names / colors / animal names / arbitrary alphanumeric tokens; force the first-turn response to a short ack (`READY`). Do not mix continuity verification and safety-behavior verification in one prompt.

### bridge continuity vs semantic continuity — do not treat as the same thing

- **bridge continuity**: same `sessionKey` / persisted record hit / same `acpSessionId` / `bootstrap path=resume|load`.
- **semantic continuity**: a fact given in a previous turn can be retrieved in a subsequent turn.

Either can be alive while the other is broken (the wording-contamination case above is bridge-alive / semantic-looks-dead). When in doubt, change the wording and try once more, and check the `[entwurf:bootstrap]` lines in bridge stderr.

## 0. Quality Criteria

What we want is not simply "invoke Claude Code." The goals are:

1. **Session continuity at the agent-shell level** — continuity through ACP session resume/load/new, not re-throwing a blob of text.
2. **Preservation of pi harness semantics** — pi session files, transcripts, and memory pipeline remain a shared common axis.
3. **restart-safe** — even when the process changes, the same pi session resumes as the same ACP session as much as possible.
4. **Thin bridge** — do not build a second harness inside this repo.
5. **Capability exposure boundary is explicit** — pi custom tool / user MCP visibility is determined solely by `entwurfProvider.mcpServers`; no automatic `~/.mcp.json` loading.
6. **Operational hygiene** — no orphan subprocesses, no excess persisted session garbage.

---

## 1. Setup

entwurf supports two legitimate install paths. Both end in the same runtime state (a valid `.pi/settings.json` with `entwurfProvider.mcpServers` wired); they differ in who owns the checkout.

| Path | Who | Shape | Example target |
|------|-----|-------|----------------|
| **A — Consumer** | end-user of pi | `pi install git:…` + one `run.sh install .` | fresh pi machine |
| **B — Developer** | contributor / first user | `git clone …` + `pi install ./` + `run.sh install …` | primary dev machine |

### 1.1 Path A — consumer install

```bash
# 1. register with pi (pi auto-clones + installs deps into its managed checkout)
pi install git:github.com/junghan0611/entwurf

# 2. wire the bundled mcpServers into a consumer project
cd /path/to/consumer-project
~/.pi/agent/git/github.com/junghan0611/entwurf/run.sh install .

# 3. verify model surface
pi --list-models entwurf

# 4. one-turn smoke (a single Claude turn through entwurf)
pi --provider entwurf --model claude-sonnet-4-6 -p "reply with ok only"
```

Expected: step 1 prints package install messages and `pi list` shows the package under `User packages`; step 2 logs `install: added entwurfProvider.mcpServers.entwurf-bridge` + `install: updated <project>/.pi/settings.json`; step 3 prints the curated model surface; step 4 returns a one-word reply (a full bootstrap → ACP session → bridge response → clean shutdown round-trip). The full live floor is `LIVE=1 $REPO_DIR/run.sh release-gate .`.

Notes: the checkout path `~/.pi/agent/git/github.com/junghan0611/entwurf` is pi-managed — do not edit files there (a `pi update` would overwrite them). Step 2 is still required after `pi install git:…`; `pi install` only adds the package to `~/.pi/agent/settings.json#packages`, it does not pre-wire the per-project `entwurfProvider.mcpServers` entries.

### 1.2 Path B — developer install

```bash
# 1. clone + deps
git clone https://github.com/junghan0611/entwurf /path/to/entwurf
cd /path/to/entwurf
pnpm install   # or: npm install (pnpm is the pinned packageManager)

# 2. register the local checkout with pi
pi install ./

# 3. wire mcpServers into a consumer project
./run.sh install /path/to/consumer-project

# 4. deterministic gates
pnpm typecheck
./run.sh check-bridge                  # MCP tool contract
pnpm check                             # full deterministic floor (~60 gates)

# 5. runtime smoke — one Claude turn, then the full live floor
pi --provider entwurf --model claude-sonnet-4-6 -p "reply with ok only"
LIVE=1 ./run.sh release-gate /path/to/consumer-project
```

Re-running step 3 is idempotent. User-authored `mcpServers.<name>` overrides with a different command survive the re-run (annotated `preserved (user override: …)`). `./run.sh remove /path/to/consumer-project` deletes only entries whose command matches the repo-authored launcher path.

### 1.3 Variables (referenced by the rest of this document)

```bash
# Path A
export REPO_DIR=$HOME/.pi/agent/git/github.com/junghan0611/entwurf
# Path B (pick one)
# export REPO_DIR=/path/to/entwurf

export PROJECT_DIR=/path/to/consumer-project
export CACHE_DIR=$HOME/.pi/agent/cache/entwurf/sessions
mkdir -p "$CACHE_DIR"
```

### 1.4 Setup shortcut (either path)

```bash
cd "$REPO_DIR"
./run.sh setup "$PROJECT_DIR"
```

`setup` (`setup_all`) runs `pnpm install` + `install` + meta-bridge (if a native harness) + the v2 install smoke in sequence, so a green `setup` implies the settings.json wiring and the install surface are healthy. The full live runtime floor is still `LIVE=1 ./run.sh release-gate`.

### 1.5 Pre-verification snapshot — capture once, before §3

Every verification run produces evidence by **comparing state before and after**. Capture these baselines **immediately before §3 begins** — once missed, §5/§10 lose their comparison axis.

```bash
export BEFORE_CACHE=$(find "$CACHE_DIR" -maxdepth 1 -type f | wc -l)
export BEFORE_ACP=$(pgrep -af claude-agent-acp | wc -l)
export BEFORE_CODEX=$(pgrep -af codex-acp | wc -l)
export BEFORE_GEMINI=$(pgrep -af 'gemini .*--acp|gemini --acp' | wc -l)
echo "before: cache=$BEFORE_CACHE claude-agent-acp=$BEFORE_ACP codex-acp=$BEFORE_CODEX gemini-acp=$BEFORE_GEMINI"
```

Preserve these four numbers in your log. §5.1 (cache delta) and §10 (process delta) reference them. If `gemini` is not under test, `BEFORE_GEMINI=0` with an explicit skip note is correct.

### 1.6 Turn map (sequential run)

When §3 → §4 → §8 → §1A.4 are run sequentially against a single target as one verifier session, the global turn index runs 1–10. Each section's local index ("first turn") is relative to that section.

| Global turn | Section | Intent |
|---|---|---|
| 1 | §3.1 | SessionStart hook ack |
| 2 | §3.2 | Basic tool call (date) |
| 3 | §4.1 (1) | Inject fact |
| 4 | §4.1 (2) | Retrieve fact |
| 5 | §4.1 (3) | Update fact |
| 6 | §4.1 (4) | Retrieve updated fact |
| 7 | §8.5 | List visible MCPs |
| 8 | §8.5 | List MCPs again — consistency check |
| 9 | §1A.1 | Self-awareness |
| 10 | §1A.4 | Multi-fact recall (uses turns 3–5 facts) |

If the verifier strictly needs a fresh ACP session inside this sequence, switch to a different target (e.g. `claude-opus-4-8` or `gpt-5.5`) at the section boundary — see the §3 per-`(provider, model)` uniqueness gate.

### 1.7 Cross-install / cross-backend parity (optional but high-value)

Four axes to compare a fresh self-awareness report against:

1. **Same backend, different install path.** Path A vs Path B — same answer expected (install path must be invisible to the bridged model).
2. **Same backend, different machine.** Two `entwurf/claude-sonnet-4-6` instances — identical native tool list, identical MCP server list, identical MCP tool functions.
3. **Different backend, same bridge.** Same harness identification (`entwurf`), same MCP server (`entwurf-bridge`, when ACP-routed), same v2 MCP tool functions — but **different** native tool surface and backend carrier conventions. If a Claude session reports `apply_patch` as native, or a Gemini session reports Claude/Codex native tools as its own, the bridge accidentally normalized the tool surface — that is a fail.
4. **Native pi routing vs ACP-bridged routing, same backend model.** The native target reports **no `entwurf-bridge` MCP server** (capability via pi's extension surface, not MCP) and presents pi's unified tool surface; the ACP-routed target reports `entwurf-bridge` as the single MCP server. A native target that hallucinates `entwurf-bridge` is a fail; an ACP target that fails to expose it is a fail. Honest "ACP or native: I cannot tell from what I see" hedging on the native side is **PASS** — it reflects the real ambiguity native pi presents, where the bridge identity narrative is not part of the native augment.

Status: Claude/Codex bidirectional checks (axes 1–3) and the native-vs-ACP routing comparison (axis 4) are closed; the Gemini axis-3 cell is closed. Gemini axis 4 is **N/A** by design — host pi removed its native `google` provider, so Gemini routes exclusively through ACP.

---

## 1A. Main Agent Evaluation — Is `entwurf` Claude Strong Enough?

> **When Claude is connected through pi via ACP, is it strong enough as the main coding agent?**

Separate from the continuity smoke. Smoke proves "sessions continue"; this questionnaire examines tool self-awareness / native tool usability / pi-facing MCP boundary awareness / long-turn focus / quality relative to direct Claude Code. Execution follows §0A — Layers 0–3 start with one `entwurf` for a single target (`entwurf/claude-sonnet-4-6`) and continue via `entwurf_resume`; Layer 4 is a comparison with direct Claude Code, so it uses a separate path.

### 1A.1 Layer 0 — Self-Awareness at Session Start

Ask all three freely in a single session (environment self-awareness / MCP visibility / upstream-instruction awareness), explicitly prohibiting guessing.

Pass: mostly recognizes native tool family, says "I don't know" for things it doesn't know; answers MCP visibility only as the current configuration allows (says "not visible" if no config); carefully describes the type of upstream instructions without assertively reproducing internal prompts.

Fail: claims a tool that does not exist; conflates pi custom tools and native tools; hallucinates MCP visibility; **conflates the engraving carrier with the pi-context-augment surface** (see §1A.1.0).

#### 1A.1.0 Two carrier surfaces — engraving vs pi-context-augment

`entwurf` delivers identity-relevant text through **two structurally distinct surfaces**. A faithful self-report must keep them separated; collapsing them into "the system prompt" is the most common verifier-side mistake.

| Surface | Source | Delivery shape | Default content |
|---|---|---|---|
| **Engraving carrier** | `prompts/engraving.md` (or `ENTWURF_ACP_ENGRAVING_PATH`) via `engraving.ts` | Claude `_meta.systemPrompt` / Codex `-c developer_instructions=` / Gemini `GEMINI_SYSTEM_MD` — full-replacement identity slots | Operator-authored, optional opt-out, tiny non-empty by default on Claude ACP (replaces the `claude_code` preset and strips its auto-memory advertisement). Emptying the file is the explicit opt-out. |
| **pi-context-augment** | `pi-context-augment.ts` | First-user-message prepend (`enrichTaskWithProjectContext`). Not the system slot. | Always populated on ACP-routed targets. Three components must arrive: (1) the bridge identity line `You are operating through entwurf, an ACP bridge between pi (the harness) and the underlying model.`, (2) the `~/AGENTS.md` body, (3) the cwd repo's `AGENTS.md` wrapped in a `<project-context path="…">` block. |

> **Gemini carrier-isolation canary.** On Gemini, the engraving carrier is not truly empty even when `prompts/engraving.md` is placeholder — the bridge writes a single carrier-isolation line `[carrier-canary] GEMINI_SYSTEM_MD_CANARY_PISHELLACP_V1`. A faithful Gemini subject reports the canary verbatim and otherwise no entwurf identity text in the engraving slot. Absence of the canary is the regression signal that overlay isolation has drifted.

Pass (carrier honesty): the subject distinguishes engraving from pi-context-augment by name or structural description (system slot vs first-user prepend) without prompting; on ACP-routed targets confirms all three pi-context-augment components arrived; may quote `# Engraving Here` as the engraving carrier but must not attribute bridge identity / AGENTS / durable-memory policy to it.

Fail: attributes the bridge identity narrative to the engraving carrier; claims pi-context-augment is empty when the run is ACP-routed; invents engraving content the placeholder does not contain.

> **Native pi routing exception.** On native (non-ACP) targets, the cwd `<project-context>` is delivered as a normal prepend, but the bridge-identity line and `~/AGENTS.md` are not part of the native augment. The PASS criterion on native is **honesty about what arrived**, not the three-component checklist — see §1.7 axis-4.

#### 1A.1.1 Codex objective wiring check (when backend = codex)

The interesting evidence layer for Codex is **direct MCP tool calls** — an actual invocation cannot be dismissed as self-report. Recipe (current v2 surface):

1. Call the backend's literal `entwurf-bridge/entwurf_peers` with no args. Pass: response includes `controlDir`, integer `count`, and real `sessionId` / `socketPath` facts where live pi peers exist.
2. Call the backend's literal `entwurf-bridge/entwurf_self` with no args. Pass: response includes `sessionId`, `agentId`, `cwd`, `timestamp`, plus an absolute `socketPath` under `~/.pi/entwurf-control/` for pi sessions (or the trusted meta-session sender identity for meta-sessions).

> Calibration: `list_mcp_resources` reports MCP-server *resources* (data records), not the tool registry. `entwurf-bridge` exposes tools only, so it returns `{"resources":[]}` — empty is correct there, not an absence-of-bridge signal.

Asymmetry: Claude Code exposes no equivalent native introspection tool through the same path; `entwurf_peers` / `entwurf_self` are still callable on the Claude side but the agent must initiate the call.

### 1A.2 Layer 1 — Native tool use on basic coding tasks

Intent: throw common coding workflows (file reading / structure analysis / finding regression points / identifying verification commands) and see if native tool selection is natural. Pass: Read/Edit/Bash/Grep/Glob selections are natural; search → read → analyze flows smoothly; no unnecessary detour through MCP or recursive `pi` calls. Fail: handles simple file reading through strange detours; speaks from memory/guesses without reading files.

### 1A.3 Layer 2 — pi-facing MCP tool boundary

Intent: prevent tool confusion. By default, pi custom tools (`entwurf_v2`, `entwurf_peers`, `entwurf_self`, `entwurf_inbox_read`) not being visible is normal — they appear only when `entwurf-bridge` is explicitly registered. Pass: says tools it cannot see are not visible; explains the native-vs-MCP boundary. Fail: pretends to use a tool it cannot see; mimics `entwurf` by recursively calling `pi` via `bash`. Check together with §8.4 / §8.5.

### 1A.4 Layer 3 — Focus maintained as turns accumulate

Intent: not whether sessions continue, but whether quality is maintained in a continuing state. Inject a fact on the first turn (`entwurf`) → continue with `entwurf_resume` on the same sessionId 4–5 times, mixing retrieval/exploration/retrieval.

> When run **after §3 + §4 on the same target**, a fresh `entwurf` is no longer available (uniqueness per target). Inject the §1A.4 invariants on the next available turn of the same `sessionId`, then perform 3–4 more resumes mixing repo exploration before the recall quiz.

Pass (post-0.4.1): after **8 turns**, holds **3+ early-turn facts** including **one verbatim string injected before turn 5**; does not repeat already-done exploration or contradict itself; tool selection does not drift. Fail: forgets early reads; produces a tool strategy contradicting a previous turn; paraphrases an early-turn fact instead of returning the verbatim string.

> entwurf does not implement a user-facing compaction surface. Backend-native context management may still occur inside the backend, but this repo exposes no backend-specific compaction knobs and no bridge-owned `/compact`. Legacy `PI_SHELL_ACP_*` compaction knobs are retired and must not reappear. For long sessions, use the backend's own `usage_update` / bridge fallback meter as an overflow-risk signal and verify continuity with sentinel recall plus mapping stability. The footer follows the ACP backend's `usage_update.used / size`, not pi's visible-transcript estimate — a small pi conversation can show a large ACP footer; that is a backend overflow-risk signal, not a meter bug.

### 1A.5 Layer 4 — Comparison with Direct Claude Code

> **Prerequisite.** Requires a verifier capable of dispatching to **both** the `entwurf` path and a direct Claude Code path (human in the loop, or a verifier holding both transport handles). Attempting Layer 4 from inside a single bridged session produces symmetric output, not comparison.

Throw the same questions to both direct Claude Code and `entwurf/claude-sonnet-4-6` and compare semantic-level work quality and tool selection — latency to first response / native tool selection accuracy / unnecessary detours / MCP boundary confusion / quality maintenance around turns 10–15. Slightly slower or different phrasing is acceptable; **repeated tool confusion, long-turn forgetting, boundary-violation workarounds** are a fail.

### 1A.6 Result Interpretation

Layers 0–2 healthy → basic qualifications confirmed. Layer 2 weak → review tool description / MCP visibility explanation. Layer 3 weak → strengthen prompt shape and long-session observation; corroborate with `[entwurf:usage]`, bootstrap logs, process state, and sentinel recall. Layer 4 significantly weaker than direct → revisit bridge handoff or capability framing. This questionnaire does not replace smoke.

---

## 2. Reusing Existing Bench — major anomalies only

A **rough parity check, not session-integrity verification**.

```bash
cd "$REPO_DIR"
PI_BENCH_SUITE=quick ./bench.sh "$PROJECT_DIR"
PI_BENCH_SUITE=full ./bench.sh "$PROJECT_DIR"
```

Look for: ACP not acting stupidly vs direct; read/bash/search/git/sysprompt generally normal; responses not flying off in wrong directions. Check **semantic-level parity**, not exact strings. Passing this bench alone does not prove session continuity.

---

## 3. Single-Turn Verification — the first regression point to break

One sync `entwurf` call for `entwurf/claude-sonnet-4-6`.

> **Operational note — `entwurf` uniqueness per (provider, model, session).** The MCP bridge enforces one live `entwurf` per (provider, model) tuple within a verifier session. §3.1 and §3.2 are two separate single-turn intents, but the second cannot be a fresh `entwurf` to the same target — it must be the **first `entwurf_resume` of the same `sessionId`**. §3.1 verifies hook prompt extraction (turn 1), §3.2 verifies tool-call mapping (turn 2 = first resume). Fact injection (§4) begins from turn 3. If a fresh ACP session is strictly needed, run §3.2 against a different target.

### 3.1 SessionStart hook regression check

A single 1-turn requesting only a short answer ("reply with ok only"). Pass: `ok` or equivalently very short; does not mistake hook messages like `device=...`, `time_kst=...` for the main prompt. If broken, suspect `extractPromptBlocks()` in `index.ts`.

### 3.2 Basic tool call check

A 1-turn like "tell me the current date/time using `date`." Pass: evidence of running date, or at minimum a tool-based response; `[tool:start]` / `[tool:done]` notices may appear if event-mapper is attached.

---

## 4. Multi-Turn Verification — does a single target continue?

Start with `entwurf(provider="entwurf", model="claude-sonnet-4-6", mode="sync")`, then continue with `entwurf_resume` on the same sessionId. Facts follow the §0A wording guide (non-sensitive plaintext only).

### 4.1 Fact injection → retrieval → update

1. First turn: inject one non-sensitive fact and receive a short ack. E.g. "The password is owl. Reply with READY only, no explanation."
2. Second turn (`entwurf_resume`): retrieve it. "What was the password I just told you? Reply in one word only." → `owl`
3. Third turn: update the fact and receive `CHANGED`; retrieve the updated value on the fourth turn.

Pass: second turn answers correctly; last turn after update answers the updated value; continues without re-throwing a text blob. Fail: forgets the fact, requires the entire first turn re-sent, or the update is not reflected. If the response is a refusal, wording may have triggered safety — retry with ordinary plaintext per §0A; if retrieval still fails it's a real continuity problem, if it succeeds it was wording contamination.

---

## 5. Cross-Process Continuity — does it continue across process changes?

The `entwurf` → `entwurf_resume` pair from §4 is already **cross-process** (different child pi processes). Here also look at persisted mapping and cache.

### 5.1 Cache before/after observation

Run `find "$CACHE_DIR" -maxdepth 1 -type f | sort` twice, before and after §4. Pass: after the first turn, a persisted session record corresponding to `pi:<sessionId>` is newly created; it persists even after the first turn's child pi process exits; `entwurf_resume` with the same sessionId reuses that record to continue the ACP session.

---

## 6. Persistence Boundary — `cwd:` sessions must never be persisted

A core invariant of this repo. With pi routing, `sessionId` is often present, so this verification may directly hit the bridge API.

```bash
BEFORE=$(find "$CACHE_DIR" -maxdepth 1 -type f | wc -l)
echo "$BEFORE"
```

```bash
cd "$REPO_DIR"
node --input-type=module <<'EOF'
import { ensureBridgeSession, closeBridgeSession, normalizeMcpServers } from './acp-bridge.ts';

const cwd = process.cwd();
const key = `cwd:${cwd}`;
const { hash: mcpServersHash } = normalizeMcpServers(undefined);
const session = await ensureBridgeSession({
  sessionKey: key,
  cwd,
  modelId: 'claude-sonnet-4-6',
  systemPromptAppend: undefined,
  settingSources: ['user'],
  strictMcpConfig: false,
  mcpServers: [],
  bridgeConfigSignature: JSON.stringify({ appendSystemPrompt: false, settingSources: ['user'], strictMcpConfig: false, mcpServersHash }),
  contextMessageSignatures: ['verify:cwd-boundary'],
});
await closeBridgeSession(key, { closeRemote: true, invalidatePersisted: true });
console.log('cwd boundary check done');
EOF
```

```bash
AFTER=$(find "$CACHE_DIR" -maxdepth 1 -type f | wc -l)
echo "$AFTER"
```

Expected: `AFTER == BEFORE`; no new `cwd:`-based record. If broken, suspect `isPersistableSessionKey()`, `persistBridgeSessionRecord()`, `deletePersistedSessionRecord()`.

---

## 7. Ordinary Shutdown Semantics — process exit must preserve mappings

After a normal exit, persisted mappings must survive so the next child pi process can pick them up. When the first `entwurf` from §4 finishes, the child pi process exits naturally — the cache record must not be invalidated (already observed via §5.1). To recheck semantic continuity, throw one more `entwurf_resume` with the same sessionId after some time and confirm the previous context continues. Pass: continues from the previous context; normal exit does not mean invalidation. (Whether `resume`, `load`, or `new` was used is hard to tell externally at this stage — look at result continuity first; bootstrap-path observability is a future improvement.)

---

## 8. Tool Call / Event Mapping Verification

### 8.1–8.3 read / grep / bash character

One sync `entwurf` call each, different-intent short task sets: read part of a file and summarize, grep for a function definition, current git branch + latest commit. Pass: tool usage is consistent; notices appear naturally; final responses do not distort tool output. Observe whether `event-mapper.ts` flows text/thinking/tool notices appropriately and whether permission events appear at an observable level.

### 8.4 pi custom tool visibility — current key suspect point

What we look at is **whether pi's custom tools (`entwurf_v2`, `entwurf_peers`, `entwurf_self`, `entwurf_inbox_read`) are visible when going through ACP**. Native pi routing receives the same capability via extension surface, not MCP, so native targets correctly report `entwurf-bridge` as not visible.

> **Branching note — which PASS case applies depends on the project's `entwurfProvider.mcpServers`.**
> - empty/omitted → §8.4 PASS = the spawn replies `entwurf tool not visible` / `pi custom tools not visible` (default contract).
> - registers `entwurf-bridge` (e.g. this repo's checkout) → §8.4 reduces to an honesty check and §8.5 takes over as the actual visibility verification.
>
> Check first: `jq '.entwurfProvider.mcpServers // {} | keys' "$PROJECT_DIR/.pi/settings.json"` — `[]` means §8.4 strict path, populated means §8.5 strict path.

Agreed exact responses: `entwurf tool not visible`, `pi custom tools not visible`. Fail: hallucinates a nonexistent tool; mimics entwurf by recursively calling `pi` via `bash`; blurs the boundary; glosses over with only native tools. With the default (no config), **Claude Code native tools are visible but pi custom tools are not** — the normal state.

MCP tool-name notation differs across backends — a **verified property**, not a guess:

| Backend | Literal callable identifier | Outer separator | Inner server name |
|---|---|---|---|
| Claude | `mcp__entwurf-bridge__entwurf_v2` | `__` (double underscore) | `entwurf-bridge` (hyphen preserved) |
| Codex | `mcp__entwurf_bridge__.entwurf_v2` | `__` (double underscore) | `entwurf_bridge` (underscore-only) + **literal dot** after the server name |
| Gemini | `mcp_entwurf-bridge_entwurf_v2` | `_` (**single** underscore) | `entwurf-bridge` (hyphen preserved), no dot |

A Claude session reporting the underscore form, a Codex session reporting the hyphen form, or a Gemini session reporting either double-underscore form is a backend-identification leak. To probe, ask the agent to print the **literal callable identifier** for a known tool, verbatim, no transformation — do NOT ask "is the separator a hyphen or underscore" (ambiguous between the outer separator and the inner server name).

### 8.5 pi-facing MCP injection visibility — equal across resume/load/new?

The sole MCP responsibility of `entwurf` is to inject the MCPs registered in `entwurfProvider.mcpServers` equally into all ACP session requests (`newSession` / `resumeSession` / `loadSession`). The canonical check is the bundled `entwurf-bridge` entry written by `./run.sh install`.

- **Basic visibility (1 turn):** ask "list the visible MCP server names separated by commas." Pass: the registered MCP (`entwurf-bridge`) appears; unregistered MCPs do not (confirms no automatic `~/.mcp.json` loading).
- **resume/load/new consistency (multi-turn):** run two+ turns (§4 pattern) and confirm the MCP list is identical each turn. Fail: visible only in turn 1, or different in turn 2.
- **Config change → session invalidation:** changing `entwurfProvider.mcpServers` changes `bridgeConfigSignature`, so the persisted session fails compatibility and transitions to a new session. After add/remove, throw `entwurf_resume` or a new `entwurf` and confirm the new config is immediately reflected.

Run this for Claude, Codex, and Gemini when available, passing at least one bridged MCP tool call through. A negative-path `entwurf_send` to a nonexistent target that surfaces `No pi control socket …` proves the `ACP host → MCP bridge → pi-side RPC` path is alive.

---

## 9. Scenario Testing — use it like an actual worker

More important than synthetic benchmarks. One sync `entwurf` call each for a single target, different-intent task sets:

- **9.1 Self-understanding**: read AGENTS.md/README and summarize this repo's invariants in ≤7 lines (provider/model/settings names, continuity boundary, bootstrap order, what not to do).
- **9.2 Structural explanation**: explain the core structure based on `acp-bridge.ts`, `index.ts`.
- **9.3 Next improvement proposals**: 3 improvements that do not break the thin-bridge principle, each with reason / files to touch / verification method.

Pass: responses maintain the thin-bridge philosophy, understand own repo context, are grounded in actual files without hallucination.

---

## 10. Process/Cache Hygiene Verification

### 10.1 / 10.2 Pre- and re-observation

```bash
pgrep -af 'claude-agent-acp|codex-acp|gemini .*--acp|gemini --acp' || true
find "$CACHE_DIR" -maxdepth 1 -type f | sort
```

Run before and after multiple tests. Expected: backend ACP processes do not multiply indefinitely; cache records do not explode; no garbage records unrelated to `pi:<sessionId>`. An increase in cache count can be natural when creating new sessions — what matters is whether boundaries are maintained and whether orphans remain.

### 10.3 Expected backend ACP process count formula

Apply the same bound independently to each backend under test (`BEFORE_ACP` / `BEFORE_CODEX` / `BEFORE_GEMINI` from §1.5):

```
AFTER_<BACKEND> ≤ BEFORE_<BACKEND>
                + (number of distinct alive
                   (sessionKey, backend, modelId, bridgeConfigSignature) tuples
                   for that backend that this verifier run is currently holding open)
```

This is an **upper bound**, not an equation. Two effects push `AFTER` below the prediction: (1) **child reuse** — a single `entwurf` + N `entwurf_resume` on the same `(provider, model)` reuse one child, so delta=0 against that backend's baseline is expected; (2) **idle reaping** — long-idle children no caller is holding can exit between snapshots, so `AFTER` can be less than `BEFORE`. Settings changes that mutate `bridgeConfigSignature` (`mcpServers`, `tools`, `skillPlugins`, `permissionAllow`, `disallowedTools`, `appendSystemPrompt`, `settingSources`, `strictMcpConfig`) — or a `(provider, model)` switch — close the existing child and spawn a new one, pushing `AFTER` up by 1 per switch.

`AFTER_<BACKEND> > BEFORE_<BACKEND> + alive_tuples` is the actionable signal — an unexpected child appeared. Walk the parent chain to find the source:

```bash
for pid in $(pgrep -f 'claude-agent-acp|codex-acp|gemini .*--acp|gemini --acp'); do
  echo "=== $pid ==="
  ps -o pid,ppid,etime,cmd -p $pid | tail -1
  PARENT=$(ps -o ppid= -p $pid | tr -d ' ')
  ps -o pid,etime,cmd -p $PARENT 2>/dev/null | tail -1
  echo
done
```

Any backend ACP child whose parent `pi` process has already exited is an **orphan** — flag and preserve as evidence. If the parent is alive but matches no verifier-controlled sessionId, it's likely a prior cycle's leftover — identify and close before continuing.

---

## 11. pi Session Record Check — usable as a shared memory axis for andenken?

The key is whether **pi session files are maintained as the shared record source** even when using ACP. After the §4 pair finishes, locate the child pi session file and inspect it with `wc -l` / `tail`.

> **Path pattern (garden-native identity).** entwurf-spawned child pi sessions are Pi-named:
> ```
> ~/.pi/agent/sessions/--<cwd-encoded>--/<created-at>_<sessionId>.jsonl
> ```
> where `<cwd-encoded>` is the entwurf cwd with `/` replaced by `-` and `<sessionId>` is `YYYYMMDDTHHMMSS-[0-9a-f]{6}`. The JSONL header `id` is the real authority; the filename is a discovery aid:
> ```bash
> ls ~/.pi/agent/sessions/--*--/*_<SESSION_ID>.jsonl 2>/dev/null
> ```
> A naive `grep -rl <SESSION_ID> ~/.pi/agent/sessions/` also matches the **parent** verifier's session — use the path pattern instead. Schema reminder: `role` is at `.message.role`:
> ```bash
> jq -r '.message.role // .type' "$F" | sort | uniq -c
> ```

Pass: user/assistant turns accumulate normally in the pi session; the transcript is not broken or empty just because ACP was used; minimum session semantics remain for future embedding. What we preserve is the coexistence of "Claude via ACP, memory via pi axis."

---

## 12. Verification Points Not Yet Covered

Documented but observability/automation is still insufficient:

1. Making the actual bootstrap path (`resume` / `load` / `new`) immediately visible externally. Currently only verifiable via stderr `[entwurf:bootstrap]` lines, which the entwurf orchestration path does not surface to the front end. **Reinforcement:** the `ENTWURF_CHILD_STDERR_LOG` opt-in env mirrors child stderr to a file:
   ```bash
   export ENTWURF_CHILD_STDERR_LOG=/tmp/entwurf-verify-stderr.log
   # ... run §3 / §4 / §5 entwurf calls ...
   grep -E '\[entwurf:(bootstrap|model-switch|cancel|shutdown)\]' "$ENTWURF_CHILD_STDERR_LOG"
   ```
   This env must be present at bridge-process startup (see the §12.1 self-spawn limit in the strengthened rules). Without it, §5/§7 can only judge semantic continuity.
2. Surfacing persisted-session incompatibility reasons quickly — partially covered for the transcript-poison class via `[entwurf:prompt-error] reason=transcript_poison` (§12.6); the general incompatibility-reason gap remains.
3. Stream-shape stability as tool notices / thinking / text blocks accumulate in long sessions.
4. Automated separation of `bridge continuity` vs `semantic continuity` — the rule is in §0A, but no automated smoke judges them separately yet.

### Sub-gates (green; commands + pass criteria)

These flow `key=value` diagnostic lines to stderr; the smokes are fail-fast.

- **§12.3 Model-switch lock** — entwurf sessions are locked to their starting model after start (`pi-extensions/model-lock.ts` extension guard reverts any `model_select` touching `entwurf`; the bridge-side `ensureBridgeSession` guard throws `ModelSwitchLockedError` as a fallback before closing the old ACP child). Deterministic: `./run.sh check-model-lock` (18-case extension matrix — four provider quadrants, same-model no-op, fresh-startup freedom, `agent_start` anchoring, resume/fork/reload locks); this is the surviving gate (in `pnpm check`). The dedicated live `smoke-model-switch` gate was retired in v2. Expected live behavior, if exercised manually (within-Claude sonnet→opus, within-Codex gpt-5.4→gpt-5.5, cross-backend Claude→Codex): a `[entwurf:model-switch] path=reuse outcome=locked reason=entwurf_session_locked_to_starting_model` line; exactly one `[entwurf:bootstrap] path=new` line (no second bootstrap, no `outcome=respawn`, no cross-backend bootstrap); the second `ensureBridgeSession` throws `ModelSwitchLockedError`; a second prompt under the original model still completes (`stopReason=end_turn`). Note: this does not make the UX transcript fully clean — pi-core mutates `agent.state.model` before the extension/provider boundary can refuse, so the `model_change` record shows `X→Y→X` (extension revert) or the attempted `X→Y` (bridge fallback). A fully clean refusal needs a pi-core preflight this repo intentionally does not patch.
- **§12.4 Cancel / abort cleanup** — `onAbort` only calls `cancelActivePrompt()` (session stays reusable); the `streamShellAcp` catch block closes the bridge only on `stopReason === "error"` (with `invalidatePersisted` true *only* for the transcript-poison class, §12.6). The dedicated `smoke-cancel` gate was retired in v2; the cancel/abort invariant remains in code (`onAbort` → `cancelActivePrompt`; the `streamShellAcp` catch). Expected behavior, if exercised manually: `[entwurf:cancel]` present with `outcome=dispatched|unsupported` (not `failed`); next prompt with the same sessionKey succeeds (reuse); `[entwurf:shutdown]` present; after explicit `closeBridgeSession`, backend process delta is 0. Diagnostic lines: `[entwurf:cancel]`, `[entwurf:shutdown]`, `[entwurf:orphan-kill]` (printed if `destroyBridgeSession`'s 2s wait for child exit elapses).
- **§12.5 Entwurf-style continuity (bridge-level)** — mimics the exact spawn form entwurf uses to verify turn1=new → turn2=resume(Claude)/load(Codex) continuity. Smoke: `LIVE=1 ./run.sh smoke-entwurf-v2-spawn-resume-live` (the v2 spawn-bg resume lifecycle that replaced the v1 `smoke-entwurf-resume`). Pass: turn1 `[entwurf:bootstrap] path=new backend=<backend>` + ≥1 `role:"assistant"` record; turn2 `[entwurf:bootstrap] path=resume|load` with acpSessionId matching turn1; no `bootstrap-invalidate` / `bootstrap-fallback` lines; assistant message count ≥2. This proves only bridge-level continuity; which target to spawn for / async orchestration / resume identity lock is handled by `pi/entwurf-targets.json` + `mcp/entwurf-bridge` (orchestration gate = `mcp/entwurf-bridge/test.sh` + `scripts/session-messaging-smoke.sh`).
- **§12.6 Transcript-poison invalidation (#12)** — a poisoned backend transcript (empty user/text content block, with or without a `cache_control` breakpoint) survives every `resumeSession` of the same `acpSessionId` and returns the same Anthropic 400 forever. Two surfaces: `cache_control cannot be set for empty text blocks` and `text content blocks must be non-empty`. The bridge classifies both as `transcript_poison`, drops the persisted mapping, and surfaces `[entwurf:prompt-error] reason=transcript_poison`; recovery is the host's normal re-entry firing the next bootstrap as `path=new`. The dedicated `verify-transcript-poison` smoke was retired in v2; the classifier (`isTranscriptPoisonError`) and the `invalidatePersisted`-on-poison behavior remain in code (`index.ts`). Expected behavior: the classifier matches both poison surfaces and only those (including adjacent-string traps); `invalidatePersisted: true` removes the record at `~/.pi/agent/cache/entwurf/sessions/<sha256(sessionKey)>.json` while `false` leaves it intact; `invalidatePersisted` is `true` only on this poison class, `false` for every other error class.

### Evidence preservation when a problem occurs

```bash
pgrep -af 'claude-agent-acp|codex-acp|gemini .*--acp|gemini --acp' || true
find "$CACHE_DIR" -maxdepth 1 -type f | sort
ls ~/.pi/agent/sessions/--*--/*_${SESSION_ID}.jsonl 2>/dev/null
[ -n "$ENTWURF_CHILD_STDERR_LOG" ] && \
  grep -E '\[entwurf:(bootstrap|model-switch|cancel|shutdown)\]' "$ENTWURF_CHILD_STDERR_LOG"
```

Also preserve: exact calls used (provider/model/mode + resume sessionId), full stdout/stderr, the child pi session file path, cache directory changes, and the difference between expected and actual results.

---

## 14. Pass Criteria

The minimum passing bar:

1. Smoke passes.
2. No major anomalies in bench quick/full.
3. Single-turn prompt extraction normal.
4. Same `SESSION_FILE` multi-turn continuity normal.
5. Cross-process continuity normal.
6. `cwd:` persistence boundary normal.
7. Tool use / event mapping generally normal.
8. No excessive orphan processes / garbage records.
9. pi session transcript is usable as a shared memory axis.
10. pi-facing MCP injection is reflected only as configured in `entwurfProvider.mcpServers`, visibility is identical across resume/load/new, sessions are correctly invalidated on config change, and invalid configs fail-fast with `McpServerConfigError`.
11. **Identity boundary preservation across backends and machines** — for every shipped or explicitly probed backend, regardless of install path or host, the bridged model honestly identifies the harness as `entwurf`, names its backend accordingly, lists the same configured MCP server (`entwurf-bridge`) and MCP tool function set, and presents a **backend-native** (not normalized) tool surface. Confabulation about pi internals or cross-backend tool-surface contamination is a fail.

Passing all 11 establishes a **release verification floor**, not a full 8-hours-a-day operational guarantee. The floor says: protocol smoke holds, the agent honestly recognizes its environment, no tool surface is normalized away, no cross-backend identity leaks, no orphan processes. It does **not** say a real-day workload (50–100+ turns, tool-heavy bursts, partial MCP failures, auth/version drift over weeks) survives — that needs L3–L5 evidence (see the appendix).

---

## Appendix — evidence history, claims ledger, experimental directions

The full R2R run history, per-claim evidence ledger, and experimental tracks accreted across 0.4.x–0.8.x and live in `CHANGELOG.md` and git history. They are summarized here so the recipe above stays readable.

### Evidence levels reached

The history reached **L1** (intra-Anthropic, 2026-04-27) and **L2** (cross-vendor + reverse-direction MCP calls, 2026-04-29). **L3** is partially exercised by §10 process snapshots and §11 session-file checks but not as a coherent verifier loop. **L4** needs the operator (BASELINE.md territory) or a non-bridged direct path. **L5** has not been run. The honest gap is L3 → L5.

### Claims ledger (summary)

A per-claim ledger (load-bearing claims with level-reached / current evidence / remaining blind spot / next test) was maintained through 0.5.x–0.8.x and now lives in git history. Load-bearing summary:

- Bridge identity (`entwurf`) recognized across shipped/probed backends and hosts — **L1–L4 mixed**.
- MCP server (`entwurf-bridge`) + its 4 v2 tools wired and operational — **L2** (`check-bridge` pins the objective contract).
- Native tool surface stays backend-specific (no normalization) — **L1**.
- MCP callable identity stays backend-shaped (§8.4 table) — **L1/L2 mixed**.
- Bidirectional cross-vendor entwurf orchestration works — **L2** (Codex spawned Claude via entwurf, 2026-04-29).
- Compaction boundary: no bridge-owned compaction surface / no `PI_SHELL_ACP_*` knob; backend-native context management may still occur — **L0–L2 mixed** (no dedicated compaction smoke).
- Long-session fact retention across 8+ turns under the 0.5.0 policy — **L1** (0.4.x baseline; needs 0.5.0 re-baseline since the backend may now self-compact).
- Backend ACP child reuse + idle reaping within the §10.3 bound — **L2/L3 partial**.
- `entwurf` performs at native quality on 8-hour-a-day workloads — **NOT YET MEASURED** (needs L4/L5).
- Operator-config isolation overlays preserve backend identity while hiding operator state — **L2+L3**.
- Spawn harness invariant — entwurf spawn target must be a YOLO harness (`pi`; `claude-code` candidate); backend CLIs are model carriers, not spawn targets — **L4** (operator-observed live pair, not a formal smoke).

When a new claim enters README / AGENTS.md / CHANGELOG, add a ledger row in git history with the level it actually rests on. If a claim cannot reach L1, it is narrative, not verified.

### Experimental directions (load-bearing, not yet run)

1. **Full 4-cell verifier × subject matrix with L3 corroboration** — for each cell record raw MCP payload (`entwurf_peers` / `entwurf_self` / `entwurf_send`), session JSONL on-disk hash, socket aliveness via `lsof`, `pgrep` baseline+delta, and bridge bootstrap diagnostic. The intra-Codex baseline cell is the open one.
2. **Long-haul soak (L5)** — a 2–4 hour single-session run: 50–100 short turns, periodic verbatim-fact recall every 10–15 turns, tool-heavy bursts, compaction policy observation (pi-side blocked / backend-native allowed), usage/footer drift recorded each turn, mid-run partial-failure injection (kill an MCP server, restart, resume).
3. **Direct-native parity panel (L4)** — same 15–25-prompt batch against `entwurf/<model>` vs direct CLI for Claude / Codex / Gemini. Semantic scoring; pass = bridged quality within run-to-run noise of the matching direct path. This is the only test that can back the claim "entwurf is native-quality."

### Run history (pointer)

The end-to-end VERIFY run log (2026-04-27 → 2026-05-29, pi-shell-acp era, Claude/Codex/Gemini R2R) lives in CHANGELOG/git. Highlights: first ACP-routed Claude full pass (04-27); post-0.4.1 replicant pair, 4 facts across 9 turns verbatim (04-29); cross-vendor axis-3 both directions, prompt-only echo-chamber risk closed at L2 (04-29); 0.5.0 three-subject R2R incl. native-vs-ACP axis-4 + Codex dot-suffix pinned (05-14); Gemini axis-3 closed, single-underscore namespace pinned (05-14); 0.8.0 pre-cut R2R run concurrently with the deterministic release-gate (05-29).
