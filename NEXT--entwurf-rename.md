# NEXT — `entwurf-rename` 브랜치 (rename `pi-shell-acp` → `entwurf`: pi 탈중심화)

> 부트섹터. CP2 = 이 rename. **아직 치환 안 함** — GLG가 enumeration을 몇 번 더 조인 뒤 실행.
> 분기점: `acp-on-v2` `a893318`(CP1 정합성 lock, 원격 봉인됨). 영속 invariant·operator 세트 = `ROADMAP.md` SSOT.

# 미션 (탑)

pi-shell-acp repo를 `entwurf`로 rename. **단순 패키지명 교체가 아니다** — pi-중심 네이밍을 걷어내고 `entwurf`를 주어로 세운다. GLG 통찰: *"pi는 4번째 하네스일 뿐. entwurf capability는 하네스 무관. 이름이 pi를 중심에 두면 안 된다. entwurf 감각을 살려라."*

**원칙 (GLG 통찰 + GPT `20260622T191739-19b503` 적대검수 수렴, 2026-06-22):**
> "pi"는 *pi 하네스 adapter / pi-runtime / upstream 계약*일 때만 남긴다. 이 repo가 소유한 *garden citizen · identity · dispatch · bridge capability*는 **entwurf가 주어**. → "pi 제거"가 아니라 **"pi를 adapter로 격하하고 entwurf를 capability 주어로 세움."**

## ★ 실행 법칙 (GLG) — "정확히 나열 후 치환"

> **먼저 모든 토큰·변종·엣지케이스를 빠짐없이 *나열*(enumerate)하고 그것이 exhaustive함을 확인한 뒤에야** 결정적 일괄 텍스트치환을 한다. 치환부터 하지 않는다. 네이밍이 핵심이라 한 번에 정확히 — 이 NEXT의 「나열」을 몇 번 더 조여 완성한 뒤 실행.

- **blind `s/pi-/entwurf-/` 금지** (KEEP군 오염) — full-token exact only.
- 각 stage 후 **양방향 검증**: 잔존 `rg`(RENAME군 0이어야) + KEEP allowlist `rg`(남아야 정상).
- 게이트는 rename과 **같은 commit**(결합 규칙).
- 방법: grep token matrix + 검수 + 게이트. AST codemod 단독 부적합(대부분 문자열 계약: provider id·패키지명·MCP 서버명·env·settings 키·path·sentinel·log reason·docs·consumer config).

# 나열 — 토큰 매트릭스 (실측, node_modules 제외 · "몇 번 더 조여" 완성 대상)

> 숫자는 치환 전 탐색을 돕는 **rough snapshot**일 뿐이다. NEXT/문서 자체가 토큰을 늘리므로 실행 기준이 아니다.
> 각 stage 직전에 `rg`를 다시 찍고, 토큰별 파일목록을 눈으로 확인한 뒤 치환한다.

## RENAME → entwurf (정체성 / 하네스 무관 capability)

| 토큰 (변종) | 측정 | → |
|---|---:|---|
| `pi-shell-acp` (kebab) | rough | `entwurf` |
| `piShellAcp…` (camel, = `piShellAcpProvider`) | rough | `entwurfProvider` |
| `PiShellAcp` (Pascal 타입) | rough | `Entwurf` |
| `PI_SHELL_ACP_*` (SCREAMING env) | rough | taxonomy 아래 참조 |
| `pi_shell_acp` (snake, log reason/sentinel) | rough | `entwurf` |
| `pi-tools-bridge` (MCP dir/server명) | rough | `entwurf-bridge` |
| `mcp__pi-tools-bridge__*` (tool id, allow 패턴) | — | `mcp__entwurf-bridge__*` |
| `PI_TOOLS_BRIDGE_*` (3 vars) | — | `ENTWURF_BRIDGE_*` |
| `PI_ENTWURF_*` (우리 substrate env) | — | `ENTWURF_*` |
| `PI_META_*` (meta-bridge env) | — | `ENTWURF_META_*` |
| Symbol `"pi-shell-acp.acp-provider.registered"` | — | `"entwurf.acp-provider.registered"` |
| repo URL `github.com/junghan0611/pi-shell-acp` | — | `…/entwurf` |
| compound `pi-shell-acp-{demo,smoke,hero,no-auth,doomemacs,release-gate}` | — | `entwurf-…` |
| model prefix `pi-shell-acp/claude-…` | — | `entwurf/claude-…` |

## KEEP pi (남아야 정상 — adapter / runtime / upstream)

