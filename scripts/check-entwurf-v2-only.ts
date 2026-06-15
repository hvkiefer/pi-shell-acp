/**
 * check-entwurf-v2-only — DETERMINISTIC gate for the 0.11.0 (B) v2-only mode blocker.
 * Two layers, no spawn / socket / timer:
 *
 *   A. Pure helper contract (pi-extensions/lib/entwurf-v2-only.ts):
 *      - isV2OnlyMode: ONLY the exact string "1" is true; "true" / "0" / "" / missing are false
 *        (a positive exact match closes the "any truthy value enables it" bypass hole).
 *      - checkV1EntwurfAllowed: off → {allowed:true}; on → {allowed:false, message} where the
 *        message names the flag, the entwurf_v2 verb, and the "unavailable" v1-only capabilities.
 *      - assertV1EntwurfAllowed: throws under v2-only mode, silent otherwise.
 *
 *   B. Source/static guard placement (no runtime needed): every one of the 10 v1 entwurf
 *      entrypoints (9 surface groups; /entwurf tool+command counts as two) carries its guard
 *      at the handler head, AND the v2 core (runner + surface) stays flag-CLEAN — the flag is a
 *      legacy-surface gate, never a v2-decision gate, so the v2 path must not import it.
 *
 * The live behavioural proof (flag on → real surfaces refuse) is out of scope here; this gate
 * locks the contract + wiring so a regression that drops a guard or leaks the flag into the v2
 * core fails `pnpm check` deterministically.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	assertV1EntwurfAllowed,
	checkV1EntwurfAllowed,
	isV2OnlyMode,
	PI_SHELL_ACP_V2_ONLY_ENV,
	v1DisabledMessage,
} from "../pi-extensions/lib/entwurf-v2-only.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = (rel: string): string => readFileSync(`${ROOT}${rel}`, "utf8");
const ON = { [PI_SHELL_ACP_V2_ONLY_ENV]: "1" };

function main(): void {
	// ---- A. helper contract -------------------------------------------------
	ok('A isV2OnlyMode: exact "1" → true', isV2OnlyMode({ [PI_SHELL_ACP_V2_ONLY_ENV]: "1" }));
	ok('A isV2OnlyMode: "true" → false', !isV2OnlyMode({ [PI_SHELL_ACP_V2_ONLY_ENV]: "true" }));
	ok('A isV2OnlyMode: "0" → false', !isV2OnlyMode({ [PI_SHELL_ACP_V2_ONLY_ENV]: "0" }));
	ok('A isV2OnlyMode: "" → false', !isV2OnlyMode({ [PI_SHELL_ACP_V2_ONLY_ENV]: "" }));
	ok("A isV2OnlyMode: missing → false", !isV2OnlyMode({}));

	const off = checkV1EntwurfAllowed("entwurf (spawn)", {});
	ok("A checkV1EntwurfAllowed off → allowed", off.allowed === true);

	const on = checkV1EntwurfAllowed("entwurf (spawn)", ON);
	ok("A checkV1EntwurfAllowed on → blocked", on.allowed === false);
	ok("A blocked message names the surface", !on.allowed && on.message.includes("entwurf (spawn)"));
	ok("A blocked message names the flag", !on.allowed && on.message.includes("PI_SHELL_ACP_V2_ONLY=1"));
	ok("A blocked message names entwurf_v2", !on.allowed && on.message.includes("entwurf_v2"));
	ok("A blocked message says unavailable", !on.allowed && on.message.includes("unavailable"));

	ok(
		"A v1DisabledMessage carries all three tokens",
		(() => {
			const m = v1DisabledMessage("X");
			return m.includes("PI_SHELL_ACP_V2_ONLY=1") && m.includes("entwurf_v2") && m.includes("unavailable");
		})(),
	);

	let threw = false;
	try {
		assertV1EntwurfAllowed("entwurf (spawn)", ON);
	} catch {
		threw = true;
	}
	ok("A assertV1EntwurfAllowed throws under v2-only", threw);

	let threwOff = false;
	try {
		assertV1EntwurfAllowed("entwurf (spawn)", {});
	} catch {
		threwOff = true;
	}
	ok("A assertV1EntwurfAllowed silent when off", !threwOff);

	// ---- B. source/static guard placement -----------------------------------
	// Each v1 entrypoint carries its guard at the handler head, keyed by its unique surface label.
	const GUARD_SITES: { file: string; needle: string }[] = [
		// pi-native (entwurf.ts world)
		{ file: "pi-extensions/entwurf.ts", needle: 'assertV1EntwurfAllowed("entwurf (spawn)")' },
		{ file: "pi-extensions/entwurf.ts", needle: 'assertV1EntwurfAllowed("entwurf_resume")' },
		{ file: "pi-extensions/entwurf.ts", needle: 'checkV1EntwurfAllowed("/entwurf")' },
		// control plane (entwurf-control.ts world)
		{ file: "pi-extensions/entwurf-control.ts", needle: 'checkV1EntwurfAllowed("spawn_async_resume (control RPC)")' },
		{ file: "pi-extensions/entwurf-control.ts", needle: 'checkV1EntwurfAllowed("entwurf_send")' },
		{ file: "pi-extensions/entwurf-control.ts", needle: 'checkV1EntwurfAllowed("/entwurf-send")' },
		{
			file: "pi-extensions/entwurf-control.ts",
			needle: 'checkV1EntwurfAllowed("--entwurf-send-message startup send")',
		},
		// MCP bridge
		{ file: "mcp/pi-tools-bridge/src/index.ts", needle: 'checkV1EntwurfAllowed("entwurf_send (MCP)")' },
		{ file: "mcp/pi-tools-bridge/src/index.ts", needle: 'checkV1EntwurfAllowed("entwurf (MCP spawn)")' },
		{ file: "mcp/pi-tools-bridge/src/index.ts", needle: 'checkV1EntwurfAllowed("entwurf_resume (MCP)")' },
	];
	ok("B exactly 10 guard sites enumerated", GUARD_SITES.length === 10);
	const cache = new Map<string, string>();
	for (const { file, needle } of GUARD_SITES) {
		if (!cache.has(file)) cache.set(file, src(file));
		ok(`B guard present: ${needle}`, cache.get(file)!.includes(needle));
	}

	// The MCP-bypass-proof seam: the spawn_async_resume RPC guard must NOT be the only thing —
	// the MCP entwurf_resume handler also guards directly (it spawns without the control socket).
	// Both are asserted above; restate the invariant as an explicit check for the reader.
	ok(
		"B MCP entwurf_resume + control RPC are BOTH guarded (no single-point bypass)",
		cache.get("mcp/pi-tools-bridge/src/index.ts")!.includes('checkV1EntwurfAllowed("entwurf_resume (MCP)")') &&
			cache
				.get("pi-extensions/entwurf-control.ts")!
				.includes('checkV1EntwurfAllowed("spawn_async_resume (control RPC)")'),
	);

	// v2 core stays flag-CLEAN: the flag is a legacy-surface gate, not a v2-decision gate.
	const V2_CORE = ["pi-extensions/lib/entwurf-v2-runner.ts", "pi-extensions/lib/entwurf-v2-surface.ts"];
	for (const file of V2_CORE) {
		ok(`B v2 core is flag-clean: ${file}`, !src(file).includes("entwurf-v2-only"));
	}

	console.log(`\ncheck-entwurf-v2-only: ${passed} checks passed`);
}

main();
