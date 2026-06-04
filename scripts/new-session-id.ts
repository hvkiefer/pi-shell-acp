/**
 * new-session-id — print one fresh garden-native sessionId and exit.
 *
 * The garden launcher (operator alias / wrapper) calls this so every
 * `--entwurf-control` session is born a garden citizen:
 *
 *   pi --session-id "$(./run.sh new-session-id)" --entwurf-control \
 *      --emacs-agent-socket server …
 *
 * The id is `generateSessionId()` from entwurf-core — the single SSOT for the
 * locked `YYYYMMDDTHHMMSS-[0-9a-f]{6}` grammar. Do NOT reimplement the format in
 * the shell (it would drift from the validator the resident guard enforces).
 *
 * Stdout is the id and nothing else (no trailing prose), so `$(…)` captures a
 * clean value. Errors go to stderr with a nonzero exit.
 */

import { generateSessionId } from "../pi-extensions/lib/entwurf-core.ts";

try {
	process.stdout.write(`${generateSessionId()}\n`);
} catch (err) {
	process.stderr.write(`new-session-id failed: ${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
}