`pi-native` · `pi-session` · `PI_SESSION_ID` · `PI_AGENT_ID` · `pi-coding-agent` · `PI_CODING_AGENT_DIR` · `pi-core`/`pi-mono`/`pi-tui` · `PI_SETTINGS_PATH` · `PI_EMACS_AGENT_SOCKET` · `pi-extensions/` · `pi-context-augment` · `--entwurf-control`(pi-core flag) · `pi-acp`(svkozak 외부 프로젝트).

## 회색지대 — 수렴

- **C4** 패키지/repo/provider = **순수 `entwurf`** (entwurf-acp ✗ — ACP는 plugin 하나지 정체성 아님). 문서: "entwurf 패키지 = core substrate + pi adapter + ACP plugin + meta bridge".
- **C5** MCP bridge = **`entwurf-bridge`** (entwurf-mcp=transport종속, -tools-bridge=잡다; 설명에 "MCP adapter/server" 명시).
- **C1** `PI_ENTWURF_*` → **`ENTWURF_*`**.   **C2** `PI_META_*` → **`ENTWURF_META_*`**.
- **C3** `pi-extensions/` **KEEP**.   **C6** `pi-context-augment` **KEEP** (둘 다 pi adapter — entwurf-*면 거짓말).
- **Provider compatibility:** hard-cut. **permanent runtime alias 금지**. 필요한 보조는 installer/state one-shot migration 또는 명시적 breakage 문서화만.
- **State/cache migration (비봇 격상 — 이건 "남 배려"가 아니라 *내 살아있는 세션*이다):** `~/.pi/agent/cache/pi-shell-acp/...` + **garden meta-records(=identity 층) + mailbox 경로**를 hard-cut하면, rename 순간 지금 돌고 있는 Claude Code citizen / ACP Claude의 state가 orphan된다(running citizen이 비행 중 깜빡 꺼짐). target allowlist의 `provider`, package-source routing state, model-lock 기대값도 S1 끊김 후보. hard-cut 하되 installer one-shot migration 범위/문구를 stage 전에 확정 — **그리고 그 migration을 내 실제 `~/.pi`로 cut 전 리허설**(덮는지 실측).
  - **실측 (bf0e221) — 위험이 작다:** package-keyed live state는 `~/.pi/agent/cache/pi-shell-acp/sessions`(`session-store.ts:146`, ACP session-reuse 캐시) **단 하나**. meta-records/mailbox는 **garden-id-keyed**(`<pi-agent-dir>/meta-sessions|meta-mailbox/<gardenId>`, 패키지명 무관) = **rename-immune → identity 층은 안 흔들린다**(비봇 최대 우려 해소). orphan 위험 = 그 캐시 1경로뿐 → installer migration = `mv cache/pi-shell-acp → cache/entwurf` 하나 + 새 `PROVIDER_ID` 경로 read 확인. (캐시 잃어도 정체성 아닌 reuse만 리셋.)

## Env namespace taxonomy (PI_ 접두 제거 ≠ pi 단어 전부 제거)

> 아래는 **버킷+규칙과 대표 예시**일 뿐 전수(全數) 매핑이 아니다. `PI_SHELL_ACP_*`는 실측 **27개**(node_modules 제외) — S3 직전 `rg`로 27개 전부를 버킷에 배정하고 눈으로 확인한 뒤 치환한다("나열 후 치환"). 자명하지 않아 **stage 전 선결**할 항목: `LIVE_{MODEL,PROVIDER,TARGET}`(release-gate harness — core/test?) · `RGG_TARGET` · `S1_MODEL` · `CODEX_MODE`(ACP codex backend vs `PI_ENTWURF_ACP_FOR_CODEX`와 구분) · 위 legacy `ALLOW_COMPACTION` 가드. 자명한 것: `*_CONTEXT`/`*_MODEL`/`*_SENTINEL`/`TRUST_ROOTS`→ACP, `V2_ONLY`/`DEBUG`→core.

