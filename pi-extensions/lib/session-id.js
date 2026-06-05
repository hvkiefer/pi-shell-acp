/**
 * session-id — garden-native session id SSOT (`YYYYMMDDTHHMMSS-[0-9a-f]{6}`).
 *
 * Authored as `.js` for the exact reason protocol.js is (see its header): this
 * leaf is imported from BOTH runtime paths —
 *   - tsc-emit path: pi-extension `.ts` files under the root tsconfig (allowJs),
 *   - `node --experimental-strip-types` path: pure unit gates (check-meta-session,
 *     new-session-id) that import a lib with a literal specifier.
 * strip-types does not substitute `.ts` for a literal `.js` import specifier, and
 * the root config cannot enable `allowImportingTsExtensions` without losing the
 * tsc emit that check-models relies on. A real `.js` leaf resolves identically in
 * every path, so the id grammar has ONE definition instead of one-per-importer.
 *
 * Keep dependency-free except `node:crypto`. The validator/grammar here is the
 * same one the 0.9.0 resident garden guard and entwurf spawn collision pre-check
 * enforce — do NOT fork it.
 */

import { randomBytes } from "node:crypto";

/** `YYYYMMDDTHHMMSS-[0-9a-f]{6}`. Anchored; no surrounding slop. */
export const SESSION_ID_RE = /^\d{8}T\d{6}-[0-9a-f]{6}$/;

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isValidSessionId(value) {
	return typeof value === "string" && SESSION_ID_RE.test(value);
}

/**
 * Local (KST on operator machines) denote-style timestamp `YYYYMMDDTHHMMSS`.
 * Garden sort sense. Local components on purpose — the denote corpus is local.
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function formatSessionTimestamp(now = new Date()) {
	const p = (n, w = 2) => String(n).padStart(w, "0");
	return (
		`${p(now.getFullYear(), 4)}${p(now.getMonth() + 1)}${p(now.getDate())}` +
		`T${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
	);
}

/**
 * Durable garden sessionId minted at the session's true birth. 6 hex suffix
 * defeats same-second parallel-spawn collision; callers that spawn still
 * header-scan pre-check (assertSessionIdAvailableForSpawn).
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function generateSessionId(now = new Date()) {
	return `${formatSessionTimestamp(now)}-${randomBytes(3).toString("hex")}`;
}
