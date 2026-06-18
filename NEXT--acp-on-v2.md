# NEXT — `acp-on-v2` 브랜치 (ACP plugin on v2 core, B 방향)

> 부트섹터: **지금 어디 · 다음 한 걸음 · 넘으면 안 되는 선**만.
> base = `v2-only`(clean floor / 지도, **불가침 보존**). 이 브랜치에서 v2 core 위에 ACP를 다시 심는다.
> **앵커(흔들릴 때 SSOT)**: botlog `20260522T092950--§pi-shell-acp…__…mitsein_pi.org` 의
> `* [2026-06-18] ACP도 데리고 간다 — v2-only 위에 ACP plugin 재구현 (B 방향)` heading
> + 그 안의 **GLG 원본 프롬프트 3블록**(요약 금지, 날것 그대로가 지침).

## 목표 (한 줄)

**v2 core + ACP overlay-ingress plugin.** v1은 끝. ACP는 데리고 간다 —
0.11.0을 *기계적으로 port하지 않고*, **구조는 새로 / 행동은 0.11.0(reference spec·behavior oracle)에서 이식**.
**rename 안 함**(`pi-shell-acp` 이름 유지 — ACP가 살아있으니 이름이 정합).

# NOW

- **Current**: `v2-only`에서 분기 완료. v2 substrate(두 레일: 컨트롤소켓 / 메타메일박스) green + LIVE 확인된 clean base 위.
- **Next = 설계 고민 단계 (아직 아무것도 정하지 말 것)**: ACP를 *어떻게* 설계/구현할지 **고민만**.
  **코드·폴더·파일 생성 금지.** 0.11.0 reference 정독 + 아래 "설계 질문 4개" 숙고가 먼저.