- **Core/substrate:** `PI_ENTWURF_TARGETS_PATH` → `ENTWURF_TARGETS_PATH`, `PI_ENTWURF_DIR` → `ENTWURF_DIR`, `PI_SHELL_ACP_V2_RESUME_RESIDENT_SESSION_ID` → `ENTWURF_V2_RESUME_RESIDENT_SESSION_ID`.
- **ACP plugin:** `PI_SHELL_ACP_PROVIDER_MODEL` → `ENTWURF_ACP_PROVIDER_MODEL`, `PI_SHELL_ACP_CLAUDE_CONTEXT` → `ENTWURF_ACP_CLAUDE_CONTEXT`, `PI_SHELL_ACP_ENGRAVING_PATH` → `ENTWURF_ACP_ENGRAVING_PATH`, `PI_SHELL_ACP_MEMORY_*`/`*_OVERLAY_*`/`*_RAW_TURN_*` → `ENTWURF_ACP_*`.
- **MCP bridge:** `PI_TOOLS_BRIDGE_ENV_FILE` → `ENTWURF_BRIDGE_ENV_FILE`, `PI_TOOLS_BRIDGE_EXTERNAL_AGENT_ID` → `ENTWURF_BRIDGE_EXTERNAL_AGENT_ID`, `PI_TOOLS_BRIDGE_REQUIRE_META_SENDER` → `ENTWURF_BRIDGE_REQUIRE_META_SENDER`.
- **Meta bridge:** `PI_META_SENDER_MARKER` → `ENTWURF_META_SENDER_MARKER`, `PI_META_SESSIONS_DIR` → `ENTWURF_META_SESSIONS_DIR`, `PI_META_MAILBOX_DIR` → `ENTWURF_META_MAILBOX_DIR`.
- **Pi adapter target:** if the variable controls pi-side behavior, keep `PI` as object not prefix: `PI_SHELL_ACP_ALLOW_PI_COMPACTION` → **`ENTWURF_ALLOW_PI_COMPACTION` (확정).** `_ALLOWED` 접미는 코드베이스 선례 0건; `ALLOW_` 동사-접두가 관용(`ALLOW_COMPACTION`, `MEMORY_/OVERLAY_/RAW_TURN_ALLOW_PATH_FALLBACK`). `PI`가 object(=압축 대상이 pi-side transcript)라 의미도 보존.
- **★ 누락 A 정정 (compaction 가드는 *코드에 없다* — bf0e221 grep 실측):** `ALLOW_COMPACTION`/`ALLOW_PI_COMPACTION`/`before_compact`가 어떤 `.ts`/`.sh`(tests 포함)에서도 read되지 않음. `assertLegacyCompactionKnobUnset`는 CHANGELOG/README/VERIFY/BASELINE/CONTRIBUTING **문서에만** 있고 현 소스엔 없음(v2 재작성에서 빠진 듯). → **live silent-trap 아님.** (a) 없는 가드를 문서가 주장 = **doc-drift, PR-polish 대상**. (b) 이 추론이 아래 셋째 축을 드러낸 *씨앗*. env 이름 치환(`PI_SHELL_ACP_ALLOW_PI_COMPACTION`→`ENTWURF_ALLOW_PI_COMPACTION`)은 위 확정대로.

# ★★ 셋째 축 — 의미방향(positive/negative) · negative-guard 전수 패스 (비봇 격상, bf0e221 실측)

> RENAME/KEEP는 단어 *출처*(capability냐 adapter냐) 축이다. 직교하는 **셋째 축 = 의미 방향**: 그 토큰을 코드가 *positive*(있어야/같아야)로 검사하나 *negative*(없어야/forbidden)로 검사하나. **negative-guard만 치환 시 green인 채 inert(조용히 깸)** — 나머지는 어긋나면 게이트가 RED로 시끄럽게 운다. 그래서 이 클래스만 따로 전수.

