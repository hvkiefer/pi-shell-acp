# NEXT — entwurf 0.12.2 meta-bridge install portability

> 나침반이지 DB가 아니다: **현재 위치 · 다음 한 걸음 · 넘으면 안 되는 선**만 둔다.
> 현재+미래 방향과 설계 SSOT = **`ROADMAP.md`**. 닫힌 변경 핵심 = **`CHANGELOG.md`**. 세션별 process history = git log.

## DONE — 0.12.1 released

- tag `v0.12.1` (origin), npm `@junghanacs/entwurf@0.12.1` publish, GitHub release 모두 완료.
- hejdev6(오라클)에 릴리즈본 `pnpm add -g` 설치 검증: bins/dist/pi-free/`tools/list` 부팅 전부 통과.

## NOW — 0.12.2 WIP in working tree (uncommitted), GPT 검수 완료 · GLG 컷 대기

0.12.1 설치 검증 중 발견한 **메타브리지 install 이식성 회귀 2건**을 닫는 WIP. commit/tag/push/publish 안 함.

**버그 (hejdev6 claude 2.1.97에서 `entwurf install-meta-bridge` rc=1):**
- `claude plugin validate`는 **closed schema**(미지 키 거부). `marketplace.json` 루트 `description`이 구버전 claude에 미등록 → `Unrecognized key`. thinkpad(2.1.195)는 허용 → 신버전 단일 박스 검증이 회귀를 가렸다.
- installed 호스트의 user-scope MCP가 pnpm store **해시 경로**(`$REPO/mcp/.../start.sh`)를 박아 peer/버전 바뀌면 stale. SSOT는 `meta-bridge-state.py::desired_mcp()` (apply가 덮어씀).

**수정 (working tree, `pnpm check` green):**
- A `marketplace.json` 루트 `description` 제거 (minimal-manifest). 설명은 install.sh 주석.
- B `desired_mcp()` + `install.sh`의 `claude mcp add` dual-mode: installed(`*/node_modules/@junghanacs/entwurf`)→안정적 `entwurf-bridge` bin / clone→`start.sh`. env 2개 보존. 판별은 path-suffix(절대 `command -v` 아님 — clone에서 stale 전역 bin 위험).
- C1 신규 `scripts/check-meta-manifest-schema.py` — **CLI 버전 독립** 정적 가드: manifest 키셋 ⊆ 최저-Claude 검증 최소집합 + desired_mcp dual-mode 단언. `pnpm check`/run.sh dispatch/usage 배선. 음성테스트로 그 버그 잡는 것 확인.

**경험적 증명:** hejdev6 floor(claude 2.1.97)에서 root `description` 제거판 전체 manifest validate **통과(exit 0, 무해 경고만)**. hooks.json `asyncRewake`/`timeout` 다른 취약 키 없음 확인.

## 다음 한 걸음

1. **GLG 컷 승인/prepare-release 대기** — Opus 구현 + GPT 검수 완료. patch caution 4건(desired_mcp+install.sh 동시·path-suffix·env보존·no $comment)과 installed-location self-fail fix, hook event subset guard까지 반영 확인.
2. 승인 시: `commit` 스킬 → 버전 0.12.2 bump → `/make-release 0.12.2` → npm publish.
3. 릴리즈 후 hejdev6 clean reinstall(`pnpm add -g @junghanacs/entwurf@0.12.2` → `entwurf install-meta-bridge` → `doctor-meta-bridge`)로 floor 호스트 end-to-end 확정.

## Follow-up (이번 컷 blocker 아님 — GPT 합의 설계)

- **C2** `check-pack-install` 확장: fake `claude` CLI + temp `HOME`/`CLAUDE_CONFIG_DIR`로 installed `node_modules/.bin/entwurf install-meta-bridge` 실행 → `~/.claude.json` command가 해시 store 경로 아니라 안정적 `entwurf-bridge`인지 검증. (지금은 정적 desired_mcp 단언으로만 커버 — 실제 install wiring은 아직 게이트 밖.)
- **C3** support-floor: 실제 최저버전(2.1.97 오라클) validate/install/doctor를 0.12.2 컷 체크리스트 또는 별도 remote gate로. thinkpad 단독 검증은 거짓 안심 → 정직성 가드.
- **멀티하네스(Codex/Antigravity)**: claude marketplace 일반화 금지. 하네스별 adapter contract(manifest shape, MCP 등록면, version floor, doctor evidence). 공통화는 runner/reporting만.
- `smoke-acp-skill-live` "secret probe code" → "probe code/project marker" 낮추기 (injection-refusal 취약 선제 cleanup, GPT 제안 — 0.12.1부터 이월).

## 넘으면 안 되는 선

- Work on `main`; 이 레인용 브랜치 만들지 않음.
- `core.hooksPath` 안 건드림. `--no-verify` 금지.
- GLG 명시 승인 + green preflight 없이 publish/tag/push 금지.
- live release gate 요청 시 scratch cwd + `LIVE=1`.

## 참조

- 설계 SSOT: `ROADMAP.md` · 닫힌 변경: `CHANGELOG.md`
- 검증 calibration: `VERIFY.md`, `BASELINE.md`, `DELIVERY.md`
- repo baseline: `AGENTS.md` · ACP 레일: `docs/acp-backend-rail.md`
- clean-host 설치: `docs/setup-clean-host.md`
