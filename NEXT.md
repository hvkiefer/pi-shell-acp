# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 결정 trace 와 evidence 는 commit history / CHANGELOG / VERIFY / BASELINE / README / AGENTS / 코드로 보낸다.

## Top priority — 0.8.0 release campaign (dependency alignment + full test gate)

**Baseline:** 0.7.6 released (async-resume regression closed; see CHANGELOG 0.7.6 + commit chain `ff85fa9 → … → d198da0`). pi host is now `0.77.0`. GPT-5.5 reviewed pi 0.77.0 release notes **and** this NEXT plan twice (see reference below); all four follow-up reinforcements folded into the steps. Target: **bump every dependency to latest, consolidate a single all-pass release gate, then cut 0.8.0.**

Sequenced — each step verified before the next. **GLG makes the final commit.** Execution model: GPT-5.5 (sync) for design review, GPT-5.4 for test cycles, GLG + Claude for final verification. Test invocation is ALWAYS through `run.sh` subcommands — never call a script in `scripts/` directly.

### Step 1 — Dependency bump (latest, confirmed 2026-05-29)

| Package | Current pin | Latest | Where |
|---|---|---|---|
| `@earendil-works/pi-{ai,coding-agent,tui}` | `0.75.4` | **`0.77.0`** | `package.json` devDeps |
| `@agentclientprotocol/claude-agent-acp` | `0.36.1` | **`0.38.0`** | `package.json` deps |
| `@zed-industries/codex-acp` | `0.14.0` | **`0.15.0`** | `package.json` deps |
| `@agentclientprotocol/sdk` | `0.22.1` | `0.22.1` | already latest — no change |

Pin sites to update in lockstep (grep `0.75.4` / `0.14.0` / `0.36.1`):
- `package.json` deps + devDeps.
- `run.sh` `CLAUDE_ACP_REQUIRED_VERSION` / `CODEX_ACP_REQUIRED_VERSION` (separate hardcoded pins, `run.sh` ~check-pack-install region).
- `README.md:113` install snippet (`@zed-industries/codex-acp@0.14.0`) + any pi-version prose in docs.

**`check-dep-versions` is currently incomplete — extend it (GPT-5.5 reinforcement 2):** today it only asserts `claude-agent-acp`, `codex-acp`, and the README codex pin (`run.sh:2515`, "6 assertions"). It does NOT verify `@earendil-works/pi-{ai,coding-agent,tui}` at all, nor the `check-pack-install` peer-install pin. Add assertions so the three pi devDeps agree across `package.json` + `check-pack-install` peer pin — otherwise it is not really a "dependency alignment gate".

- `claude-agent-acp 0.36.1 → 0.38.0` and `codex-acp 0.14.0 → 0.15.0` are minor bumps across backend SDKs — run `check-sdk-surface` + live `smoke-all` to confirm bridge cast annotations and 3-backend runtime still hold.

### Step 2 — Opus 4.7 → 4.8 (REPLACE — 4.8 only)

**Decision (GLG, 2026-05-29): support 4.8 only.** Live surfaces replace `claude-opus-4-7` → `claude-opus-4-8`; VERIFY/CHANGELOG history rows keep `4-7` as historical evidence (do not rewrite history).

pi 0.77 added `claude-opus-4-8` metadata, but pi-shell-acp is a **curated surface** — it does NOT auto-expose. All live sites change in lockstep (grep `claude-opus-4-7`, ~20 sites):

- `index.ts:198` `SUPPORTED_ANTHROPIC_MODEL_IDS` + `:284`/`:288` placeholder injection (+ comment `:231`, `:317`)
- `pi/entwurf-targets.json` entry
- `run.sh` model gates: `:944` model-switch smoke, `:2382` / `:2422` / `:2480` `check-models` lists
- `scripts/check-model-lock.ts:214` `PSA_OPUS`
- `plugins/openclaw/src/index.ts:245-267` **AND `plugins/openclaw/dist/index.js:69-91`** — plugin `main` is `dist/index.js`, so source-only edits leave the runtime stale (GPT-5.5 reinforcement 4). Either `pnpm --filter ./plugins/openclaw build` to regenerate dist, or hand-sync both; `check:plugins` should catch type drift but not a stale literal — verify dist matches source after.
- `plugins/openclaw/README.md`, `plugins/openclaw/examples/docker-lab/*` (README + `config/openclaw.json`)
- docs surfaces: `demo/README.md:115`, `docs/setup-clean-host.md:199/228`
- **`check-models` must prove 4.8 is real, not a placeholder (GPT-5.5 reinforcement 5):** the `index.ts` placeholder-injection path can mask a missing 0.77 registry entry. Update `check-models` to assert `claude-opus-4-8` exists in the pi 0.77 model registry AND surfaces at 1M context — so a silent metadata gap fails the gate instead of being papered over by the injected placeholder.
- Add Claude runtime smoke / interview evidence on 4-8 before release.

