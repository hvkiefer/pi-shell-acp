/**
 * entwurf-v2-only — the single source of truth for the `PI_SHELL_ACP_V2_ONLY` mode gate
 * (0.11.0 acceptance blocker B). When the mode is on, every LEGACY v1 entwurf execution
 * surface refuses BEFORE any side effect (Crash-Don't-Warn); the v2 path (`entwurf_v2` /
 * `runEntwurfV2`) is untouched. The flag is a legacy-surface gate, not a core-decision gate:
 * it never inspects or blocks the v2 decider — only the v1 entrypoints import it.
 *
 * Why its own leaf module (zero imports): the consumers span two compilation worlds —
 * `entwurf-control.ts` / `entwurf.ts` are the extension entries compiled by the ROOT tsconfig
 * importing siblings as `.js`, while `mcp/pi-tools-bridge/src/index.ts` is a strip-types
 * `.ts`-import world. Importing any sibling v2 module here would drag its `.ts`-extension
 * subtree into the root program and trip TS5097 (same constraint that forced
 * `entwurf-v2-resume-marker.ts` to be a leaf). So: no imports, self-defined env type, pure
 * functions. The mode is intentionally NOT a code deletion — v1 stays registered and visible;
 * it just hard-refuses on invocation, which is the better surface for detecting bypass
 * attempts than hiding the tools. v1 removal + the 11-scenario v2 replacement are the 0.12 lane.
 */

/** Minimal env shape so this leaf needs no `@types/node` import (a `process.env` value satisfies it). */
export type EnvLike = Record<string, string | undefined>;

/** The mode flag name. SSOT — never re-spell this string in a guard site. */
export const PI_SHELL_ACP_V2_ONLY_ENV = "PI_SHELL_ACP_V2_ONLY";

/**
 * True only when the flag is the EXACT string `"1"`. `"true"` / `"0"` / `""` / missing are all
 * false — a positive exact match avoids the "any truthy value enables it" bypass hole and keeps
 * the gate deterministically testable.
 */
export function isV2OnlyMode(env: EnvLike = process.env): boolean {
	return env[PI_SHELL_ACP_V2_ONLY_ENV] === "1";
}

/**
 * The human-facing refusal text for a blocked v1 `surface`. Mentions the three things a reader
 * must learn: the flag that disabled it, the verb to use instead (`entwurf_v2`), and that the
 * v1-only capabilities (new-sibling create, v1 completion followUp, v1 status UX) are simply
 * unavailable here — NOT "call entwurf_v2 to create a new sibling", which would falsely imply v2
 * is a drop-in for create.
 */
export function v1DisabledMessage(surface: string): string {
	return (
		`${surface} is disabled because PI_SHELL_ACP_V2_ONLY=1 (v2-only mode). ` +
		`Dispatch to an existing target through entwurf_v2 instead. ` +
		`The v1-only capabilities — creating a new sibling, the v1 completion followUp, ` +
		`and the v1 status UX — are unavailable in this mode (v2 is not a drop-in replacement for them).`
	);
}

/** Discriminated result so each surface renders its own protocol-correct refusal. */
export type V1AllowResult = { allowed: true } | { allowed: false; message: string };

/**
 * Pure check for a v1 entwurf `surface`. Returns `{allowed:false, message}` under v2-only mode.
 * Preferred at tool / RPC / startup sites so the caller can emit its own hard refusal
 * (`isError:true` content, `respond(false, …)`, a startup error report) — all of which ARE
 * Crash-Don't-Warn. Only "warn and continue" is forbidden.
 */
export function checkV1EntwurfAllowed(surface: string, env: EnvLike = process.env): V1AllowResult {
	if (isV2OnlyMode(env)) {
		return { allowed: false, message: v1DisabledMessage(surface) };
	}
	return { allowed: true };
}

/**
 * Throwing wrapper over {@link checkV1EntwurfAllowed} for synchronous call sites (and future
 * callers) that want a loud crash rather than a structured result.
 */
export function assertV1EntwurfAllowed(surface: string, env: EnvLike = process.env): void {
	const result = checkV1EntwurfAllowed(surface, env);
	if (!result.allowed) {
		throw new Error(result.message);
	}
}
