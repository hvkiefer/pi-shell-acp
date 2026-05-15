# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 결정 trace 와 evidence 는 commit history / CHANGELOG / VERIFY / BASELINE 으로 보낸다.

## Reference paths

- **OpenClaw source**: `~/repos/3rd/openclaw/` (baseline **2026.5.12** — 5.7~5.11 stable 없이 한 점프, peer range `>=2026.5.12 <2026.6.0`)
- **OpenClaw lab branch**: `lab/pi-shell-acp-0.6.0`
- **Workspace baseline (검증 cwd)**: `~/repos/gh/openclaw-config/config/workspace/` — `AGENTS.md` / `IDENTITY.md` / `SOUL.md` / `HEARTBEAT.md` / `MEMORY.md` / `TOOLS.md` / `USER.md` / `skills/`
- **ACP backend source**: `~/repos/3rd/acp/` — `agent-client-protocol/`, `claude-agent-acp/`, `codex-acp/`, `gemini-cli/`, `agent-shell/`, `acp.el`, `zed/`, `obsidian-agent-client/`, `openclaw-acpx/`
- **repo**: `~/repos/gh/pi-shell-acp/` (앞으로 monorepo lite — root + `openclaw-plugin/` sibling)
- **consumer**: `~/repos/gh/agent-config/`
- **llmlog**: `~/org/llmlog/` (특히 `20260514T152506`, `20260515T082725`)

---

## Strategic Frame — 정공법 4-Phase

> 결정 (2026-05-15 GLG):
> **(1) pi.dev 정식 등록 / OpenClaw ClawHub 정식 등록 — 둘 다 정공법.**
> 준비 과정에서 repo 정리, 재현 가능 설치면, 문서 기준이 올라간다.
> pi-shell-acp 를 신뢰 못 하면 OpenClaw 도 절대 등록 안 해 준다.
> 따라서 **OpenClaw plugin 을 푸시하기 전에 pi.dev 등록 준비를 refactor 수준에서 빡세게 한다.**
>
> 시간 압박: pi-shell-acp 동작 보면 누가 먼저 OpenClaw 에 올릴 수도 있다.
> 지금은 pi.dev 등록 안 되어 몰라서 안 쓸 뿐. 우리도 1시간 안에 다 붙였다.

| Phase | 이름 | 진입 조건 | 산출물 |
|-------|------|----------|--------|
| **0** | Validation 닻 | — | 6축 GREEN + 5.12 baseline GREEN + install scanner trust model 파악 (완료) |
| **1** | pi.dev hardening | Phase 0 완료 (✅) | #15 stabilization + #13 publish prep. acp-bridge.ts 감사성 강화. tarball pack 검증. pi-shell-acp pi.dev 등재 가능 상태 |
| **2** | Oracle baseline 실사용 | Phase 1 진행 중 가능 | OpenClaw plugin 1단계. 내 Oracle bot 에 git-local 또는 tarball install → 실사용. 문제 파악 |
| **3** | OpenClaw 정식 등록 준비 | Phase 1 완료, Phase 2 결과 반영 | `@junghan0611/openclaw-pi-shell-acp` npm publish + ClawHub 정식 등록 → `dangerouslyForceUnsafeInstall` flag 없이 `openclaw plugins install <pkg>` 한 줄 |

각 phase 의 commit 은 별도. push 는 GLG 가 결정.

---

## Phase 0 — Validation 닻 (✅ 완료)

> 검증 끝. 새 일 만들지 않음. 다음 phase 들의 출발선.

### 검증 통과선 — 6축 전부 GREEN

| 축 | 결과 | 닻 |
|----|------|---|
| 1 / 1b — E2E reply (wire-up + real transport) | ✅ | stub end-to-end + 진짜 sonnet PONG (input=3 output=6 cacheRead=7135) |
| 2 — workspace 인식 | ✅ | `-c <workspace-lab>` → IDENTITY.md/AGENTS.md 응답 의미 수준 반영. persona 일관성까지 살아있음 (sonnet 이 prompt injection 의심하여 거부) |
| 2.5 — browser E2E | ✅ | Gateway 18789/18791 live. 사용자 직접 대화 성공 |
| continuity — Turn 연결 | ✅ | `buildConversationPrompt` 로 `ctx.messages` serialize. **OpenClaw 가 conversation history SSOT** |
| 세션 자기인식 | ✅ | 자식 sonnet 이 "openclaw-control-ui", "pi-shell-acp ACP 브리지" 까지 정확히 자기 설명 |
| 3a / 3b — skill manifest + invocation | ✅ | 40+ skill 자율 분류 나열 + `gogcli` + `denotecli` 병렬 호출 → 실제 Terminal 실행 → 통합 응답 |

