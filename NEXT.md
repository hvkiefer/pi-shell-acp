# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 결정 trace 와 evidence 는 commit history / CHANGELOG / VERIFY / BASELINE / README / AGENTS / 코드로 보낸다.

## Current stance — 2026-05-27

**Top regression — restore async resume workflow.** `entwurf_resume`의 운영 퇴행을 두 단계로 복원한다. 예전 강점은 "spawn은 sync로 담당자/맥락을 붙잡고, 이후 긴 작업은 resume async로 던져 부모 턴을 풀어두는" 패턴이었다. Phase 0.5(`agent-config e5aa5a1`, 2026-04-24)에서 pi-native resume 기본값이 async→sync로 바뀌었고, 0.7.0(`ad4413e`, 2026-05-19)에서 spawn만 async로 되돌아오면서 가장 어색한 상태(짧은 spawn은 async, 긴 resume은 sync)가 만들어졌다. 비대칭 공존은 "MCP surface 전체 async 금지"가 아니라 "caller가 replyable pi-session인지 구분"이라는 패턴이고, 그 discriminator는 이미 `mcp/pi-tools-bridge/src/index.ts:266-281` (`buildSendSenderEnvelope`)에 살아 있다. 같은 분류기로 MCP async도 게이팅 가능하다.

### Phase A — native default async 복원 (이 커밋)
- `pi-extensions/entwurf.ts` — `entwurf_resume` schema default + runtime fallback을 `"sync"` → `"async"`로 복원. async branch 코드는 그대로 살아 있었고 default만 뒤집힌 상태였다.
- `VERIFY.md §0A` — 검증 turn은 짧은 inline 응답이 필요하므로 `entwurf_resume(mode="sync", taskId=...)`를 명시하도록 갱신.
- CHANGELOG `## Unreleased`에 기록. 0.7.0 spawn flip이 마무리하지 못한 절반을 이번에 닫는다.

### Phase B — MCP `entwurf_resume(mode="async")` (별도 설계 라운드)
pi-shell-acp Claude가 보는 MCP surface는 아직 sync-only다. external MCP host(Claude Code 단독 등)는 replyable이 아니므로 sync-only가 유지되어야 하지만, PI_SESSION_ID/PI_AGENT_ID가 주입된 replyable pi-session caller에는 async를 열어야 핵심 UX가 회복된다. 단순히 MCP handler에 `mode` 파라미터를 추가하는 것으로는 부족하다 — 완료 알림 전달 경로 설계가 필요하다.

작업 단위:
1. `pi-extensions/entwurf.ts:929-1137`의 async resume 본체(detached spawn + `proc.on('close')` + `pi.sendMessage({deliverAs: "followUp"})`)를 entwurf-control이 호출 가능한 공유 launcher로 추출. completion delivery callback은 ExtensionAPI에 묶여야 하므로 launcher는 그 콜백을 주입받는 형태로 설계.
2. `pi-extensions/entwurf-control.ts`에 신규 RPC `type: "spawn_async_resume"` 추가. 현재 RPC 집합(`send`, `get_message`, `get_info`, `clear`, `abort`)을 한 자리 확장.
3. `mcp/pi-tools-bridge/src/index.ts:503-547` — `entwurf_resume`에 `mode` 파라미터 추가. handler가 `buildSendSenderEnvelope()`로 replyable 여부 판정 → replyable + `mode="async"`이면 부모 pi 세션의 entwurf-control 소켓에 `spawn_async_resume` 위임 → external/non-replyable + `mode="async"`이면 `entwurf_send`의 `wants_reply` 거부와 동일 패턴으로 throw.
4. 회귀 smoke: "sync spawn → async resume → parent turn free → followUp completion" 시나리오. native 경로용 1개 + MCP replyable 경로용 1개 + external non-replyable 거부 케이스 1개.

Phase A는 native pi 안 분신 협업을 즉시 복원하고, Phase B가 pi-shell-acp Claude(현재 가장 자주 쓰이는 surface)까지 회복한다. 둘 다 끝나야 "되던 것" 전체 복원.

**OpenClaw 쪽은 당분간 진행하지 않는다.** `3a65072 docs(openclaw): recommend native lanes for Claude/Codex, narrow plugin to Gemini` 로 정리한 대로, OpenClaw 5.22 native `claude-cli` 가 Pro/Max 결제 + 1M ctx + workspace skill + live-session 재사용까지 충분히 동작함을 확인했다. Claude/Codex lane 은 OpenClaw native 를 쓰면 되고, 우리 OpenClaw plugin 은 더 밀 필요가 없다.

`pi-shell-acp` 본체는 계속 **pi extension / ACP bridge / entwurf surface** 로 유지한다. OpenClaw plugin 은 “Gemini lane 이 필요할 때 쓸 수 있는 보조 어댑터” 정도로 parked.

---

## Top priority — Asymmetric Mitsein with Claude Code

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
- replyable / non-replyable, send-is-throw, sync-only MCP surface 가 agent 발화에 정확히 반영된다.
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

- `@junghanacs/pi-shell-acp@0.7.5` published 2026-05-21.
- `@junghan0611/openclaw-pi-shell-acp@0.0.1` published 2026-05-21, but now parked.
- Recommended routing as of 2026-05-26:
  - Claude: OpenClaw native `claude-cli`
  - Codex: OpenClaw native `openai-codex`
  - Gemini: `pi-shell-acp` ACP lane if richer MCP/skill surface is needed