### Step 3 — ONE release gate (the real ask: "다 통과해야 릴리즈, run.sh 명령 하나")

**The deliverable: a single `run.sh` subcommand that, when green, is sufficient to release. No script in `scripts/` is ever called directly — everything goes through `run.sh`.**

**First, name the two axes clearly (this is the "smoke vs check 뭐가 다른가" confusion).** The `check-`/`smoke-` prefix does NOT currently separate static from live:

- **Static / deterministic (no API, no backend subprocess)** — fast, free, pre-commit safe: `lint`, `typecheck`, `check:plugins`, `check-mcp`, `check-shell-quote`, `check-plugin-empty-final-recovery`, `check-plugin-prompt-format`, `check-async-resume-gate`, `check-models`, `check-backends`, `check-registration`, `check-dep-versions`, `check-sdk-surface`, `check-pack`, **`check-model-lock`**, **`verify-transcript-poison`**. → this set is `pnpm check`'s job.
- **Live / runtime (spawns a real backend, costs tokens — fine, all subscription)**: `smoke-all` (3-backend), `smoke-async-resume`, `smoke-continuity`, `smoke-cancel`, `smoke-model-switch`, `smoke-entwurf-resume`, `check-bridge`, `check-native-async`, `sentinel`, `session-messaging`, `smoke-compaction-policy`.
- **Naming smell to fix:** `check-bridge` and `check-native-async` are `check-`-prefixed but are actually LIVE. Rename or document so the prefix is honest, OR drop the prefix as a signal and rely on the gate grouping. Decide during dedup.

**Problems to fix:**
1. `pnpm check` MISSES two deterministic gates that belong in it: **`check-model-lock`** and **`verify-transcript-poison`** (both no-API per their usage text). Fold them in — the static set must be honestly complete.
2. There is **no single "run everything" gate.** The live smokes are scattered and never bundled → "Claude만 / sync만 통과" is structurally possible today.