- **RENAME** (평범 식별자) → `entwurf`. (대량, loud)
- **MOVE-lockstep** (positive 기대값 — 값 + *검사처*를 같은 commit에 이동, 어긋나면 RED): 실측 핵심 —
  - `getRegistryRouting`/extension-spec: `entwurf-core.ts:1060` `if (target.provider !== "pi-shell-acp")` + `:1070` `resolveExplicitExtensionSpec("pi-shell-acp")` → 미치환 시 `pi --no-extensions --provider entwurf`가 `Unknown provider`로 **즉사**(#29 게이트가 잡음=loud).
  - **no-auth sentinel 값 `"pi-shell-acp-no-auth"` = 3-site 하드코딩 lockstep:** `models.ts:29`(const) + `check-acp-provider-surface.ts:49`(`assert.equal(..., "pi-shell-acp-no-auth", "…drifted")`) + `run.sh:1314/1319`(source-scan). 셋을 같이 옮겨야 함.
  - `run.sh:30 PROVIDER_ID="pi-shell-acp"`(shell측, models.ts와 lockstep) · `Symbol.for("pi-shell-acp.acp-provider.registered")` · 게이트 기대값(`check-entwurf-resume-args`·`-session-identity`·`-event-mapper`·`-package-source-routing`·`-model-lock`) · smoke tmpdir prefix/clientInfo/`PI_AGENT_ID="pi-shell-acp/claude-…"`.
- **KEEP-old (negative 가드 — 옛 이름 남아야 정상, 치환하면 silent-inert):** **실증 결과 = 코드 instance 0건.** compaction 가드 = docs-only(위). anti-spoof sender marker = 값-상대(`meta-session.ts:1310/1431` `liveKey !== marker.ownerStartKey`, pi-shell-acp 리터럴 없음 → rename 무관).
- **실증 결론 (de-risk):** rename 표면은 **압도적으로 loud-lockstep**(어긋나면 게이트 RED). 조용히 깨질 negative-guard 클래스는 **bf0e221 기준 비어있음** → 비봇이 지목한 "유일하게 silent로 깰 부류"가 실측상 공집합 = 위험 낮음. **단 S1/S3 직전 이 패스(부정비교 `!==`/`!includes`·sentinel·drift assert·docs-only 가드) 재실행** — 새 가드가 유입될 수 있으므로.

# 스테이징 (각 = 변종 일괄치환 + 게이트 동시 + `pnpm check` green + commit · bisect 가능)

- **S0** docs map 고정 ✅ (이 파일)
- **S0.5 — SSOT 정렬 (NOW):** AGENTS의 no-rename 잔재 제거, ROADMAP/NEXT alias 정책 hard-cut으로 정렬, env taxonomy/state migration 후보 명시. **아직 source 치환 아님**.
- **S1 — package/repo/provider identity (원자, 쪼개지 말 것):** 중간상태 "package=entwurf인데 provider=pi-shell-acp" 금지 → 통째로. 패키지명 + provider id(acp-provider.ts baseUrl/api) + model prefix + `piShellAcpProvider`→`entwurfProvider` + `PiShellAcp*`/`piShellAcp*`/`pi_shell_acp` + Symbol + repo URL. 게이트 동시: `check-package-source-routing`·`check-model-lock`·`check-entwurf-session-identity`·`check-auth-boundary`. **agent-config consumer lockstep** (`pi/settings.json` model prefix + `piShellAcpProvider` block). → `pnpm check` EXIT0.
- **S2 — MCP bridge:** `mcp/pi-tools-bridge`→`mcp/entwurf-bridge` (dir+서버명) + **tool id `mcp__pi-tools-bridge__*`→`mcp__entwurf-bridge__*`** 전수 + install/remove/prune settings + `check-pi-tools-bridge-boot` + consumer mcpServers lockstep.
- **S3 — env namespace:** taxonomy에 따라 `PI_SHELL_ACP_*`를 core/ACP/pi-adapter 의미별로 분해, `PI_TOOLS_BRIDGE_*`→`ENTWURF_BRIDGE_*`, `PI_ENTWURF_*`→`ENTWURF_*`, `PI_META_*`→`ENTWURF_META_*` + env명 assert 게이트(`check-entwurf-v2-surface` 등). **런타임 영구 alias 금지**, 필요시 installer one-shot migration만.
- **S4 deferred (구조개편, 텍스트치환 아님):** `pi/entwurf-targets.json` 경로 재검토 · `pi-extensions/`→`adapters/pi/extensions/` layout.

# PR-polish (rename과 별개, S1~S3 중/후)

README/VERIFY/CHANGELOG stale (backend overclaim·packaged docs·persisted continuity·config passthrough · **compaction 가드 docs-only — 5개 문서가 `assertLegacyCompactionKnobUnset`/`ALLOW_COMPACTION` 거부를 주장하나 코드에 없음**) + ROADMAP 하단 "legacy verbs maintained" historical 표기. `AGENTS.md`는 GLG rename 지시에 따라 S0.5에서 정책 정렬했고, 이후 source rename과 맞물리는 잔여 문자열만 결합 규칙으로 갱신.

# Consumer (agent-config) lockstep map — S1 prep (ACP Claude 1차 나열 / GPT adversarial review 분담, 2026-06-22)

> `~/repos/gh/agent-config` 실측. 23파일이 `pi-shell-acp`/`piShellAcp` 참조. **dirty baseline:** `pi/settings.server.json` M = `lastChangelogVersion` 0.79.6→0.79.8 (pi 런타임 자동 마커, rename 무관·benign) — S1 patch는 그 줄 비건드림.

## S1 identity atom (repo S1과 같은 beat)
- `pi/settings.json` + `pi/settings.server.json:14` `"piShellAcpProvider"` 블록 키 → `entwurfProvider`.
- `pi/claude-plugin.json:3` description "pi-shell-acp Claude … `piShellAcpProvider`.skillPlugins" (소프트 docs+키 참조).

## S2 bridge (`mcp__pi-tools-bridge` → `mcp__entwurf-bridge`)
- `claude/settings.server.json:17` allow `"mcp__pi-tools-bridge__*"`.
- `antigravity/mcp_config.json`+`.server.json`, `codex/config.toml:48` 서버명 `pi-tools-bridge` → `entwurf-bridge` (+ start.sh 경로는 아래 (f)).
- README/AGENTS/CHANGELOG/NEXT(agent-config) docs 참조.

## S3 env (consumer 자체 env)
- `run.sh`: `PI_SHELL_ACP_DIR`·`PI_SHELL_ACP_INSTALL_SPEC`·`PI_SHELL_ACP_TRACKING_REF` → `ENTWURF_*`.
- ⚠️ `PI_ENTWURF_BOT_TOKEN`(run.sh:639-655) = agent-config/telegram 자체 var. **pi-shell-acp가 읽나? 아니면 우리 repo rename 범위 밖(cross-repo 결정)** — 분류 필요(GPT review 포인트).

## ★ (f) physical-path coupling — consumer S1을 GATE함 (GPT cut-choreography)
GLG가 GitHub repo + 로컬 checkout dir를 rename하기 전엔 `entwurf`로 못 바꾸는 경로들:
- `pi/settings*.json:11` `"../../repos/gh/pi-shell-acp"` (local package source path).
- `pi/settings*.json:22` + MCP configs: `/home/junghan/repos/gh/pi-shell-acp/mcp/pi-tools-bridge/start.sh` (절대경로).
- `run.sh`: checkout `~/repos/gh/pi-shell-acp` · pi-managed `~/.pi/agent/git/github.com/junghan0611/pi-shell-acp` · `PI_SHELL_ACP_INSTALL_SPEC="git:github.com/junghan0611/pi-shell-acp"`(GitHub URL).
- → 결론: **consumer S1 = repo S1 직후가 아니라 (f) physical rename과 같은 beat.** migration wrapper가 한 beat 동안 옛 경로 허용할지 stage 전 결정.

## ★★ 역사데이터 coupling — consumer-side "keep-old" 클래스는 NON-empty (실측, repo 내부와 대조)
repo 내부 negative-guard는 공집합이었으나 **consumer는 다르다 — 진짜 silent-break 부류 존재:**
- `session-recap.py:172` `if "pi-shell-acp" in api or "pi-shell-acp" in provider or model.startswith("claude-")` — **기존 세션 JSONL의 provider 문자열 = "pi-shell-acp"**. 단순 치환하면 rename *이전* 모든 세션을 못 찾음(recall이 조용히 과거를 잃음).
- `entwurf-peek.py:243`/`test-discovery.py` — 세션 헤더 provider 파싱 + `pi-shell-acp/claude-…` id 그래미. 동일.
- → 이 consumer들은 **old(`pi-shell-acp`) OR new(`entwurf`) 둘 다 수용**해야 한다(역사 데이터는 불변 → 옛 문자열 못 지움). **일격 전 반드시 박을 것.**

# 넘으면 안 되는 선

- **아직 치환 시작 금지** — 「나열」 완성 + GLG 비준 후. 몇 번 더 조인다.
- commit = commit skill, **push / tag / publish / repo-rename = GLG**. `--no-verify` 금지, `core.hooksPath`/`.git-hooks-mode` 무단 변경 금지.
- operator 세트 정의(GPT=pi-native host / ACP Claude=socket-citizen / Claude Code=meta-session mailbox-citizen)는 ROADMAP SSOT — rename 중 흔들지 않는다.

# 맥락 / 선행

- 분기점 `acp-on-v2` `a893318`(CP1 정합성 lock) 원격 봉인 완료, stamp `<2026-06-22 19:18>`.
- GPT `20260622T191739-19b503`(gpt-5.5) 설계논의 DONE. 최종 감수는 rename 완결 diff에.
- 추가 구현("더 구현할게 있다") = rename 끝난 *다음 세션* "본질". ROADMAP deferred 후보(persisted resume/load 1b-2c · Claude↔Claude live transport 등).
