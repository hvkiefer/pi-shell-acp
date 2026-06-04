#!/usr/bin/env node --experimental-strip-types
/**
 * Cross-cwd fact-recall smoke for `entwurf_resume` (issue #9).
 *
 * Old `verify-resume` ran turn1 and turn2 inside the same `cd "$project_dir"`,
 * so the pi-shell-acp bridge saw the same cwd both times and the cwd-mismatch
 * branch of `isPersistedSessionCompatible` (acp-bridge.ts) was never exercised.
 * The regression that hit the demo flow needed cwd(turn1) != cwd(turn2): the
 * resumer's process.cwd() flowed into the bridge's persistence params and
 * silently invalidated the Scene 1 record, causing `newSession` fallback and
 * total backend memory loss.
 *
 * This script reproduces that shape end-to-end at the entwurf API layer (no
 * LLM-driven MCP plumbing, no tmux):
 *
 *   1. process.chdir($PROJECT_DIR) then runEntwurfSync({ cwd: $PROJECT_DIR })
 *      to spawn a sibling that plants a unique sentinel token.
 *   2. process.chdir($OTHER_DIR) then runEntwurfResumeSync(sessionId, ..., { cwd: undefined })
 *      — the exact MCP-resume call shape. options.cwd is intentionally
 *      undefined so the fix's `readSessionHeader(sessionFile)?.cwd` fallback
 *      is what aligns the child spawn cwd with the original.
 *   3. Read the appended assistant turn from the saved JSONL and assert the
 *      sentinel was recalled. The model never sees the sentinel in its system
 *      prompt — recall is only possible through ACP-side transcript hydration
 *      keyed off the bridge's `pi:<sessionId>` -> `acpSessionId` mapping.
 *   4. Structural append-not-recreate assertions (T5). Recall (step 3) is the
 *      SEMANTIC proof; step 4 is the FILE/ID-level proof: exactly one session
 *      file for the id before and after, the resume appended IN PLACE to that
 *      same file (turn growth), the header id/cwd never drifted, and NO shadow
 *      session was minted under the resumer's (wrong) cwd session dir. Resume
 *      authority stays = header id + header cwd — never the resumer's process cwd.
 *
 * Exit 0 = recalled + structurally sound, 1 = regression present, 2 = setup failure.
 *
 * Cost: two short claude-sonnet-4-6 turns (~few cents). Acceptable for an
 * explicit verify-gate; not for tight CI.
 */
import fs from "node:fs";
import path from "node:path";

import {
	analyzeSessionFileLike,
	cwdToSessionDir,
	findSessionFilesById,
	readSessionHeader,
	runEntwurfResumeSync,
	runEntwurfSync,
} from "../pi-extensions/lib/entwurf-core.ts";

interface CliArgs {
	projectDir: string;
	otherDir: string;
	model: string;
	sentinel: string;
}