**Work:**
1. Fold `check-model-lock` + `verify-transcript-poison` into `pnpm check`.
2. **Dedup FIRST, then bundle** (so the single command isn't bloated with redundant work). Audit overlap and either collapse or document why both must exist:
   - `smoke-entwurf-resume` vs `smoke-async-resume` vs `sentinel` — all touch entwurf continuity. What does each prove uniquely?
   - `check-bridge` vs `check-native-async` — both exercise the bridge/MCP live.
   - `smoke-continuity` vs `smoke-entwurf-resume` — both are resume/bootstrap gates.
   - Goal: no redundant or orphaned script in the release set; we can *prove* every distinct invariant ran exactly once.
3. **Add the single target — `./run.sh release-gate`** (working name): runs `pnpm check` (full static) → every surviving live smoke across **all 3 backends** → emits one consolidated PASS/FAIL/SKIP summary, fail-closed.
   - **Gemini skip policy (GPT-5.5 reinforcement 1):** the FINAL release gate must NOT skip Gemini — 0.8.0 makes a three-backend claim, so Claude/Codex/Gemini must all actually PASS (skip = FAIL). A dev-only `--allow-skip-gemini` flag may exist for iteration, but the default release path treats a missing Gemini as failure, not a silent pass. (Current `smoke-all` silently best-effort-skips Gemini — that's the dev behavior, not the release behavior.)
4. **Add a `-xt` / `--exclude-tools` tool-surface truthfulness smoke (GPT-5.5 reinforcement 6 + pi 0.77 review):** pi 0.77's `--exclude-tools` can hide tools, but the Claude backend hands Read/Bash/Edit/Write to Claude Code itself — so `pi --provider pi-shell-acp -xt Bash` may make pi's *declared* tool surface diverge from the backend's *actual* surface, violating our "declared tools == actual tools" invariant. At least one focused gate (deterministic if possible, else live) must verify pi-shell-acp does not lie about its tool surface under `-xt`. This joins the release gate.
5. Wire the consolidated gate into `prepublishOnly` (or document precisely why publish runs a subset vs the full local release gate).

> Principle: **a release is valid only when the full set passed.** Adding a feature adds a test; the test joins the release gate. No backend-specific or sync-only shortcut counts as "tested."

### Step 4 — README / docs / OpenClaw metadata corrections

OpenClaw publish status is currently self-contradictory across three files (GPT-5.5 reinforcement 3). `@junghan0611/openclaw-pi-shell-acp@0.0.1` IS live on npm (confirmed 2026-05-29) but parked. Separate the two axes — **npm: published-but-parked** vs **ClawHub: not published**:

- **`README.md:130`** says "not published to npm or ClawHub yet" — wrong on the npm half. Fix to: published to npm as `0.0.1` (parked, no work since), not on ClawHub.
- **`README.md:92`** already says "ships as its own npm package" — reconcile so :92 and :130 tell the same story.
- **`plugins/openclaw/package.json`** has `openclaw.release.publishToNpm: false` while 0.0.1 is actually on npm. Re-examine this field's meaning: either it's stale (flip to reflect reality) or it means "do not auto-publish from CI" (then document that intent). `publishToClawHub: false` stays correct.
- Reconcile any version strings touched in Steps 1–2 (`check-dep-versions` will enforce most).

### Step 5 — Cut 0.8.0

Only after Step 3's consolidated gate is green end-to-end: version bump, CHANGELOG, publish, agenda stamp.

---

## GPT-5.5 review of pi 0.77.0 release notes (2026-05-29) — reference

Incorporated into Steps 1–3 above; kept here for trace.

- **devDependency alignment — confirmed.** 0.75.4 → 0.77.0, min gate: `pnpm install` + `typecheck` + `check-registration` + `check-dep-versions` + `check-models`.
- **`--exclude-tools` / `-xt` — the new axis to watch.** pi native can hide tools (`pi --provider pi-shell-acp -xt Bash`), but the Claude backend hands Read/Bash/Edit/Write to Claude Code itself → pi's declared tool surface and the backend's actual surface may diverge, conflicting with our "declared tools == actual tools" invariant. Not an immediate break, but needs a **focused smoke**: does `-xt Bash` make pi-shell-acp lie about its tool surface? Operationally: `-xt Read/Bash/Edit/Write` still risky on pi-shell-acp sessions; `-xt entwurf` / `-xt entwurf_send` (extension tools) disable as intended.
- **`session_shutdown` signal fix — positive.** 0.77 guarantees `session_shutdown` cleanup on SIGTERM/SIGHUP. This repo depends on it (ACP child cleanup, control-socket cleanup, session env/status cleanup) in `index.ts` + `pi-extensions/entwurf-control.ts`. Upstream leak reduction — verify our cleanup paths still fire under it.
- **`streamingBehavior` — no current impact.** Our extensions don't use `InputEvent.streamingBehavior` directly. Touches `entwurf_send` steer/follow_up semantics — reference for future live peer-messaging UX work.
- **Codex headless subscription login — indirect positive.** Default entwurf target is `openai-codex/gpt-5.4`; native Codex login on headless hosts gets easier. Candidate note for `docs/setup-clean-host.md`.
- **NEW axis to add as a Step-3 smoke candidate:** `-xt` tool-surface truthfulness check.

### GPT-5.5 second review — of this NEXT plan (2026-05-29)

Verdict: NEXT adoptable; four reinforcements needed. All four folded into the steps above:

1. **Release gate must NOT skip Gemini at final release** — three-backend claim ⇒ all three actually PASS; `--allow-skip-gemini` is dev-only, default = skip-is-fail. → Step 3.3.
2. **`check-dep-versions` doesn't check pi devDeps** — only claude-agent-acp/codex-acp/README codex pin today; add `@earendil-works/pi-{ai,coding-agent,tui}` + `check-pack-install` peer pin. → Step 1.
3. **OpenClaw metadata conflict** — README:92 vs :130 vs `package.json publishToNpm:false`; split "ClawHub not published / npm published-but-parked". → Step 4.
4. **Opus 4.8 must sync generated dist** — `plugins/openclaw/dist/index.js` still has `claude-opus-4-7`; plugin main is dist, so source-only edit drifts. Also `check-models` must verify 4.8 registry presence + 1M context, not let placeholder injection hide a metadata gap. → Step 2.

---

## Deferred — not part of 0.8.0 unless GLG reopens

- **`--session-id`** — new pi CLI flag for exact project-local session ids. Entwurf intentionally uses `--session <absolute sessionFile>` (file-identity dependent). Do not rewrite the entwurf path just because the flag exists. Possible pilot: small `run.sh` automation/smoke where fixed IDs improve determinism. Does NOT solve ACP backend continuity footguns from bridge config signature drift.
- **RPC `bash.excludeFromContext`** — pi 0.77 lets RPC clients run bash while keeping output out of the next model prompt. Matters beyond tokens: noisy output pollutes transcript / recall / semantic-memory embeddings. Audit pi-shell-acp / helper / MCP / session-control paths using pi RPC bash. Principle if adopted: operational probes should be observable to the caller without auto-becoming model/embedding context unless explicitly useful.

---

**OpenClaw 쪽은 당분간 진행하지 않는다.** `3a65072 docs(openclaw): recommend native lanes for Claude/Codex, narrow plugin to Gemini` 로 정리한 대로, OpenClaw 5.22 native `claude-cli` 가 Pro/Max 결제 + 1M ctx + workspace skill + live-session 재사용까지 충분히 동작함을 확인했다. Claude/Codex lane 은 OpenClaw native 를 쓰면 되고, 우리 OpenClaw plugin 은 더 밀 필요가 없다.

`pi-shell-acp` 본체는 계속 **pi extension / ACP bridge / entwurf surface** 로 유지한다. OpenClaw plugin 은 “Gemini lane 이 필요할 때 쓸 수 있는 보조 어댑터” 정도로 parked.

---

## Standing focus — Asymmetric Mitsein with Claude Code

(0.8.0 캠페인과 병행하는 상시 초점. 릴리즈 게이트 작업이 끝나면 다시 전면으로.)

당분간 초점은 **비대칭 공존(Asymmetric Mitsein)** 이다. `pi-shell-acp` 를 OpenClaw plugin 쪽으로 더 밀기보다, **pi session ↔ Claude Code / external MCP host ↔ pi-tools-bridge ↔ entwurf** 가 서로 다른 하네스 정체성을 유지하면서 함께 일하는 시나리오를 검증한다.

핵심 질문:
- Claude Code 쪽에서 `pi-tools-bridge` MCP surface 를 통해 pi session / entwurf 와 자연스럽게 협업하는가?
- 외부 MCP host 는 replyable 하지 않다는 비대칭을 agent 가 정확히 이해하는가?
- `entwurf_send` 는 fire-and-forget, `entwurf` / `entwurf_resume` 는 outcome ownership 이라는 역할 분담이 실제 워크플로에서 헷갈리지 않는가?
- Claude Code 가 설계/리뷰하고 pi-shell-acp 세션이 실행하거나, 반대로 pi 가 Claude Code 쪽 맥락을 불러 협업하는 시나리오가 문서/로그/UX 상 정직한가?

테스트 시나리오 후보:
1. **Claude Code → live pi session send**
   - `entwurf_peers` 로 sessionId 확인
   - `entwurf_send(mode=follow_up)` 로 pi session 에 작업 전달
   - receiver 는 sender envelope / external non-replyable 상태를 오해하지 않는지 확인
2. **Claude Code → pi-native entwurf**
   - external MCP host 에서 가능한 sync path 와 pi-native async path 의 차이를 명확히 기록
   - 긴 작업은 pi session 안에서 async entwurf 로 넘기는 패턴 확인
3. **pi session ↔ Claude Code 역할 분리**
   - Claude Code: 설계/리뷰/코드 읽기
   - pi-shell-acp: 실행/검증/entwurf orchestration
   - 서로 forward 하지 않고 GLG가 역할을 정하는 패턴 유지
4. **세션 연속성 + 비대칭 공존**
   - 아래 `session continuity hygiene` footgun 과 결합 테스트
   - 옵션 drift 로 backend session 이 새로 열릴 때 Claude Code 연계 시나리오가 어떻게 깨지는지 확인

성공 기준:
- 각 시나리오에서 “누가 outcome 을 소유하는가”가 명확하다.
- replyable / non-replyable, send-is-throw, MCP `entwurf_resume` 조건부 async default(0.7.6)와 external non-replyable sync-default/reject 경계가 agent 발화에 정확히 반영된다.
- 필요한 경우 README / AGENTS / VERIFY 중 한 곳에 운영 패턴으로 정리한다.

---

## Active hygiene — session continuity

오늘 발견: 같은 pi 세션을 resume할 때 실행 옵션이 달라지면 bridge config signature 가 달라져 ACP backend session 이 `incompatible_config` 로 invalidate 된다.

대표 footgun:

```bash
pi --entwurf-control --emacs-agent-socket server   # 평소 alias
pi                                                  # 테스트로 plain 실행
```

현재 결론:
- 사용자가 일관되게 alias 로 실행하면 문제 없음.
- 직접 원인 후보는 `--emacs-agent-socket server` 누락. 이 값이 `bridgeConfigSignature` 에 들어감.
- pi JSONL 세션은 남지만, Claude ACP backend 세션 매핑이 새로 만들어져 모델이 이전 맥락을 모르는 것처럼 반응한다.

다음 작업 후보:
1. `incompatible_config` 로그에 diff 출력
   - 예: `emacsAgentSocket: null -> "server"`
   - 최소한 어떤 축 때문에 invalidate 됐는지 보여주기.
2. `PI_SHELL_ACP_STRICT_BOOTSTRAP=1` 운영 문서화 또는 UX 검토
   - silent new 대신 fail-fast 로 잡을 수 있는지 확인.
3. `emacsAgentSocket` 을 session compatibility 축에 넣는 게 맞는지 재검토
   - MCP child env / Emacs skill surface 정합 때문에 넣은 의도는 이해됨.
   - 다만 resume continuity 를 끊을 만큼 강한 config 인지 판단 필요.

검증 기준:
- alias 실행 → resume/load 유지
- plain 실행 후 alias 복귀 → 현재는 `incompatible_config`; 개선 후 원인 diff 명확
- `./run.sh verify-resume <project>` 또는 작은 live smoke 로 확인

---

## Main backlog — #25 lessons from OpenClaw audit

OpenClaw 5.22 native `claude-cli` audit 에서 얻은 lesson 을 **pi-shell-acp 본체 품질**로 흡수한다. OpenClaw plugin 기능 확장이 아니라 bridge hygiene 라운드다.

우선순위:
1. **Transcript pre-flight**
   - backend native jsonl 위치 verifier
   - Claude: `CLAUDE_CONFIG_DIR`
   - Codex: `CODEX_HOME` / `CODEX_SQLITE_HOME`
   - Gemini: `GEMINI_CLI_HOME`
2. **Invalidation reason taxonomy**
   - 지금 `incompatible_config` 가 너무 넓다.
   - 후보: `auth-profile`, `auth-epoch`, `system-prompt`, `mcp`, `transcript-missing`, `emacs-socket`, `tool-surface`.
3. **Session cache hygiene**
   - `acp-bridge.ts` bridge session cache 에 idle timeout / LRU / max-N cap 검토.

나중 후보:
- Fingerprint-keyed reuse: skills snapshot + extra system prompt hash 축
- Single-turn lock per session: 같은 sessionId 동시 prompt 진입 throw

---

## Reference paths

- 본체: `~/repos/gh/pi-shell-acp/`
- OpenClaw source: `~/repos/3rd/openclaw/`
- OpenClaw plugin stub: `plugins/openclaw/`
- Consumer: `~/repos/gh/agent-config/`
- NixOS consumer: `~/repos/gh/nixos-config/`

---

## Parked — do not pick unless GLG reopens

### OpenClaw plugin / packaging

- Phase 3.6 self-contained install
- ClawHub trust mark elevation
- plugin embedded runtime / child `pi` removal
- OpenClaw delivery layer progress/final channel split
- Oracle Docker image 3-layer install
- agent-config server-mode `pi-shell-acp` ref 복귀
- Gemini bot usage 표시 갭

이유: OpenClaw native `claude-cli` / `openai-codex` 가 이미 충분히 좋다. 우리 plugin 을 Claude/Codex lane 에서 쓸 이유가 줄었다. Gemini lane 은 필요 시 재개.

### Long-term / separate issues

- #11 remote SSH resume cwd alignment
- #10 broader ontology RFC
- #8 ACP `entwurf_send` message visibility UX
- #2 pi-first context meter
- L5 long soak with repeated context-pressure events
- ~~pi-tools-bridge MCP async surface~~ → 더 이상 deferred 아님. "Top regression — Phase B"로 승격.
- Remote entwurf cleanup

---

## Closed baseline reminders

- `@junghanacs/pi-shell-acp@0.7.6` published (latest before 0.8.0 campaign).
- `@junghan0611/openclaw-pi-shell-acp@0.0.1` published 2026-05-21 (confirmed live on npm 2026-05-29), parked — no work since publish. README must reflect *published-but-parked*, not "not yet published".
- Recommended routing as of 2026-05-26:
  - Claude: OpenClaw native `claude-cli`
  - Codex: OpenClaw native `openai-codex`
  - Gemini: `pi-shell-acp` ACP lane if richer MCP/skill surface is needed