acpx 가 자기 1.0 도 못 넘은 자리에 6.0 까지 도달. (b3a) plugin-only 가설 라이브 증명 완료.

### 5.12 baseline 재검증 (2026-05-15, OpenClaw 측 담당자)

5.7 → 5.12 한 점프. 두 단계 검증:

**오전 — 11단계 chain CLI re-verify**: 전부 GREEN 재현. 불변량 살아있음:
- `Model<Api>` 시그니처 / `api: "pi-shell-acp"` literal chain / `ProviderPlugin` SDK 표면.
- 새 hook 3개 (`normalizeProviderResolvedModelWithPlugin`, `applyProviderResolvedTransportWithPlugin`, …) 와 `staticCatalogModel` fallback 은 우리 path 비통과 (models + streamSimple 직접 등록 경로).
- pi-ai scope 리네임 `@mariozechner/*` → `@earendil-works/*` — pi-shell-acp 본체는 이미 `@earendil-works/pi-ai@0.74.0` 사용 중이라 align 됨.

**오전 — 브라우저 풀세트 GREEN (5.12 + f066dd2)**: 어제 6축이 5.12 위에서도 살아있음. 자식 sonnet 이 IDENTITY.md / MEMORY.md / AGENTS.md (Being Data 표 포함) 응답 의미 수준 반영, `~/.openclaw/workspace-lab` 자기 위치 인지, "evidence-first language" 룰까지 자식까지 흘러감 ("Sonnet 인지 직접 조회 못 함" 솔직 메타-인지). status bar 표시:

```
🦞 OpenClaw 2026.5.12 (f066dd2)
🧠 Model: pi-shell-acp/claude-sonnet-4-6
↪️ Fallback: openai-codex/gpt-5.5 (selected model unavailable)
🧮 Tokens: 8.9k in / 398 out · Cache 31% hit
📚 Context: 8.9k/200k (4%) · Compactions: 0
```

### Step 0 부산 발견 (Phase 1~3 비용 흡수)

5.12 위에서 새로 박힌 사실 한 줄: **Install scanner = production trust gate**.

| 사실 | Phase 3 함의 |
|------|--------------|
| `child_process` 사용 → 5.12 default block (`install-security-scan.runtime.ts`) | flag 없는 install UX 가려면 **정식 등록만이 답** |
| Bypass 경로 = (A) `dangerouslyForceUnsafeInstall` (운영자 escape, 사용자 권장 불가) / (B) `trustedSourceLinkedOfficialInstall` (marketplace/ClawHub) | 권장: **(B) + SDK sanctioned spawn helper** 동시 추진 |
| `@openclaw/plugin-sdk/*` 에 sanctioned ACP transport / subprocess spawn helper 가 있는가? | 미확인 — 없으면 SDK enhancement PR 이 Phase 3 부속 작업 |
| 5.12 status bar 의 `Fallback: openai-codex/gpt-5.5 (selected model unavailable)` 표시 | 정보성 — 실제 라우팅은 sonnet GREEN. entwurf target registry 의 unavailable 마킹 또는 모델 카탈로그 env-var 평가일 가능성. 5.12 신규 status bar 항목 인지 |

기존 발견들도 그대로 살아있음 (`resolveSyntheticAuth` 훅, `AssistantMessageEventStream` class, session JSONL 자연 영속, `plugins.allow` hygiene, cwd 전달, `pi --session` 시멘틱 갭, `ctx.messages` SSOT, OpenClaw timestamp prepend, sandboxed worker context).

---

## Phase 1 — pi.dev Hardening (현재 priority)

> #15 stabilization + #13 publish prep 통합. **새 기능 만들지 않는다.**
> "no-feature refactor and hardening phase" — 문서/경계/감사성 강화만.

### Phase 1 interrupt — issue #16 turn lifecycle bug (2026-05-15)

> OpenClaw plugin / pi.dev hardening 전에 먼저 분해한다.
> 증거 bundle: `.agent-reports/issue-16-019e28b9/` (git ignored)
> llmlog: `20260515T094644`