function parseArgs(argv: string[]): CliArgs {
	const args: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a) continue;
		if (a === "--project-dir" || a === "--other-dir" || a === "--model" || a === "--sentinel") {
			const v = argv[i + 1];
			if (!v) {
				console.error(`[cross-cwd-resume] missing value for ${a}`);
				process.exit(2);
			}
			args[a.slice(2)] = v;
			i++;
		}
	}
	const projectDir = args["project-dir"];
	const otherDir = args["other-dir"];
	if (!projectDir || !otherDir) {
		console.error(
			"usage: cross-cwd-resume-smoke.ts --project-dir <dir> --other-dir <dir> [--model <id>] [--sentinel <token>]",
		);
		process.exit(2);
	}
	return {
		projectDir: path.resolve(projectDir),
		otherDir: path.resolve(otherDir),
		model: args["model"] ?? "claude-sonnet-4-6",
		sentinel: args["sentinel"] ?? `cross-cwd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
	};
}

function fail(stage: string, message: string, extra?: string): never {
	console.error(`[cross-cwd-resume] FAIL stage=${stage} ${message}`);
	if (extra) console.error(extra);
	process.exit(1);
}

function samePath(a: string, b: string): boolean {
	return path.resolve(a) === path.resolve(b);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	if (!fs.existsSync(args.projectDir)) fail("setup", `project-dir does not exist: ${args.projectDir}`);
	if (!fs.existsSync(args.otherDir)) fail("setup", `other-dir does not exist: ${args.otherDir}`);
	if (path.resolve(args.projectDir) === path.resolve(args.otherDir)) {
		fail("setup", "project-dir and other-dir must differ — that is the entire point of this gate");
	}

	console.error(`[cross-cwd-resume] project-dir: ${args.projectDir}`);
	console.error(`[cross-cwd-resume] other-dir:   ${args.otherDir}`);
	console.error(`[cross-cwd-resume] model:       ${args.model}`);
	console.error(`[cross-cwd-resume] sentinel:    ${args.sentinel}`);

	// Step 1 — spawn sibling at project-dir cwd.
	process.chdir(args.projectDir);
	console.error(`[cross-cwd-resume] step1: runEntwurfSync (cwd=${process.cwd()})`);
	const spawn = await runEntwurfSync(
		`You are a sibling for a recorded resume gate. Remember exactly this single fact: my favorite token is "${args.sentinel}". ` +
			`Reply with just the word READY. No tool calls. No exploration.`,
		{
			cwd: args.projectDir,
			host: "local",
			provider: "pi-shell-acp",
			model: args.model,
		},
	);
	if (spawn.exitCode !== 0 || !spawn.sessionFile) {
		fail("spawn", `runEntwurfSync rc=${spawn.exitCode} error=${spawn.error ?? "n/a"}`, spawn.output);
	}
	console.error(
		`[cross-cwd-resume] step1 ok: sessionId=${spawn.sessionId} turns=${spawn.turns} sessionFile=${spawn.sessionFile}`,
	);

	const beforeAnalysis = analyzeSessionFileLike(spawn.sessionFile);
	if (!beforeAnalysis.lastAssistantText || !beforeAnalysis.lastAssistantText.includes("READY")) {
		fail(
			"spawn-assert",
			`spawn assistant text did not include READY (got: ${beforeAnalysis.lastAssistantText?.slice(0, 200) ?? "null"})`,
		);
	}

	// Structural baseline (T5): capture the append target BEFORE the cross-cwd
	// resume so step 4 can prove the resume APPENDED to this exact file rather
	// than minting a shadow session in the resumer's cwd. Header is the sole
	// authority — id + cwd are read from the JSONL header, never the filename.
	const filesBefore = findSessionFilesById(spawn.sessionId);
	if (filesBefore.length !== 1) {
		fail(
			"spawn-structural",
			`expected exactly 1 session file for id ${spawn.sessionId} after spawn, found ${filesBefore.length}: ${filesBefore.join(", ")}`,
		);
	}
	const baselineFile = filesBefore[0] as string;
	if (!samePath(baselineFile, spawn.sessionFile)) {
		fail(
			"spawn-structural",
			`findSessionFilesById file (${baselineFile}) != runEntwurfSync sessionFile (${spawn.sessionFile})`,
		);
	}
	const headerBefore = readSessionHeader(baselineFile);
	if (headerBefore?.id !== spawn.sessionId) {
		fail("spawn-structural", `header id ${headerBefore?.id ?? "null"} != sessionId ${spawn.sessionId}`);
	}
	if (!headerBefore?.cwd || !samePath(headerBefore.cwd, args.projectDir)) {
		fail("spawn-structural", `header cwd ${headerBefore?.cwd ?? "null"} != project-dir ${args.projectDir}`);
	}
	const turnsBefore = beforeAnalysis.turns;
	console.error(
		`[cross-cwd-resume] structural baseline: file=${baselineFile} headerId=${headerBefore.id} headerCwd=${headerBefore.cwd} turns=${turnsBefore}`,
	);

	// Step 2 — resume from other-dir cwd. options.cwd intentionally undefined.
	// This is the MCP entwurf_resume shape: the resumer process is unrelated to
	// the original spawn process, so no in-process `info.cwd` exists.
	process.chdir(args.otherDir);
	console.error(`[cross-cwd-resume] step2: runEntwurfResumeSync (cwd=${process.cwd()}, options.cwd=undefined)`);
	const resume = await runEntwurfResumeSync(
		spawn.sessionId,
		"Recall test. No tool calls. Reply with the exact token sentence: `token=<value>`. One line only.",
		{
			host: "local",
			// cwd intentionally undefined — the fix reads it from session header.
		},
	);
	if (resume.exitCode !== 0) {
		fail("resume", `runEntwurfResumeSync rc=${resume.exitCode} error=${resume.error ?? "n/a"}`, resume.output);
	}
	console.error(`[cross-cwd-resume] step2 ok: turns=${resume.turns} cost=${resume.cost}`);

	// Step 3 — assert recall.
	const afterAnalysis = analyzeSessionFileLike(spawn.sessionFile);
	const lastText = afterAnalysis.lastAssistantText ?? "";
	console.error(`[cross-cwd-resume] step3: last assistant text:\n  ${lastText.slice(0, 300)}`);

	if (!lastText.includes(args.sentinel)) {
		fail(
			"recall",
			`sentinel "${args.sentinel}" was NOT recalled. The bridge cwd-mismatch regression is present, or the fix did not apply.`,
			`Last assistant text:\n${lastText}`,
		);
	}

	// Step 4 — structural append-not-recreate assertions (T5). Recall above is
	// the SEMANTIC proof; these are the FILE/ID-level proof.
	const filesAfter = findSessionFilesById(spawn.sessionId);
	// (a) still exactly one session file for this id — no shadow minted anywhere.
	if (filesAfter.length !== filesBefore.length || filesAfter.length !== 1) {
		fail(
			"structural-count",
			`session-file count for id ${spawn.sessionId} changed across resume: before=${filesBefore.length} after=${filesAfter.length} (${filesAfter.join(", ")})`,
		);
	}
	// (b) it is the SAME file, appended in place (turn growth).
	const afterFile = filesAfter[0] as string;
	if (!samePath(afterFile, baselineFile)) {
		fail("structural-samefile", `resume wrote a different session file: before=${baselineFile} after=${afterFile}`);
	}
	if (afterAnalysis.turns <= turnsBefore) {
		fail(
			"structural-append",
			`resume did not append: turns before=${turnsBefore} after=${afterAnalysis.turns} (same file, no growth)`,
		);
	}
	// (c) header id + cwd unchanged by the resume — authority stays = header.
	const headerAfter = readSessionHeader(baselineFile);
	if (headerAfter?.id !== spawn.sessionId) {
		fail("structural-header", `header id drifted after resume: ${headerAfter?.id ?? "null"} != ${spawn.sessionId}`);
	}
	if (!headerAfter?.cwd || !samePath(headerAfter.cwd, args.projectDir)) {
		fail("structural-header", `header cwd drifted after resume: ${headerAfter?.cwd ?? "null"} != ${args.projectDir}`);
	}
	// (d) NO session for this id under the resumer's (wrong) cwd session dir.
	const otherSessionDir = cwdToSessionDir(args.otherDir);
	const strayInOther = filesAfter.filter((f) => samePath(path.dirname(f), otherSessionDir));
	if (strayInOther.length > 0) {
		fail(
			"structural-wrongcwd",
			`resume minted a shadow session under the resumer cwd dir ${otherSessionDir}: ${strayInOther.join(", ")}`,
		);
	}
	console.error(
		`[cross-cwd-resume] structural PASS: same file appended (turns ${turnsBefore}→${afterAnalysis.turns}), ` +
			`header id/cwd stable, no shadow under ${otherSessionDir}.`,
	);

	console.error(`[cross-cwd-resume] PASS — sentinel recalled across cwd boundary + structurally sound.`);
}

main().catch((err) => {
	console.error(`[cross-cwd-resume] FAIL stage=exception ${err instanceof Error ? err.stack : String(err)}`);
	process.exit(1);
});
