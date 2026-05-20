# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 결정 trace 와 evidence 는 commit history / CHANGELOG / VERIFY / BASELINE / README / AGENTS / 코드로 보낸다.
> 라이브 정보 (현재 release / 인보이스 형상 / API 표면) 는 README.md, CHANGELOG.md, AGENTS.md, `package.json`, `pi/entwurf-targets.json`, `pi/settings.reference.json` 에서 꺼낸다 — NEXT 에 복제하지 않는다.

## Reference paths

- **본체**: `~/repos/gh/pi-shell-acp/` — monorepo lite (root + `plugins/openclaw/`)
- **OpenClaw source**: `~/repos/3rd/openclaw/` — baseline `2026.5.12`, peer `>=2026.5.12 <2026.6.0`
- **Workspace baseline (검증 cwd)**: `~/repos/gh/openclaw-config/config/workspace/`
- **ACP backend source**: `~/repos/3rd/acp/` — `claude-agent-acp/`, `codex-acp/`, `gemini-cli/`, `agent-shell/`, `acp.el`, `zed/`, `obsidian-agent-client/`
- **Consumer**: `~/repos/gh/agent-config/`

---

## Top priority — bbot Active Memory empty-final regression (#20)

> [Issue #20](https://github.com/junghan0611/pi-shell-acp/issues/20) — 2026-05-19 (0.7.3 cut + oracle 텔레그램 GREEN 직후) OpenClaw 5.18 host 업그레이드 + plugin 0.7.0 surface 정합 + OAuth profile migration 사이클 후 발견된 post-#17 regression. **현재 Phase 3 진입의 가장 임박한 차단선**.

### 증상 한 줄

bbot ACP path 에서 `memory:active_memory:context_pre_compute` 가 cleanly 끝남 (`status=ok elapsed≈12.6s summary≈200 chars`). 그러나 main assistant turn 이 **visible final text 없음** → 사용자에게 raw `<command-name>` / `<command-message>` / `<command-args>` 블록만 보임. 크래시 없음, 에러 없음 — silent empty final.

### 의심 surface (정확한 가설은 issue #20 본문)

#17 의 두 fix 중 over-correction 후보:

- "**stripped tool blocks from visible bodies**" — active-memory pre_compute 가 emit 하는 `<command-name>` / `<command-message>` / `<command-args>` 블록이 tool block 으로 분류되어 stripped → sibling assistant text 가 같은 turn 에 없으면 empty visible body → fallback surface 로 raw block 재출현.
- "**guarded final-message role handling**" (`fa3b8f7`-class) — active-memory inject 후 final role classification 이 invalidated 가능성.

### Fix sequencing (Phase 3 의 새 3.2 로 박힘)

#17 의 audit philosophy 그대로 — **관찰된 call site 만 패치 금지, sibling path 도 audit**.

1. **A. visible-body stripper 분류 정합** — pi-shell-acp `event-mapper.ts` + OpenClaw plugin message 처리 양쪽에서 `<command-name>` block 의 분류 확인. tool block 으로 분류된다면 active-memory case 만 예외 처리할지, 또는 분류 자체를 좁힐지 결정.
2. **B. empty-visible-body fallback** — stripper 가 empty body 만들면 raw command block 이 사용자에게 surface 되지 말아야 함. 억제 또는 minimal final substitute.
3. **C. final-message role guard ↔ active-memory inject 상호작용** — `fa3b8f7`-class 가드가 active-memory inject 후 valid assistant final 을 invalidate 하지 않는지 확인.
4. **D. ACP path final-message reconstruction** — pre_compute 가 `status=ok` 로 non-empty `summary` 를 돌려준 후 final 재구성 path 검토.
5. **E. trace artifact recovery** — empty-final case 에서 trace 에 실제 assistant text 가 존재하는데 visible path 가 잃어버리는지 / 진짜로 모델이 안 emit 했는지 분리.
6. **F. 테스트 케이스 6종** — issue #20 § "Test cases to add" 그대로 (active-memory only / 정상 turn baseline / status=empty / non-trivial summary / failed/timeout / role guard combined).

### Success criteria

- Silent-empty-final 회귀 사라짐
- 관찰된 surface 만이 아니라 sibling path 도 audit 됨
- #17 의 `message.content.filter is not a function` class 회귀 안 함
- BBOT + Active Memory 동작이 #17 close 시점 상태로 복원
- Raw `<command-name>` / `<command-message>` 블록은 사용자에게 도달하지 않음

### Release 묶음 결정

`#20` fix landed 후 결정. patch cut (`0.7.4`) 자연 후보. **`#19` envelope sanitation 과 묶을지 분리할지는 #20 close 시점에 결정**.

---

## Phase 3 — OpenClaw plugin formal registration (active sprint)

| # | 작업 | 상태 |
|---|------|------|
| 3.1 | pi-shell-acp pi.dev 등록 push | ✅ closed (2026-05-19, gallery card 등장; 2026-05-20 hero 이미지 surface 정합) |
| 3.2 | **bbot active-memory empty-final fix** (#20) | 🔥 **active** — 위 § Top priority |
| 3.3 | `@openclaw/plugin-sdk/*` sanctioned spawn helper 확인 + 필요 시 SDK enhancement PR | pending — 3.2 안정 후 |
| 3.4 | `@junghanacs/openclaw-pi-shell-acp` npm publish 준비 | pending — 3.3 결과 반영 후 |
| 3.5 | ClawHub 정식 등록 → `trustedSourceLinkedOfficialInstall` 경로 통과 | 3.4 완료 후 |
| 3.6 | Self-contained install — `openclaw plugins install @junghanacs/openclaw-pi-shell-acp` 한 줄 UX. plugin package 가 `acp-bridge.ts` 를 직접 import 하여 bridge runtime 을 품음. child `pi` binary 의존 제거 | 3.5 + Phase 1.4 ts refactor 완료 후 |
| 3.7 | CHANGELOG plugin entry + VERIFY 갱신 + invariant 보강 | 3.6 완료 후 |

### 3.3 SDK helper sanity check (별도 5분 라운드)

`@openclaw/plugin-sdk/*` 의 sanctioned spawn helper grep — `~/repos/3rd/openclaw/packages/plugin-sdk/`. Oracle Stage 1 (2026-05-19 PM, 7항목 GREEN) 에서 raw spawn 으로 작동 확인됨. SDK helper 는 polish 차원. 없으면 enhancement PR 후보.

### 3.4 entry checklist (별도 라운드)

publish 진입 전 결정/작업:

1. **Plugin version reset** — `plugins/openclaw/package.json` `0.6.0 → 0.1.0`, `private: true → false`. 결정 근거는 § "Plugin ↔ 본체 버전 정합" 표 참고.
2. **Prerelease tag 정책** — 잠정 `(a)` 0.1.0 일반 publish + README "prerelease/alpha" 명시. ClawHub 정식 등록 (3.5) 까지가 진짜 trust gate.
3. **Publish gate 재사용**:
   - ✅ `check-pack` (dry-run, files 목록)
   - ✅ `check-pack-install` (fresh-temp install smoke)
   - ✅ `prepublishOnly` nested pack smoke (0.7.1 fix 패턴)
   - ❌ `.sh` mode regression gate — plugin tarball 에 `.sh` 없음
   - ❌ `scripts/postinstall-chmod.cjs` — 동일 이유
4. **README publish-ready 정합**:
   - 자기-자백 ("End-to-end smoke stub — NOT the real pi-shell-acp transport. Phase 1.4 ts refactor swaps these for SDK types proper.") 유지 — honest
   - alpha/prerelease badge + 호환 매트릭스 명시
5. **OpenClaw host 측 deploy 의존 명시** — host (OpenClaw container) 측 entwurf-control / pi-tools-bridge wire 정책 + 본체 `@junghanacs/pi-shell-acp@>=0.7.3` 사전 install + minimum OpenClaw container `2026.5.12+` 명시.

### Plugin ↔ 본체 버전 정합 (SSOT, 결정 박힘 2026-05-19 PM)

**결정**: plugin 별도 lifecycle + 첫 publish `0.1.0` reset.

| plugin version | pi-shell-acp 본체 version | 비고 |
|---|---|---|
| **0.1.x** (planned first publish) | **>=0.7.3** | 현재 stub. event-mapper fence sanitize + spawnTimeoutSeconds propagation 정합 필요 |
| 0.2.x (예정) | >=0.8.0 (예정) | Phase 1.4 SDK 도입 후 swap 시점 |

이유 (한 줄씩):

- 이미 별도 진화 중 (plugin 0.6.0 vs 본체 0.7.3). partial sync 가 가장 혼란.
- 0.6.0 은 본체 trajectory 안의 작위적 숫자. plugin 자체로 보면 first publish 라 0.1.0 이 honest.
- Cadence 자체가 다르다 — 본체는 자주 release, plugin 은 stub 안정 후 거의 안 건드림.
- 호환 매트릭스 명시는 한 번 박으면 한참 안정.

폐기된 옵션 (참고): (ii) runtime probe `pi --version` parse — 0.1.x 단계 over-engineering. (iii) plugin version 본체와 sync — partial sync 가 가장 안 좋은 패턴.

---

## Envelope identity sanitation (#19, 별도 sprint)

> [Issue #19](https://github.com/junghan0611/pi-shell-acp/issues/19) — 2026-05-19 oracle Stage 1 검증 turn 의 bbot schema-level 단서 분석으로 발견. 세 발견 모두 의도되지 않은 동작이므로 버그.

| # | 회귀 | 영향 |
|---|---|---|
| 1 | `PI_AGENT_ID` env 상속 — entwurf spawn 시 child 의 새 (provider/model) 로 override 안 함 | 분신 self-report hallucination (Codex 가 자기를 Claude 라 보고) |
| 2 | `PI_SESSION_ID` stale — MCP bridge child 가 spawn 시점 env 캐싱, 부모 갱신 catch 안 함 | `entwurf_self.sessionId` 가 부모 실제와 불일치, reply target 정합 깨짐 |
| 3 | `socketPath` fictional — `entwurf_self` 가 control socket 활성 검증 없이 path 반환 | 비활성 세션도 socketPath 반환 → caller 가 trust 시 `entwurf_send` fail |

→ 같은 surface (envelope identity) 라 묶어서 진행. **0.7.4 또는 Phase 3.4 entry 에 흡수 후보**. `#20` 과 묶을지 분리할지는 #20 close 시점에 결정.

**Agent quality 에 의존하면 안 되는 invariant**: bbot 의 reasoning quality 가 schema-level 단서로 self-report hallucination 을 잡았지만, 평범한 분신은 못 잡을 수 있음. 평범한 분신도 깨지는 정합 회귀.

---

## 확정 사실 모음

- **Plugin npm 이름**: `@junghanacs/openclaw-pi-shell-acp` (scope = 출처 + 책임 명확)
- **Plugin 디렉토리**: `plugins/openclaw/` — monorepo lite, `pnpm-workspace.yaml` `packages: ["plugins/*"]`. 의미: `pi-shell-acp` = pi 의 *extension*, `plugins/openclaw` = host 어댑터. `packages/` 어휘 충돌 회피.
- **OpenClaw peer**: `>=2026.5.12 <2026.6.0`. 5.7~5.11 호환 포기.
- **pi-ai dep (plugin)**: `@earendil-works/pi-ai@0.74.0` (5.12 align).
- **Plugin configSchema default**: `mcpInjection: "self"`, `lockConflictPolicy: "strict"`.
- **Install trust path**: 정식 등록만. `dangerouslyForceUnsafeInstall` flag UX 사용자 권장 안 함.
- **README guardrail (plugin 측)**: acpx alternative 톤, pi 단어 마케팅 zero, 클로드코드 구독 멘트 금지.
- **README guardrail (root pi-shell-acp 측)**: "no core patch and no bypass" / MCP narrow surface / capability vs surface 명시.

---

## Cross-repo follow-ups (별도 추적)

- **Gemini bot usage 측정 OpenClaw 표시 갭** — bbot DIAG stderr 에 `meter=acpUsageUpdate ... used=24315 size=1000000 raw: input=13 output=591 cacheRead=54834 cacheWrite=14346` 정상 도착. 그러나 OpenClaw status bar 의 `📚 Context: ?/200k` 로 표시 (`?`). 분석 영역: (a) plugin `streamSimple` 의 final `message.usage` 에 정확히 전달되는지, (b) OpenClaw status renderer 의 model picker 가 plugin provider 의 usage 매칭하는지 (provider id `pi-shell-acp` 로 lookup 시 missing 인가). "어제도 봤던 버그" — 알려진 잔존 이슈.

- **OpenClaw delivery layer — final-text 정규화 + progress 채널 분리** — 정공법 합의 (2026-05-18 PM GPT힣 PM 검토): `showToolNotifications: true` 유지 (progress 가시성) + OpenClaw/bot 의 outgoing message layer 에서 `[tool:*]` notice 필터링 또는 progress channel 을 final 채널과 분리. 본체 코드 정합 (`index.ts:621` `?? false → ?? true`, 2026-05-19) 끝. 다음 라운드는 OpenClaw delivery layer 측 작업. **`#20` 의 raw command block surface 회귀와 같은 결** — empty body / raw block / progress noise 가 같은 visible layer 문제라 `#20` fix landed 후 같은 라운드에 통합 검토 가치.

- **pi CLI `--new-session` 표면 검토** — `pi -p "..." --session <new-id>` lookup-only. pi 자체 시멘틱 갭. pi-ai / pi-coding-agent 레벨 issue 후보.

- **`ctx.messages` SSOT 모델 공식화** — plugin spec 으로 명시 가치. 다른 backend (Codex/Gemini) 도 같은 모양 plug-in 가능.

- **OpenClaw compose default 검토** (Docker auth boundary) — 공개 install 가이드의 기본 권장이 in-container login 인지 host passthrough 인지. Claude Code auth refresh 가 read-only mount 에서 동작하는지 검증. 우리 측 의견: `plugins/openclaw/README.md` 의 Docker boundary 표 참고.

- **Long-lived session 시 entwurf scope** (Phase 1.4 또는 이후) — plugin path 가 현재 `--no-session` 으로 entwurf 표면을 자연 차단. 미래 long-lived ACP session 으로 가면 두 갈래 결정: (I) entwurf 를 plugin 의 child pi 안에서 그대로 활성화 (isolated topology, root AGENTS.md #9 정합) vs (II) entwurf 호출을 OpenClaw peer API 로 forward (host-coupled, #9 위반). 현재 정책 = I. (II) 는 OpenClaw SDK enhancement 필요, 지금 결정 안 함.

- **Telegram delivery bridge 정식화** (Phase 1.4) — Phase 1.8 응급 다리로 child pi final text → synthetic OpenClaw `message` toolCall 변환을 stub 에 넣음 (`pi-shell-acp-message-*`, toolResult 후 즉시 `end_turn`). 정식 작업에서 OpenClaw `context.tools` / provider tool surface 를 pi-shell-acp transport 에 연결하는 **일반 tool bridge** 로 승격. 지금 패치는 Telegram/message-tool-only path 를 뚫기 위한 prerelease shim. 남은 UX debt: tool trace 노출, `<system-reminder>`류 prompt hygiene, `HEARTBEAT_OK` 같은 session sentinel 이 child prompt 에 섞이는 문제.

- **Oracle Docker image 3-layer install** (Oracle config repo 측) — openclaw-gateway 컨테이너에 `pi`, `pi-shell-acp`, `codex-acp`, `gemini` 추가. `git` system pkg + pnpm global. 자세한 layout 은 `plugins/openclaw/AGENTS.md` § Install layers. Oracle 측 작업, 우리 측 plugin 코드 변경 없음.

- **agent-config server-mode `pi-shell-acp` ref 복귀** (Phase 3 release 후) — 현재 `agent-config 5f17d70` 가 server-mode 에서 main 추적 정책. Oracle 호스트가 우리 push 를 자동 follow. **prerelease / Oracle 검증 동안 임시**. Phase 3 의 ClawHub 등록 후 release tag (`git:...pi-shell-acp@v0.x.y` 등) 로 다시 ref pinning 으로 복귀. 잊으면 server 가 영원히 main 추적 — release 후엔 안 좋은 정책.

- **pi-tools-bridge MCP async surface** (0.7.x or 0.8.0 candidate) — 외부 MCP host (Claude Code / Codex / Gemini CLI) 에서 `entwurf` 가 sync-only (`mcp/pi-tools-bridge/index.ts` 의 tool description 이 honest 하게 명시). 다음 라운드: (1) MCP tool 에 `mode` 파라미터 노출, (2) `entwurf_status` MCP tool 추가, (3) ACP follow-up notification 채널로 완료 알림 surface 가능한지 조사 (Claude Code MCP host 의 notification 채널 지원 여부 의존). 호환성: 변경 시에도 sync default 유지하되 explicit `mode=async` 가능하게.

- **Remote entwurf follow-up cleanup** (2026-05-18 remote shell-quote 긴급 패치 후 잔여):
  - (a) `shellQuote` 3중 중복을 `pi-extensions/lib/shell-quote.ts` 로 통합. `check-shell-quote` 가 source parity 강제 중.
  - (b) Async remote resume 에도 `PARENT_SESSION_ID` carrier 전달 여부 결정.
  - (c) `#11` remote resume saved-header cwd 정렬 smoke/fix.
  - (d) **Remote home parity 제거** — `os.homedir()` 로 로컬 home 을 absolute 화해서 SSH 너머 전달 (불가피한 임시). NixOS 균질 환경 (`/home/junghan` 모든 호스트 동일) 에선 OK, mixed-OS / 다계정 환경 확장 시 깨짐. 진짜 해결은 remote `$HOME` query 또는 absolute-only 강제.
  - (e) **Remote 자동 smoke 게이트** — 현재 native/ACP × sync/async × spawn/resume remote 경로의 자동 회귀 게이트 없음. `./run.sh check-remote-entwurf <host>` 식 manual gate 추가 검토.

---

## Reference docs (Phase 3 입력)

- **pi.dev packages 규칙**: `~/repos/3rd/pi/pi-mono/packages/coding-agent/docs/packages.md` — manifest 키, peer dep, files allowlist, source type 3종 (npm/git/local), gallery metadata.
- **Sample 패키지** (`~/repos/3rd/pi/`):
  - `pi-packages/packages/pi-synthetic-provider/` — provider extension, scope 패키지. 가장 가까운 참고.
  - `agent-stuff/` (mitsupi) — multi-resource (extensions + skills + themes + commands). 확장 참고.
  - `pi-telegram/` — minimal extension.
  - `pi-packages/packages/{pi-firecrawl, pi-exa-mcp, pi-claude-code-use, ...}/` — 다양한 pi extension 패턴.

---

## Parked, Not Current

- **#11** remote SSH resume cwd alignment
- **#10** broader ontology RFC (`peer handle`, `contact_peer`, registry). cwd-authority 부분은 0.4.17 landed.
- **#8** ACP `entwurf_send` message visibility UX — 2026-05-16 `e31823c` 로 ACP path 의 late `[entwurf sent →]` customMessage 승격 비활성화. in-stream `[tool:start]/[tool:done]` notice 로 회귀. 재진입 조건: pi 가 in-stream passive UI append/update path 를 마련하면 다시 검토.
- **#2** pi-first context meter, post-0.5.0
- **L5 long soak** with repeated context-pressure events and sentinel recall, likely 0.6.x or later