현재 판독:
- stale background poller (`biiz7aa7f`) 는 실제였지만 전부가 아니다.
- Claude raw transcript 에서 `<task-notification>` 이 user message 로 dequeue 된다 (`origin.kind=task-notification`). 즉 단순 UI 알림이 아니라 transcript/turn lifecycle 을 소비한다.
- 이후 정상 질문 `12버전에서 openai 로그인이 변경되었다는게 뭐지?` 는 enqueue/dequeue 후 assistant content 없이 `[Request interrupted by user]` → pi surface 에 빈 `stopReason=aborted` 로 남았다.

2026-05-15 bugfix bump 완료 (commit 대기):
- `@agentclientprotocol/claude-agent-acp` `0.32.0` → **`0.33.1`** (package.json / pnpm-lock / run.sh `CLAUDE_ACP_REQUIRED_VERSION`). **상류 `0.33.0` commit `dba1998` / PR #627** "Handle result origins in ACP agent" — `isTaskNotification = message.origin?.kind === "task-notification"` 도입, 네 가지 stopReason 대입 (`cancelled` / `max_tokens` / `end_turn` / `max_turn_requests`) + local-slash-command result forwarding 을 전부 게이트. `usage_update._meta._claude/origin` forwarding 도 0.33.0 신규. 0.32.0 에서는 task-notification followup 의 stop_reason 이 user-turn lifecycle 을 오염시킬 수 있었고, issue #16 의 background-notification / human-turn 경계 혼탁과 직접 맞물린다. `event-mapper.ts` 의 invariant 코멘트는 `0.33.0+` 로 정정.
- `@zed-industries/codex-acp` `0.13.0` → **`0.14.0`** (package.json / pnpm-lock / run.sh `CODEX_ACP_REQUIRED_VERSION` / README install pin / global pnpm). 0.13 이후 변경분: codex 0.129, exec output delta O(N²) memory fix, image-generation tool call emit. (note: `Reload auth file before failing check_auth()` 는 이미 0.13.0 에 포함된 fix — GPT 분석에서 0.14 신규로 잘못 분류했던 항목 정정.)
- `@google/gemini-cli` global `0.42.0` 그대로. repo dep 아니라 PATH runtime. 0.40.x → 0.42.x 에서 `homedir()` 함수 본문 미변경 확인 (`bundle/chunk-ECNYAST2.js:41713-41719`) → `acp-bridge.ts` 의 overlay path-resolution invariant 손대지 않음 (코멘트만 검증 범위 확장).
- 검증 통과: `pnpm typecheck` / `pnpm lint` / `check-dep-versions` / `check-backends` / `check-mcp` / `check-models` / `check-registration` / `check-sdk-surface` / `smoke-claude` / `smoke-codex` / `smoke-gemini`. 세 백엔드 모두 `stopReason = end_turn` + 텍스트 emit 정상.
- 잔여 gate (별도 작업): task-notification 재현 smoke, cancel 후 same-session reuse smoke, empty-aborted assistant surface regression test. 0.33.x 의 origin-aware filtering 이 두 번째 증상 (raw.332 빈 aborted) 까지 잡는지 직접 재현으로 확정 필요.
- issue #16 코멘트 + close 후보. evidence bundle `.agent-reports/issue-16-019e28b9/` 는 gitignore 유지.

### Phase 1 의 invariant (#15 에서 재확인)

- `pi-shell-acp does not provide Claude credentials, tokens, or subscription access.`
- `connects to user's existing local authenticated backend through an explicit bridge/plugin boundary.`
- `fails loudly when invariants are broken.`
- `not Anthropic access resale, not subscription sharing, not auth bypass, not hidden transcript restoration.`

### Phase 1 작업 묶음 (#15 + #13 통합)

| # | 작업 | 출처 |
|---|------|------|
| 1.1 | **`acp-bridge.ts` 감사성 강화 (no-behavior-change extraction)** — 가능한 경우 `acp/backends/{claude,codex,gemini}.ts` / `acp/overlays/*` / `acp/{session-store,model-lock,compaction-policy}.ts` 분할. 단 invariant 가시성이 떨어지면 분할 안 함. 공개 facade 는 `acp-bridge.ts` 유지 | #15 |
| 1.2 | **lint/type/format gate 전 부분 통과** | #15 |
| 1.3 | **README narrative hardening** — "no core patch and no bypass" / MCP narrow surface / capability vs surface 명시 (이미 modified, `M README.md`) | #15, GPT 분신 작업 |
| 1.4 | **files allowlist 결정** (`package.json` `files`) — tarball 에 runtime-critical 포함, dev residue 제외 | #13 |
| 1.5 | **pack verification gates** — `npm pack --dry-run --json` / `npm pack` / `tar -tf` / **로컬 install smoke from packed tarball** | #13 |
| 1.6 | **`prepublishOnly` / `test:pack` 스크립트** | #13 |
| 1.7 | **install README 정렬** — public/stable install (`pi install npm:pi-shell-acp`, 미래) / source install (`pi install git:...`) / dev install (local clone). evidence calibration 가시화 | #13 |
| 1.8 | **Pi peer dep 범위 결정** (`@mariozechner/*` vs `@earendil-works/*` — 실제 호환 기준) | #13 |
| 1.9 | **tmux automated demo test, baseline verification, replicant verification 등 진짜 gate 통과** | #15 |
| 1.10 | **publish 자체 보류** — 모든 gate 통과 후 GLG 가 직접 결정 | #13 |

