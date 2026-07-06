# TODO — Port PR #40 (Snowflake Cortex Code ACP backend) to the 0.12 adapter rail

Carried over from session `019f3754-32ee-7c8f-9953-a99c1a6734fe`
(itself a continuation of `019f3748…` → `019f372c…`).

Branch: `snowflake-cortex-code-acp-backend`

## Context

PR #40 (`junghan0611/entwurf` "Add cortex code backend") was written against the
**old 0.11.0** monolith (`acp-bridge.ts` + `index.ts`). The maintainer asked to
**port it to the new 0.12 adapter architecture** — Cortex must land as **one
`cortexAdapter` object** in `pi-extensions/lib/acp/backend-adapter.ts`, registered
in the `ADAPTERS` array, plus cortex assertions in the `check-acp-*` gate family.
The common turn loop is not touched. (Ref: `docs/acp-backend-rail.md` §4/§6/§9.)

The session stopped mid-verification: the last action was a failed ad-hoc registry
smoke (hit the `.js`/strip-types resolver constraint on `engraving.js` import — a
pre-existing constraint, gates tsc-emit around it), then the user said
"retry from where you left" with no assistant response recorded.

## DONE (source implementation, in working tree — uncommitted)

- `models.ts` — cortex curated surface: `CORTEX_MODEL_PREFIX`,
  `curatedCortexModels`, `SUPPORTED_CORTEX_MODEL_IDS` (`cortex-auto`,
  `cortex-claude-sonnet-*`; prefix is the routing authority).
- `overlay.ts` — cortex overlay: `CORTEX_CONFIG_OVERLAY_HOME`,
  `cortexLaunchEnvDefaults`, `ensureCortexConfigOverlay` (SNOWFLAKE_HOME
  redirect + symlink auth through — Hard Rule #8 auth boundary).
- `backend-adapter.ts` — `cortexAdapter` object (line ~316) + registered in
  `ADAPTERS = [claudeAdapter, cortexAdapter]` (line 407) + local `shellQuote`
  for the `CORTEX_ACP_COMMAND` override path.
- `augment.ts` — inline operator-engraving override reader for carrier-less
  backends (engraving.ts addition was reverted to satisfy the strip-types
  `.js`-value-import constraint).
- `scripts/check-shell-quote.ts` — registered the new backend-adapter shellQuote
  parity site (결합 규칙: source + gate together).
- `@earendil-works/pi-ai` bumped to pinned `0.80.3` (env was `0.79.4`,
  missing `/compat`) — `package-lock.json` untracked, needs review.
- **Verified passing:** all 3 typecheck configs (root/mcp/scripts) EXIT 0;
  gates `check-shell-quote`, `check-acp-provider-surface`, `check-acp-config`,
  `check-acp-overlay`, `check-acp-carrier-augment`.

## STILL TODO

1. **Cortex assertions in the `check-acp-*` gate family** (REQUIRED by the port
   spec + 결합 규칙 — currently NONE of `scripts/check-acp*.ts` reference cortex).
   Decide which gate(s) own the cortex axis (provider-surface? a new
   `check-acp-cortex-*`?) and add assertions: cortex curated models register,
   `cortex-` prefix routing → cortexAdapter, prefix strip → native `-m`,
   `cortex-auto` → no `-m`, overlay auth-through, `CORTEX_ACP_COMMAND` override
   quoting.

2. **`run.sh` wiring** — `run.sh` has **no** cortex targets. PR #40 promised
   `./run.sh smoke-cortex` (on-demand LIVE, requires `cortex` on PATH +
   `cortex auth login`; NOT in the claude-only live release floor — capability
   dignity invariant #7). Add the smoke target + any new deterministic
   `check-acp-cortex` target to the `pnpm check` aggregate + case dispatch.

3. **CHANGELOG.md** — add the "Added (Cortex Code backend — Nth ACP sibling)"
   Unreleased entry (PR #40 shipped one; not yet ported). Keep language
   evidence-calibrated.

4. **Finish the verification the session was mid-way through** — confirm cortex
   models register through the real registry path via a tsc-emit or gate (not
   the ad-hoc `node --strip-types` require that fails on `engraving.js`).

5. **Full `pnpm check` green** before commit — the whole static floor, not just
   the touched gates.

6. **Housekeeping** — decide on `package-lock.json` (untracked); confirm the
   pi-ai 0.80.3 bump is intended/committed vs. an env-only fix.

7. **Docs** — if `docs/acp-backend-rail.md` §6 contributor guide needs the
   cortex "as-built" note flipped from "remaining work" to shipped.

## Guardrails (from AGENTS.md)

- Crash, don't warn. Auth boundary: never proxy/copy Cortex/Snowflake creds —
  overlay only symlinks the operator's existing local auth through.
- 결합 규칙: subtract/add source AND its gate together; keep `pnpm check` green.
- Cortex is a deterministic-gated + on-demand-live surface, NOT in the
  claude-only live release floor.
- Surgical changes, one thing at a time.