- **잠긴 방향 (botlog SSOT — 이건 굳음)**:
  - ACP backend = overlay 격리 **소켓-시민**, 메일박스 **설계상 부재**
    (overlay `settings.json` = `hooks:{}` → meta-bridge hook 없음 → 메일박스 없음; *같은* minimal 설정이 기본도구만 = 가벼움. 한 결정이 둘을 만듦).
  - **차별 없음 = 시민 층위**(entwurf_peers 가시 / garden id 주소화 / entwurf_v2 도달 / 응답 가능). *레일 동일성*이 아님. 메일박스 부재는 차별 아닌 right-sizing(라이브 백엔드라 "나중에 닿기" 불필요).
  - ACP = v2 옆 **병렬레인 아님** → 소켓-시민을 찍어내는 **ingress plugin**. Cortex=`SNOWFLAKE_HOME` overlay = 같은 패턴(파라미터 차이).
  - **스코프**: Claude 먼저(테스트 리그 + 크레딧 헤지) / **Codex 스킵**(native direct-inject로 이미 v2 시민, ACP 중복) / **Cortex·기업용 = payoff**(벤더락 = native 불가, 단 계정 없어 hvkiefer PR #40 재오픈까지 완전검증 대기) / 메이저툴 = native 그대로.
- **설계 질문 4개 (정하지 말고 들고만 있기)**:
  1. overlay 재현 — `settings.json` minimal(`hooks:{}`+autoMemory off) + auth/skills/cache symlink passthrough + sessions/projects/settings 로컬 격리.
  2. v1 소켓 배선 이식성 — v1의 증명된 소켓 경로를 v2 기판으로 *깨끗이 이식* 가능 vs entwurf-control 시민화에 맞춰 재설계.
  3. repo 구조 — "v2 core(어댑터 + 오케스트레이터 자리)" ↔ "ACP plugin(pi 하네스용)" 물리 배치.
  4. Cortex 검증 한계 — 로컬 완전검증 불가(계정 없음), Claude만 지금 완전검증 가능.
- **Green-gate (나중 판정)**: ACP 클로드 형제가 `entwurf_peers`에 native pi 형제와 *똑같이* 뜨고 컨트롤 RPC에 *똑같이* 답함(소켓 레일) + 메일박스 없음(부재 문서화) + `pnpm check`/typecheck/ACP smoke green.
- **Blocker**: none. commit/push/tag/merge = GLG.
- **Read**: 이 파일 + botlog 앵커 heading + (구현 착수 시) 0.11.0 ACP 코드 = reference.

# 따라온 이슈 — v2-only 상속 (substrate, ACP와 무관하게 살아있음 → 그대로 따라감)

- **URGENT README/install doc debt (oracle 2026-06-17)**: checkout/pull/branch-switch 후 `pnpm install`; meta-session canonical = `./run.sh install-meta-bridge`; 검증 `./run.sh doctor-meta-bridge` + `claude mcp get pi-tools-bridge`(중립 cwd `/tmp`도 USER scope Connected); 소스 갱신 후 `pnpm install && ./run.sh install-meta-bridge` 재실행. 수동 `~/.mcp.json`/project MCP는 plain external/debug용으로 격하.
- **meta-store hygiene (GLG 숙고, 미결)**:
  - *재현성*: thinkpad만 v1 정리됨, oracle 등은 v1/orphan 누적 잔존. cleanup verb(`prune --apply` / TTL 자동 / `migrate-v1` 일괄) vs 수동 janitor+문서화. 주의: prune 1.0.0 정책 = **listing-only**(보수적, store는 native→garden lookup 권위) → `--apply`는 정책 변경이라 가볍게 추가 말 것.
  - *store 성장 근원*: 매 Claude 세션 1 record mint + 자동 prune 없음 → 부풀음("지저분" 근원). retention/aging 정책 정할지 결정.
  - *v1 reader 제거 타이밍*: dual-read v1 경로(`parseMetaRecordV1`/`normalizeMetaIdentity` v1 분기) 제거는 **전역 마이그레이션 완료에 게이트** — thinkpad 하나로 당기지 말 것.
  - *model=null (cosmetic)*: 새 record `model` null(Claude hook envelope에 model 없음). 동작 무관, 별도 후속.

# 재triage 필요 — B가 옛 전제를 뒤집음 (⚠️ 그대로 쓰지 말 것)

> v2-only NEXT의 "Phase B 잔여"는 **rename + ACP 제거** 전제였다. B는 둘 다 뒤집는다.
> 아래는 *반전/재검토* 대상 — 옛 메모를 그대로 실행하면 드리프트다.

- **model-lock (반전 주의)**: 옛 메모 = "ACP 제거로 막을 provider 없어 vestigial". **B에선 ACP가 돌아오므로 `native↔pi-shell-acp provider` 전환이 다시 의미를 가질 수 있음.** *삭제로 드리프트 금지* — ACP 재구현 설계와 함께 재정의.
- **provider 하드코드 / resolve-acp-bridge**: rename 안 하므로 `getRegistryRouting`의 `provider:"pi-shell-acp"`는 *유지*. `scripts/resolve-acp-bridge.ts`(v2-only에서 orphan)는 ACP 복귀로 *되살아날 수 있음* — 새 구조에서 재설계.
- **README 재작성**: 여전히 필요하나 프레임 변경 — "ACP 제거"가 아니라 "**v2 core + ACP plugin**". install-meta-bridge 정식 경로 + 실패 해석은 유지.
- **dead export / sentinel / session-messaging**: `runEntwurfSync`/`runEntwurfResumeSync`(호출처 0), sentinel(LEGACY), session-messaging — 옛 메모는 "rename 직전 절삭". B에선 새 구조 정리 시 재판단. 지금 LEGACY fail-loud 보존.

# 다음 SSOT 정렬 — 이번 턴 범위 밖 (GLG가 "정해도 될 때")

> 지금은 NEXT만 정렬. 아래는 *아직 정하지 않기로* 해서 미룸. (지금 건드리면 "정해놓지 말자" 위반)
- **AGENTS.md**: v2-only baseline 설명에 아직 "ACP removed / future rename" 언어 → B로 보정 필요(드리프트 위험원).
- **ROADMAP.md**: "ACP plugin on v2 core" lane 추가.
- 둘 다 **ACP 설계가 굳은 뒤**에.

# 넘으면 안 되는 선
- **지금은 고민 단계 — 코드/폴더/파일 생성 금지. ACP 설계 아무것도 확정 금지.**
- **드리프트 금지**: 옛 칼날("ACP 제거 / rename")로 돌아가지 말 것. ACP는 *데리고 간다*. 흔들리면 botlog 앵커 + 원본 프롬프트 3블록 재독.
- **`v2-only` 브랜치 불가침**: base/지도라 보존. 작업은 이 브랜치에서만.
- `core.hooksPath`/`.git-hooks-mode` 불변. commit/push/tag/publish/merge = GLG. `--no-verify` 금지.
- **0.11.0 = reference spec(behavior oracle). 기계적 port 금지** — 행동만 이식, 구조는 새로.

# 참고
- base 지도: `NEXT--v2-only.md`(v2-only 브랜치에 보존) = 무엇이 최소 생존 셋인지의 정찰 기록.
- 0.11.0 ACP 코어(되살릴 reference, v2-only에서 삭제된 것): `acp-bridge.ts` / `engraving.ts` / `event-mapper.ts` / `pi-context-augment.ts` / `index.ts` + ACP smoke 계열.
- overlay 실측: `~/.pi/agent/claude-config-overlay/` — auth/skills/cache symlink passthrough, sessions/projects/settings 로컬 격리, `settings.json` `hooks:{}`(meta-bridge hook 없음 = 메일박스 부재 by design).
