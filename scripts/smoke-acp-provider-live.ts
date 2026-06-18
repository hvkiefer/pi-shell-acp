// S2c — full provider-path acceptance. LIVE-gated, OUT of `pnpm check`.
//
//   LIVE=1 ./run.sh smoke-acp-provider-live
//
// This is the S2c acceptance: it drives the REAL pi provider path end to end,
// not the raw ACP pipe (S2a) or the overlay-aware raw driver (S2b). A real `pi`
// process loads THIS checkout's extension, selects `pi-shell-acp/<model>`, and
// pi's runner calls our `streamSimple` (lib/acp/backend.ts) — which spawns
// claude-agent-acp under the overlay, drives one turn, and maps the result back
// through the S2c event mapper. A unique nonce in the requested reply proves the
// answer came from a live model turn, and the absence of the removed S0 stub
// error proves the provider path actually opened.
//
// Chain proved (and only this): registration → model selection → pi runner →
// streamShellAcp → overlay spawn → ACP turn → event mapping → assistant text.
//
// Deliberately NOT here (later cuts): no session reuse / signature (S2d), no
// identity carrier / engraving / first-user augment (S2d), no MCP/entwurf tool
// wiring into the backend (mcpServers:[] in S2c). Tool-execution behavior is not
// exercised — the prompt is tool-free; the deterministic event-mapper gate owns
// the tool→notice contract.

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = process.env.PI_SHELL_ACP_PROVIDER_MODEL?.trim() || "claude-sonnet-4-6";
const PROVIDER = "pi-shell-acp";
const TURN_TIMEOUT_MS = Number(process.env.PI_SHELL_ACP_PROVIDER_TIMEOUT_MS) || 240_000;

function fail(msg: string): never {
	console.error(`[smoke-acp-provider-live] FAIL: ${msg}`);
	process.exit(1);
}

if (process.env.LIVE !== "1") {
	console.error("[smoke-acp-provider-live] skipped — set LIVE=1 to run the real pi provider turn.");
	process.exit(0);
}

// A nonce makes the expected reply unique so a stray "OK" elsewhere in the
// output cannot pass the assertion. Date.now is fine in a normal smoke script.
const nonce = `${process.pid.toString(36)}${Date.now().toString(36)}`;
const expected = `OK_${nonce}`;

const scratch = mkdtempSync(join(tmpdir(), "pi-shell-acp-s2c-provider-"));
try {
	// --no-extensions + explicit -e REPO_ROOT: load ONLY this checkout's
	// extensions (matches the S1 smoke). --mode text prints the assistant reply
	// to stdout; -p is one-shot non-interactive; --approve auto-approves any
	// pi-level permission (the turn is tool-free, but keep it unattended-safe).
	const args = [
		"--no-extensions",
		"-e",
		REPO_ROOT,
		"--mode",
		"text",
		"-p",
		"--approve",
		"--provider",
		PROVIDER,
		"--model",
		MODEL,
		`Reply with exactly ${expected} and nothing else.`,
	];

	console.error(`[smoke-acp-provider-live] repo:    ${REPO_ROOT}`);
	console.error(`[smoke-acp-provider-live] cwd:     ${scratch}`);
	console.error(`[smoke-acp-provider-live] model:   ${PROVIDER}/${MODEL}`);
	console.error(`[smoke-acp-provider-live] expects: ${expected}`);

	const res = spawnSync("pi", args, { cwd: scratch, encoding: "utf8", timeout: TURN_TIMEOUT_MS, env: process.env });

	const stdout = res.stdout ?? "";
	const stderr = res.stderr ?? "";
	const combined = `${stdout}\n${stderr}`;
	const tail = combined.split("\n").slice(-25).join("\n");

	if (res.error) {
		console.error(`[smoke-acp-provider-live] output tail:\n${tail}`);
		fail(`pi spawn failed: ${res.error.message}`);
	}

	// The removed S0 stub must never reappear — its error is the canary that the
	// provider path did NOT actually open.
	assert.ok(
		!/AcpBackendNotImplementedError|not implemented in S0/i.test(combined),
		"S0 fail-loud stub fired — the provider path did not open (streamSimple is still the stub)",
	);

	if (res.status !== 0) {
		console.error(`[smoke-acp-provider-live] output tail:\n${tail}`);
		fail(`pi exited ${res.status} (signal=${res.signal ?? "none"})`);
	}

	// The live model reply must carry the unique nonce.
	assert.ok(
		stdout.includes(expected),
		`assistant reply did not contain ${expected} (stdout tail: ${JSON.stringify(stdout.slice(-300))})`,
	);

	console.log("[smoke-acp-provider-live] PASS — pi provider path drove a live ACP turn through streamShellAcp");
	console.log(`  model:  ${PROVIDER}/${MODEL}`);
	console.log(`  nonce:  ${expected} present in assistant reply`);
} finally {
	try {
		rmSync(scratch, { recursive: true, force: true });
	} catch {
		// best-effort cleanup
	}
}