### Phase 1 의 publish 정책

`pi install npm:pi-shell-acp` 표면은 **준비만 한다**. publish 자체는 #13 의 "publishing is intended once the package surface is deliberately prepared" 그대로. 어느 시점에 publish 하느냐는 GLG 직접 결정.

---

## Phase 2 — Oracle Baseline 실사용 (Phase 1 와 병행 가능)

> OpenClaw plugin 의 1단계 실제 사용. 정식 등록 전 단계.
> 목적: 동작 잘 되는 것부터 확보. baseline test 처럼 실사용에서 문제 파악.

### Phase 2 구조 — Monorepo lite

```
~/repos/gh/pi-shell-acp/
├── package.json              ← root, pi-shell-acp 그대로
├── pnpm-workspace.yaml       ← NEW (1줄: packages: ["openclaw-plugin"])
├── index.ts                  ← pi extension entry 그대로
├── pi-extensions/            ← 그대로
├── acp-bridge.ts             ← Phase 1 에서 감사성 강화 (split 여부 #15 판단)
└── openclaw-plugin/          ← NEW sibling package
    ├── package.json          ← name: "@junghan0611/openclaw-pi-shell-acp"
    ├── openclaw.plugin.json
    ├── src/
    │   └── index.ts          ← definePluginEntry → registerProvider
    ├── dist/                 ← tsdown build
    └── README.md             ← acpx alternative narrative, pi 단어 zero (§3.4 가드레일)
```

### Phase 2 작업 묶음

| # | 작업 | 비고 |
|---|------|------|
| 2.1 | `pnpm-workspace.yaml` 1줄 추가 (`packages: ["openclaw-plugin"]`) | monorepo lite 진입 |
| 2.2 | `openclaw-plugin/` scaffold — `package.json` (name `@junghan0611/openclaw-pi-shell-acp`, peer `openclaw >=2026.5.12 <2026.6.0`, dep `@earendil-works/pi-ai@0.74.0`, managed peers `claude-agent-acp`/`codex-acp`/`@google/gemini-cli`) | 어제 5가지 + 오늘 6번째 (cwd 전달), 7번째 (ctx.messages SSOT), 8번째 (sandboxed logging) 다 반영 |
| 2.3 | `src/index.ts` — `definePluginEntry → registerProvider("pi-shell-acp", { models, staticCatalog, streamSimple: createStreamFn(ctx) })`. workspace dep 으로 root `acp-bridge.ts` 재사용. `child_process` 직접 사용은 **(C) SDK sanctioned helper** 가 있으면 그것 사용, 없으면 OpenClaw SDK enhancement PR 이 별도 작업 |
| 2.4 | `tsdown` 빌드 + watch mode + symlink fast iteration | OpenClaw convention |
| 2.5 | `README.md` — §3.4 가드레일 (acpx alternative, pi 단어 zero, 클로드코드 구독 멘트 금지) | 공개면 분리 |
| 2.6 | **Oracle bot 실사용 install** — git-local 또는 `npm pack` tarball 형태. `dangerouslyForceUnsafeInstall` 사용 가능 (사용자 = GLG 본인) | 정식 등록 *전* 단계 |
| 2.7 | 실사용에서 발견되는 문제 → llmlog / NEXT 로 환류 | Phase 1 의 hardening 에 입력 |

### 어제 6축 GREEN 의 의미 in Phase 2

stub 으로 (a) cwd 전달 / (b) continuity / (d) skill 양방향 routing 다 풀려있음. real plugin 은 **stub 의 production-grade refactor**:

