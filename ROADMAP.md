# pi-shell-acp ROADMAP — 현재 + 미래 방향

> 이 문서는 **현재이자 미래방향**이다. `NEXT.md`는 disposable한 다음-한-걸음 나침반,
> `CHANGELOG.md`는 게시되는 "닫힌 변경" 핵심 로그, 이 `ROADMAP.md`는 게시되지 않는
> 내부 방향/설계 SSOT. 닫힌 작업의 세션별 process 잡음은 git 커밋 history에 산다.
> (NEXT는 npm tarball에서 제외, ROADMAP도 제외 — 내부 detail 안전. CHANGELOG는 게시됨.)

---

## 현재 — 0.11.0 (Stage 0: pi-only v2 dispatch substrate)

0.11.0 = **v1 replacement가 아니라 v2 Stage 0 substrate 릴리즈**다. `entwurf_v2`는 기존
garden citizen에 대해 liveness + intent를 읽고, per-target lock 아래에서 control-socket /
spawn-bg resume / meta-mailbox 중 하나를 결정적으로 고르는 dispatch surface. v1 기능은
계속 지원되고 programmatic gate는 PASS. fresh sibling creation은 아직 v1 `entwurf`가 담당
(0.12 cutover lane).

**한 줄:** 0.11.0은 fresh creation 릴리즈가 아니라, 기존 garden citizen dispatch를 정직하고
결정적으로 만드는 v2 Stage 0 릴리즈. **send/reply → `entwurf_v2`, create → v1 `entwurf`.**

### 되는것 (LIVE 증명, log `…20260616T141023`: MUST PASS=17 FAIL=0)

| 기능 | 증거 |
|---|---|
| v2 pi live send | `smoke-entwurf-v2-matrix-live` C1 |
| v2 recordless live pi socket-only send (A1 narrow) | matrix-live C1b |
| v2 dormant pi → spawn-bg resume (실 `pi --entwurf-control` child + model turn) | `smoke-entwurf-v2-spawn-resume-live` 22 PASS |
| v2 active Claude Code meta → meta-mailbox enqueue + doorbell | matrix-live C2 |
| v2 honest reject (false-delivered/`.msg` garbage 0) | matrix-live C3 + deliverability gates |
| v1 fresh sibling creation (entwurf spawn/resume/send) | programmatic gate PASS |
| floor 0.79.4 parity | `pnpm check` + release-gate MUST PASS=17 |

### 안되는것 (0.11.0 범위 밖 — 정직히)

- **v2 fresh sibling creation** (무에서 새 형제) → v1 `entwurf`, **0.12 cutover lane**
- **recordless DORMANT pi resume** (record 없는 dormant) → **0.11.1**(cwd/launch authority 없음)
- **Claude↔Claude / Claude tmux-live transport** → contract enum에 이름만, production path 없음 → **0.11.1 / Stage 1**
- **모델이 MCP entwurf를 Bash 대신 신뢰성 있게 자율 선택** → flaky(sentinel S7 advisory) → **usability lane**

### v1 / v2 분리 결론 (GLG+GPT+Opus 수렴)

- **v2 (0.11.0 핵심) = PASS.** 옵셔널 아님 — 추가됨+테스트됨.
- **v1 compatibility "있는 기능" = 전부 PASS** (programmatic gate: async-resume / entwurf-resume /
  check-native-async). v1 도구는 살아있음.
- **두 model-in-loop FAIL(sentinel·resident-garden-guard positive) = v1 기능 결함 아님.** "모델이 v1
  도구를 *자율 호출*하는가"를 보는 behavior probe. Claude Sonnet이 entwurf MCP 안 부르고 Bash/pi-CLI
  우회·포기에 노출 → flaky. release-gate는 이걸 **two-tier**로 분리: MUST(차단)는 기능/transport,
  BEHAVIOR(advisory·비차단)는 자율 tool-selection. **S7(Bash 우회)은 BEHAVIOR lane 안에서도 hard FAIL**
  — 우회를 PASS로 둔갑 안 시킴, 단 컷은 안 막음.
- **왜 그동안 안 터졌나:** model-in-loop 축은 0.11 작업기 신규 커버리지(sentinel `6592c5f` 5/29,
  RGG/T3 `440afba`·`7d45346` 6/4). "문제 없었다"가 아니라 "검증 안 했다" — v2 작업이 v1의 숨은
  허점을 드러낸 **선물**.