- (b) `ctx.messages` serialize 는 진짜 답일 가능성 (long-lived ACP stdio 안 만들어도 충분)
- (c) identity envelope — `PI_SESSION_ID` / `PI_AGENT_ID` 명시 주입, model-lock trail 받침
- (e) timestamp wrapper — strip vs 명시 frame wrap 결정
- (f) logging via stdout only — sandboxed worker context 에서 file logging silent fail

---

## Phase 3 — OpenClaw 정식 등록 (Phase 1 + 2 안정 후)

| # | 작업 | 트리거 |
|---|------|--------|
| 3.1 | pi-shell-acp pi.dev 등록 push | Phase 1 완료 |
| 3.2 | pi.dev 노출 후 버그 수정 사이클 | 사용자 피드백 |
| 3.3 | `@openclaw/plugin-sdk/*` sanctioned spawn helper 확인 + 필요시 SDK enhancement PR | OpenClaw 측 협업 |
| 3.4 | `@junghan0611/openclaw-pi-shell-acp` npm publish 준비 — Phase 1 의 pack verification gate 동일 적용 | Phase 2 의 Oracle baseline 안정 |
| 3.5 | ClawHub 정식 등록 → `trustedSourceLinkedOfficialInstall` 경로 통과 | 3.4 완료 |
| 3.6 | `openclaw plugins install @junghan0611/openclaw-pi-shell-acp` 한 줄로 끝나는 사용자 UX 검증 | 3.5 완료 |
| 3.7 | CHANGELOG 0.6.x entry + VERIFY 갱신 + invariant 보강 ("consumer 평면과 backend 평면 분리") | 3.6 완료 |

---

## 확정 사실 모음

- **Plugin npm 이름**: `@junghan0611/openclaw-pi-shell-acp` (scope = 출처 + 책임 명확)
- **Plugin 디렉토리**: `openclaw-plugin/` (monorepo lite sibling)
- **OpenClaw peer**: `>=2026.5.12 <2026.6.0`. 5.7~5.11 호환 포기
- **pi-ai dep (plugin)**: `@earendil-works/pi-ai@0.74.0` (5.12 align)
- **Plugin configSchema default**: `mcpInjection: "self"`, `lockConflictPolicy: "strict"`
- **Install trust path**: 정식 등록만. `dangerouslyForceUnsafeInstall` flag UX 사용자 권장 안 함
- **README guardrail (plugin 측)**: acpx alternative 톤, pi 단어 마케팅 zero, 클로드코드 구독 멘트 금지
- **README guardrail (root pi-shell-acp 측)**: "no core patch and no bypass" / MCP narrow surface / capability vs surface 명시 (이미 modified)

---

## Cross-repo follow-ups (별도 추적)

- **pi CLI `--new-session` 표면 검토**: `pi -p "..." --session <new-id>` lookup-only. pi 자체 시멘틱 갭. pi-ai / pi-coding-agent 레벨 issue 후보
- **OpenClaw SDK sanctioned spawn helper 확인**: `@openclaw/plugin-sdk/*` 정식 entrypoints 에 있는지. 없으면 enhancement PR 후보
- **`ctx.messages` SSOT 모델 공식화**: plugin spec 으로 명시 가치 — 다른 backend (Codex/Gemini) 도 같은 모양 plug-in 가능

---

## 폐기 항목 (과거 framing 잔재)

- ~~OpenClaw upstream PR-1/2/3/aux~~ — 외부 플러그인이라 upstream 무관
- ~~`extensions/acpx/AGENTS.md` cross-ref~~ — upstream 안 건드림
- ~~labeler.yml / docs/plugins / CHANGELOG entry on OpenClaw side~~ — 전부 불필요
- ~~별도 repo (openclaw-pi-shell-acp)~~ — monorepo lite 로 결정. 동기화 비용 회피
- ~~"OpenClaw 담당자 측으로 ownership 전수"~~ — monorepo lite 라 ownership 이 pi-shell-acp 내부에 머무름. plugin code owner = pi-shell-acp maintainer (junghan0611). README narrative 가드레일만 OpenClaw user 시야 우선
- ~~`@mariozechner/pi-ai@0.73.0` pin~~ — 5.12 baseline 으로 `@earendil-works/*@0.74.0`

---

## Parked, Not Current

- **#11** remote SSH resume cwd alignment
- **#10** broader ontology RFC (`peer handle`, `contact_peer`, registry). cwd-authority 부분은 0.4.17 landed
- **#8** ACP `entwurf_send` message visibility UX, after #10 revisited
- **#2** pi-first context meter, post-0.5.0
- **L5 long soak** with repeated context-pressure events and sentinel recall, likely 0.6.x