- **0.79.4 = deterministic 회귀 없음**(probe·강제호출 A/B 확인) → floor bump 안전.
- **surface affordance fix (voscli 사건):** garden id만 보면 pi인지 Claude Code meta인지 모름 → 에이전트가
  "send" 이름에 끌려 v1 고르고 실패. canonical delivery = `entwurf_v2`로 못박고 `entwurf_send` 설명 격하.

---

## 가까운 lane

### 0.11.1 / Stage 1
- **Claude Code tmux-live / Claude↔Claude live transport** — v2 production transport 구현(현재 enum만).
- **recordless dormant pi resume** — record 없이 cwd/model/resume authority 확보(JSONL-header authority
  resume 별도 설계 / A2 / Entwurf-core identity layer).
- **unregister-토글** (V2_ONLY일 때 v1 surface hide) — 잠긴 spec(`check-entwurf-v2-only` + SSOT "neither
  deleted nor unregistered") 변경이라 docs+gate 동반. 현재는 hard-refuse만(invocation refusal).
- **GC** (meta-record 117개+ 누적) — `entwurf_peers` default live+recent+cwd 제한, dormant/meta 옵션화,
  stale marker·read body GC, record archive/TTL/lastSeen. **GC = 프로세스 자원 회수만, 데이터 삭제 아님.**
- **SE-3 readability** — 정직한 `replyable:false`가 버그로 오인되는 silent degraded addressability(가독성).
- **`/gnew` T3 backend axis** — 현재 claude-sonnet-4-6만 측정. codex/gemini로 확장.

### 0.12 / cutover lane
- **v1 removal** — 11-scenario v2 replacement 증명 + v1 삭제. `entwurf_send` 전달을 `entwurf_v2`로
  수렴(redirect), `get_message`/`clear` debug action만 잔존.

---

## 큰 방향 — 새 `entwurf` repo (GLG 결정 2026-06-16)

**새 repo `entwurf`를 만들어 v2 인터페이스만 옮긴다.** pi-shell-acp를 버리는 게 아니라, v1/v2 혼재가
만든 혼선을 줄이려 **집중을 위해 분리**하는 것.

- v2(garden citizen에 대한 결정적 dispatch substrate: liveness×intent → control-socket / spawn-bg
  resume / meta-mailbox)는 새 `entwurf` repo에서 깨끗이 자란다.
- **entwurf-core** = identity / garden id / inbox / liveness / dispatch / replyability / evidence 추출이
  새 repo의 첫 몸.
- pi-shell-acp는 **v1 + ACP compatibility adapter**로 잔존. ACP는 plugin, boundary 아님(#37/#38).
- **0.11.0 안전 컷 = 이 분리의 출발선.**

---

## 동결 invariant — 넘으면 안 되는 선 (전부 #35)

- **Workshop, not factory.** 살아있는 소수 도제 = 재질문 가능, 상태는 세션 안 → 외부 DB(beads/dolt) 금지.
- **GC = 프로세스 자원 회수만, 데이터 삭제 절대 아님.** meta-record/transcript(denote-id 기억층) 보존.
- **garden-id = authority, tmux = ephemeral.** 세션명=path(grouping), window 번호 renumber.
- **Factory 작업 OUT.** worktree·merge-wall fan-out 없음 → 백엔드 자체 orchestrator로 위임.

---

## 핵심 아키텍처 — 데이터 4분리 + 한 동사

- **record(누구였나) / capabilities(무엇·어떻게 깨움) / mailbox(메시지·receipt) / probe(지금 살아있나,
  저장 안 함 — 매번 계산).** 상태를 저장하면 거짓말이 된다(denote-instinct 함정).
- **두 레인 둘 다 KEEP:** `pi -p` headless(오케스트레이션, 가벼움) + tmux-live(`--entwurf-control` 소켓,
  도제). resume/send는 세션 type이 아니라 **현재 liveness의 함수** — dormant→resume, live→send.
- **entwurf = 한 동사(`entwurf_v2`로 통합, 레거시 공존).** `entwurf_peers` = 읽기 전용 fact 표면
  (liveness/capability/identity/cwd-이력만) — `resumable`/`sendable` 같은 verb-routing을 fact 층에 굽지
  않는다. 기존 `entwurf`/`_resume`/`_send`는 완전 전환까지 유지.
- **브레인 ↔ 핸드 분리(둘 다 TS).** 브레인 = TS fact 모듈(disk SSOT meta-record를 읽음, in-memory Map의
  형제-비가시성 대체). 핸드 = 기계적 실행. **최종 형제 선택은 에이전트, 모듈은 근거 제공.** 부가 신호
  (쿼터·시스템 부하)는 substrate가 아니라 에이전트 층 — substrate에 저장하지 않는다.

### meta-record v2 (nullable-at-birth)
`{ schemaVersion:2, gardenId, backend, nativeSessionId, cwd, model:null, transcriptPath:null,
parentGardenId:null, isEntwurf:false, createdAt, recordUpdatedAt }`. `model`/`transcriptPath` nullable
근거 = 어느 백엔드도 birth stdin에 model 없음, pi backend는 birth에 transcript 미확정. v1 receipt 필드는
읽되 v2에선 mailbox state로 이동. `recordUpdatedAt` = record touch time(liveness 아님).

---

## 동결 결정 (frozen decisions — 재설계 금지)

1. 능력 레지스트리 = 별도 `entwurf-capabilities.json`(launch allowlist와 별 관심사).
2. v1→v2 = `parseMetaRecordV1/V2`→`normalizeMetaIdentity` dual-read + lazy normalize, 새 write는 v2.
3. correlation = 소켓파일명 + tmux `@garden_id`. **env probe 폐기**(상속 누수); lineage는 launcher가
   `PARENT_SESSION_ID`를 명시 set. 안전 tmux 필드 = `@garden_id`+`pane_id`+`pane_pid`만(`pane_title`은
   shell 의존이라 authority 금지).
4. preflight/facts owner = **단일 TS 모듈**. launcher / global `project_trust` handler / MCP fact tool은
   결과만 소비, 누구도 prefix/trust 판정 재구현 안 함. **trust ≠ discovery**: trust는 launch-time 단일
   cwd만; peers/discovery는 trust 불필요.
5. untrusted controlled launch = **fail-fast**(조용한 `--no-approve` degraded 금지). trusted만 `--approve`.
   진짜 근거 = untrusted repo의 `.pi/settings.json`이 bridge로 적용되는 위험.
6. `project_trust` handler `remember` = **false**(prefix policy = SSOT). carve-out: 사람이 명시적으로
   상속-distrust를 덮어쓴 child override는 `remember:true` 저장.
7. prefix auto-approve roots = **operator policy, NOT package default**(public package 보안 footgun 방지).
   source = trusted operator surface만(`PI_SHELL_ACP_TRUST_ROOTS` env / user-global / agent-config). match =
   canonical path + separator boundary(bare `startsWith` 금지). GLG 기본 = `~/repos/gh`,`~/repos/work`,`~/org`.
8. **precedence 동결:** `saved false > saved true > prefix match > no-trust-inputs > fail-fast`.
9. **import surface = public root export만**(`getAgentDir`/`hasProjectTrustInputs`/`ProjectTrustStore`/
   `VERSION` + handler 타입). private subpath import 금지 = 공짜 drift 게이트. runtime은 `VERSION >= floor` fail-loud.
10. **공개 동사 먼저 축소(contract-lock) → fact-provider(facts only) → dispatch.** entwurf 공개 표면을 한
    동사로 줄이고 `entwurf_peers`를 읽기 전용으로 못박는 걸 fact-provider 빌드보다 먼저. 통합 dispatch는
    레거시 공존 새 이름(`entwurf_v2`)으로 additive. 레거시 3-verb 은퇴는 v2 증명 + 완전 전환 이후.

---

## 검증 원장 (measured, 재탐색 불필요)

- **pi 0.79 public export:** `hasProjectTrustInputs`/`ProjectTrustStore`/`getAgentDir`/`VERSION` 모두 index
  public export → TS 직접 import(재구현 불필요). floor = **0.79.4**(0.11.0).
- **pi trust(0.79.1+):** `pi -p`는 trust에서 안 멈춤(비대화 미결정→`false` degraded). `--approve`(`-a`)=
  project 파일 로드, `--no-approve`(`-na`)=무시·degraded. `ProjectTrustStore.get`은 nearest-ancestor
  walk-up(조상 cwd 결정을 자식이 상속). `AGENTS.md`/`CLAUDE.md`는 0.79.1에서 trust input에서 제거(항상
  로드되는 context file). 우리 AGENTS 주입은 trust 무관 자체 경로.
- **pi resume = no-lock append:** `SessionManager`는 신규 첫 flush만 `openSync(wx)`(생성 가드). resume은
  plain `appendFileSync`(락 없음) → pi는 동시-resume self-guard 안 함 → v2는 target=존재 시민이라 항상
  resume → **per-gid lockfile이 유일 가드.**
- **pi liveness:** 소켓 = `~/.pi/entwurf-control/<gid>.sock`(파일명=garden_id). LIVE/STALE authority =
  socket connect + RPC `get_info`(`entwurf-control.ts`에 `isSocketAlive`/`getLiveSessionsWithInfo`/
  `gcStaleSockets`). `ss`/`kill -0`은 디버그 보조일 뿐 authority 아님.
- **pi tmux 부팅:** `pi --session-id <gid> --entwurf-control --approve --provider … --model …` → 소켓 생성·
  trust prompt 없음·TUI ready. controlled invariant(`--approve` 주입) live-smoke 게이트화 가능.

---

## Backlog 트랙 (0.11.0 별개, GLG 재오픈 시)

- **Post-0.10 meta-bridge:** #34 잔여(empirical probe 4종 + unread-mailbox heartbeat), Phase 4 GC 자동화
  (`--apply`/TTL/liveness 코드화), step 7 `entwurf_peers(includeMeta)` 발견성.
- **Carried 0.9:** `/gnew` T3 codex/gemini 확장, `/gnew` empty-session GC(cross-cutting), `entwurf.ts`
  source guard refinement(plain UI send 추가 시 allowlist로 좁히되 equality 안 느슨하게).
- **Dep bump(별도 트랙):** claude-agent-acp 0.40.0 / sdk 0.24.0. sdk 0.24가 `unstable_setSessionModel`
  제거 → `session/set_config_option(configId="model")`로 마이그레이션 필요. codex/gemini model-forcing은
  그 RPC가 유일 경로라 `as any` 캐스트는 silent regress(=`check-sdk-surface`가 막는 anti-pattern).
- **Standing focus — Mitsein over MCP:** plain external(non-replyable) vs garden-native meta-session
  (replyable by garden id) 구분이 agent 발화에 정직히 반영되는가. native Claude meta-session이
  external-mcp로 퇴행하거나 `wants_reply=true`를 비대칭 거절하면 버그.
- **Session continuity hygiene:** `incompatible_config`가 너무 넓음 → 축별 diff 출력 + reason taxonomy
  (`auth-profile`/`auth-epoch`/`system-prompt`/`mcp`/`transcript-missing`/`emacs-socket`/`tool-surface`).
  `emacsAgentSocket` 누락이 대표 footgun.
- **#25 bridge hygiene(OpenClaw audit lessons):** transcript pre-flight(backend jsonl verifier), session
  cache hygiene(idle timeout/LRU/max-N), single-turn lock per session.

---

## Deprecated — closed, do not reopen

- **OpenClaw track(2026-06-10 종료):** `plugins/openclaw` deprecated & unmaintained. Claude/Gemini가 ACP
  네이티브 지원 → wrapper 존재 이유 소멸. npm `@junghan0611/openclaw-pi-shell-acp@0.0.1` deprecate 마킹,
  소스 reference 동결.
- **Gemini CLI(2026-06-18 deprecated):** Google AI Pro/Ultra·무료 tier 대상 종료 → Antigravity CLI 이관.
  repo는 Gemini 어댑터 코드를 **호환성용 잔존**, README는 더 이상 추천 setup 경로로 제시 안 함.
- **Long-term/separate issues:** #11 remote SSH resume cwd(원격 entwurf identity는 의도적 fail-fast),
  #10 broader ontology RFC, #8 ACP `entwurf_send` message visibility UX, #2 pi-first context meter, L5 long soak.

---

## Reference paths

- 본체: `~/repos/gh/pi-shell-acp/` · Consumer: `~/repos/gh/agent-config/` · NixOS: `~/repos/gh/nixos-config/`
- 미래 분리 대상: 새 `entwurf` repo (v2 interface + entwurf-core)
