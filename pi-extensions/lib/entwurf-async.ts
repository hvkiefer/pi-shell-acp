/**
 * entwurf-async — shared state and async-resume launcher.
 *
 * Two callers need the same async machinery:
 *   - the in-pi `entwurf_resume` tool (pi-extensions/entwurf.ts) — calls this
 *     module directly via `spawnEntwurfResumeAsync`.
 *   - the entwurf-control `spawn_async_resume` RPC (pi-extensions/entwurf-control.ts,
 *     Phase B Step 2) — calls the same launcher from RPC dispatch so the MCP
 *     bridge surface (Phase B Step 3) can delegate replyable async resumes
 *     here instead of cloning the body. Preserves the "this bridge is not a
 *     second harness" invariant.
 *
 * Both callers share a single Map (`activeEntwurfs`) — `/entwurf-status` sees
 * every async task regardless of which surface spawned it. This module is the
 * SSOT for that state; importers must not maintain their own parallel maps.
 *
 * No ExtensionAPI dependency: the launcher accepts callbacks for the two
 * ExtensionAPI touchpoints (entry append + completion delivery), so the lib
 * stays platform-neutral and both callsites supply their own parent-session
 * notification surface.
 */

import { type ChildProcess, spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import {
	analyzeSessionFileLike,
	assertLocalOnlyEntwurf,
	findSessionFileById,
	getEntwurfExplicitExtensions,
	mirrorChildStderr,
	readSessionIdentity,
} from "./entwurf-core.js";
import { buildResumePiArgs } from "./entwurf-resume-args.js";

// Local copy of the POSIX-safe quoter — must match the reference body in
// `scripts/check-shell-quote.ts` and the production sites in entwurf.ts and
// entwurf-core.ts. The gate enforces source parity across all three sites.
// Currently unused: remote/SSH entwurf is fail-fast in 0.9.0 (garden-native
// identity is local-FS only), so no shell command string is built. Retained
// for the #11 remote-entwurf revival, with the parity gate guarding its source.
// biome-ignore lint/correctness/noUnusedVariables: retained for #11 remote revival; parity-gated.
function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export const ENTWURF_ENTRY_TYPE = "entwurf-task";

export interface AsyncEntwurfInfo {
	/**
	 * Durable garden-native session handle (`YYYYMMDDTHHMMSS-[0-9a-f]{6}` = JSONL
	 * header id). The active-entwurfs map is keyed by this; resume of the same
	 * session updates the same entry rather than minting a new handle.
	 */
	sessionId: string;
	/**
	 * Internal/diagnostic per-process run id (8 hex). NOT a public handle — it
	 * distinguishes the spawn run from later resume runs of the same sessionId.
	 */
	runId?: string;
	/** Diagnostic only — resolved lazily by header scan; never parsed for logic. */
	sessionFile?: string;
	pid: number;
	host: string;
	task: string;
	// Optional: for local spawn/resume this is the saved-session-header cwd
	// (the authority for cold resume — see entwurf-core.ts INVARIANT block
	// and #9). For remote spawn/resume the spawn-side cwd is ssh-internal and
	// not always knowable here; we record it when present rather than fall
	// back to the resumer's `process.cwd()`, which would re-introduce #9.
	cwd?: string;
	model?: string;
	startTime: number;
	status: "running" | "completed" | "failed";
	exitCode?: number;
	output?: string;
	error?: string;
	stopReason?: string;
	explicitExtensions?: string[];
	warnings?: string[];
}

export type ActiveEntwurfInfo = AsyncEntwurfInfo & { proc?: ChildProcess };

/**
 * Shared map of active async entwurfs (spawn + resume). Both the native pi
 * tool surface and the entwurf-control RPC dispatch surface (Phase B) write
 * here; `/entwurf-status` reads here. Module-level singleton — do NOT create
 * a parallel map at the callsite.
 */
export const activeEntwurfs = new Map<string, ActiveEntwurfInfo>();

/** Cheap liveness check for a given pid. */
export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve (and cache) the diagnostic session file for an active entwurf by
 * header scan. The sessionId (= JSONL header id) is the authority; the filename
 * is never parsed. Returns `null` if Pi has not written the file yet (spawn
 * race) or it is gone. Caches the resolved path back onto `info.sessionFile`.
 */
export function resolveSessionFileForInfo(info: ActiveEntwurfInfo): string | null {
	if (info.sessionFile && fs.existsSync(info.sessionFile)) return info.sessionFile;
	const found = findSessionFileById(info.sessionId);
	if (found) info.sessionFile = found;
	return found;
}

const analyzeSessionFile = analyzeSessionFileLike;

// ============================================================================
// Async resume launcher
// ============================================================================

export interface AsyncResumeParams {
	/** Durable session handle to resume (= JSONL header id). */
	sessionId: string;
	prompt: string;
	host?: string;
}

/**
 * Completion-time payload — what the callsite delivers to the parent session
 * via its ExtensionAPI. Mirrors the body of `pi.sendMessage(message, {
 * triggerTurn: true, deliverAs: "followUp" })` without binding the lib to
 * the ExtensionAPI type.
 */
export interface AsyncResumeCompletionMessage {
	customType: "entwurf-complete";
	content: string;
	display: true;
	details: {
		/** Durable resumed-session handle. The single public handle. */
		sessionId: string;
		/** Internal/diagnostic per-process run id for this resume run. */
		runId: string;
		status: AsyncEntwurfInfo["status"];
		error?: string;
		stopReason?: string;
		exitCode?: number;
		explicitExtensions?: string[];
		warnings?: string[];
	};
}

export interface AsyncResumeCallbacks {
	/**
	 * Append a record of the spawn into the parent session's history. Wraps
	 * `pi.appendEntry(ENTWURF_ENTRY_TYPE, data)` at the callsite.
	 */
	appendActiveEntry: (data: AsyncEntwurfInfo) => void;
	/**
	 * Deliver completion as a followUp message into the parent session. Wraps
	 * `pi.sendMessage(message, { triggerTurn: true, deliverAs: "followUp" })`
	 * at the callsite. Called exactly once when the detached child exits.
	 */
	deliverCompletion: (message: AsyncResumeCompletionMessage) => void;
}

/**
 * Stable substring of pi's stale-ctx error (extensions/loader.ts `invalidate`,
 * agent-session.ts). Matched as a substring so the full guidance suffix pi
 * appends does not break detection.
 */
const STALE_CTX_MARKER = "is stale after session replacement or reload";

/**
 * Wrap a raw completion sender into a best-effort `deliverCompletion`.
 *
 * The completion fires from `proc.on("close")` long after the async spawn
 * returned its ack; by then the parent session ctx may be stale — the session
 * was replaced/reloaded/disposed (pi 0.77's `5b31ffd7 Abort session work during
 * dispose` made teardown stricter, surfacing this latent race; sentinel cell 2
 * [R1]). The entwurf itself already completed; only this notification fails.
 *
 * Policy: if the parent ctx is stale, DROP the notification with a stderr
 * diagnostic instead of crashing the parent to a non-zero exit. Do NOT
 * re-deliver to any other live ctx — that would pollute a different session.
 * Any other sendMessage error is a real wiring break and re-throws (crash-loud,
 * per the entwurf-control fail-loud contract).
 *
 * Shared by every async-completion deliverer that fires from a child
 * `proc.on("close")` after the parent already moved on:
 *   - async spawn completion — the native `entwurf` tool (pi-extensions/entwurf.ts)
 *   - async `entwurf_resume` completion — the native tool (pi-extensions/entwurf.ts)
 *   - async resume via the entwurf-control `spawn_async_resume` RPC
 *     (pi-extensions/entwurf-control.ts)
 * — same race, one guard. Generic over the message payload because spawn and
 * resume completions carry different `details` shapes (spawn has no `runId`).
 */
export function makeBestEffortDeliverCompletion<T>(send: (message: T) => void): (message: T) => void {
	return (message) => {
		try {
			send(message);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			if (reason.includes(STALE_CTX_MARKER)) {
				process.stderr.write(
					"[entwurf] async completion delivery dropped — parent session ctx is stale; " +
						"the entwurf finished but its notification cannot reach the (gone) parent.\n",
				);
				return;
			}
			throw err;
		}
	};
}

export interface AsyncResumeAck {
	text: string;
	details: { sessionId: string; runId: string; sessionFile: string; pid: number };
}

/**
 * Spawn an async entwurf_resume. Detached child + immediate ack; completion is
 * delivered via `callbacks.deliverCompletion` when the child exits.
 *
 * Durable handle: the resumed session keeps its `sessionId` — resume APPENDS to
 * the same session file (via `pi --session-id`), it does not mint a new handle.
 * The active-entwurfs map is re-keyed/updated under that same sessionId so
 * `/entwurf-status` and the #31 worker-team pattern keep seeing one session
 * across spawn → resume → resume. A fresh per-process `runId` (internal/
 * diagnostic) distinguishes this resume run from the spawn run.
 *
 * Identity Preservation Rule is enforced here: the model recorded in the
 * session JSONL (or the in-memory spawn-time info) is the resume's identity;
 * no model parameter overrides this. Throws when neither carrier supplies a
 * model — never invent identity on resume.
 *
 * Cold-resume cwd authority (#9): the saved session header cwd is the
 * authority and is forced as the child cwd so `--session-id` resolves to the
 * existing file (the wrong-cwd footgun would otherwise create a new session).
 * In-process spawn-time info.cwd is used when present, header cwd is the
 * fallback, neither falls back to the resumer's `process.cwd()`.
 *
 * Scope lock (0.9.0 / NEXT.md Phase 3b): local only — remote/SSH is parked
 * under #11 and fails fast at the top (header scan is local-FS).
 */
export async function spawnEntwurfResumeAsync(
	params: AsyncResumeParams,
	callbacks: AsyncResumeCallbacks,
): Promise<AsyncResumeAck> {
	const host = params.host ?? "local";
	assertLocalOnlyEntwurf(host);

	const info = activeEntwurfs.get(params.sessionId);

	// Header scan is the lookup authority (info.sessionFile is only a cache).
	// Throws SessionIdentityError on the wrong-cwd duplicate footgun.
	const sessionFile = findSessionFileById(params.sessionId);
	if (!sessionFile) {
		// Fail-fast: caller asked to resume a sessionId that has no saved session
		// on disk. Throw so the agent stops trying to continue this task.
		throw new Error(
			`Cannot resume entwurf_resume async: session not found for sessionId=${params.sessionId}. ` +
				`The session may belong to a different machine, have been cleaned up, ` +
				`or the id may be wrong. Call entwurf_status to list active entwurfs.`,
		);
	}

	// Identity Preservation Rule: the resume model identity is the session's FIRST
	// model_change (readSessionIdentity), NOT the last assistant message's model.
	// readSessionIdentity throws on model drift / corrupt name mirror (fail-fast),
	// which fits this throwing launcher. Refuse if the session never reached a
	// model_change — never invent an identity for a resume.
	const identity = readSessionIdentity(sessionFile, { requireEntwurf: true });
	const resumeModel = identity?.modelId ?? null;
	if (!identity || !resumeModel) {
		throw new Error(
			`Cannot resume ${params.sessionId}: session has no recorded model ` +
				`(file empty, corrupted, or never reached a model_change). ` +
				`Start a fresh entwurf instead — identity must come from the session.`,
		);
	}
	// Pass recorded provider so ACP-routed spawns get re-injected with the
	// pi-shell-acp bridge on resume (otherwise pi cannot resolve the provider
	// and the resume dies silently — see getEntwurfExplicitExtensions guard).
	const explicitExtensions = getEntwurfExplicitExtensions(resumeModel, false, identity.provider);
	// Explicit ACP intent that can't resolve the bridge — fail-fast. Spawning
	// `--provider pi-shell-acp` here would die with Unknown provider before any
	// turn is appended (#29).
	if (explicitExtensions.unresolvedAcpIntent) {
		throw new Error(
			`Cannot resume ${params.sessionId}: recorded provider=pi-shell-acp but the pi-shell-acp ` +
				`bridge extension could not be resolved (checked settings package source: local path / ` +
				`git install / npm install). Refusing to resume with an unknown provider.`,
		);
	}
	const resumeProvider = explicitExtensions.provider ?? identity.provider;

	// `info?.cwd` is the in-process carrier (spawn + resume in the same pi
	// process); the JSONL header is the cross-process carrier. Neither falls
	// back to `process.cwd()` — the resumer's cwd is NOT a valid authority for
	// cold resume, and a silent fallback re-introduces #9. Forcing child cwd =
	// header cwd also makes `--session-id` resolve to the existing file.
	const cwd = info?.cwd ?? identity.cwd;
	if (!cwd) {
		throw new Error(
			`Cannot resume sessionId "${params.sessionId}": saved session header has no cwd ` +
				`and no in-process cwd carrier was available. The header cwd is the ` +
				`authority for cold resume (see #9).`,
		);
	}

	// SSOT (5c-3b): the resume argv lives in entwurf-resume-args so the legacy worker and the
	// v2 spawn-bg resident citizen can never drift. Legacy variant = the verbatim prior shape
	// (`--no-extensions`, no control socket — so this one-shot `pi -p` can exit).
	const piArgs = buildResumePiArgs({
		variant: "legacy",
		sessionId: params.sessionId,
		explicitExtensionArgs: explicitExtensions.args,
		provider: resumeProvider,
		model: explicitExtensions.modelOverride ?? resumeModel,
		prompt: params.prompt,
	});

	const runId = crypto.randomUUID().slice(0, 8);

	const proc = spawn("pi", piArgs, {
		cwd,
		shell: false,
		detached: true,
		stdio: ["ignore", "ignore", "pipe"],
	});
	// Detach so the resume child survives the parent pi shutting down — the
	// JSONL on disk is the authoritative completion record, not the parent's
	// in-memory map.
	proc.unref();
	mirrorChildStderr(proc);

	const pid = proc.pid ?? 0;

	const resumeInfo: ActiveEntwurfInfo = {
		sessionId: params.sessionId,
		runId,
		sessionFile,
		pid,
		host,
		task: `resume:${params.sessionId} — ${params.prompt.slice(0, 60)}`,
		cwd,
		model: resumeModel,
		startTime: Date.now(),
		status: "running",
		explicitExtensions: [...explicitExtensions.names],
		warnings: [...explicitExtensions.warnings],
		proc,
	};
	// Re-key the same durable session: resume updates the existing entry (or
	// creates one on cold resume), it does not fork a new handle.
	activeEntwurfs.set(params.sessionId, resumeInfo);

	callbacks.appendActiveEntry({
		sessionId: params.sessionId,
		runId,
		sessionFile,
		pid,
		host,
		task: resumeInfo.task,
		cwd,
		startTime: resumeInfo.startTime,
		model: resumeInfo.model,
		status: resumeInfo.status,
		explicitExtensions: resumeInfo.explicitExtensions,
		warnings: resumeInfo.warnings,
	});

	let stderr = "";
	proc.stderr?.on("data", (data: Buffer) => {
		stderr += data.toString();
	});

	proc.on("close", (code) => {
		resumeInfo.exitCode = code ?? 0;
		resumeInfo.status = code === 0 ? "completed" : "failed";
		delete resumeInfo.proc;

		if (fs.existsSync(sessionFile)) {
			const analysis = analyzeSessionFile(sessionFile);
			if (analysis.lastModel) resumeInfo.model = analysis.lastModel;
			resumeInfo.stopReason = analysis.lastStopReason ?? undefined;
			resumeInfo.error = analysis.lastError ?? undefined;
			if (!resumeInfo.error && resumeInfo.stopReason === "error") {
				resumeInfo.error = "Entwurf model returned stopReason=error";
			}
			if ((resumeInfo.error || resumeInfo.stopReason === "error") && resumeInfo.exitCode === 0) {
				resumeInfo.exitCode = 1;
			}
			if (resumeInfo.error || resumeInfo.stopReason === "error") resumeInfo.status = "failed";

			resumeInfo.output = analysis.lastAssistantText ?? resumeInfo.error ?? stderr ?? "(no output)";
			const summaryText = analysis.lastAssistantText ?? resumeInfo.error ?? `exit code ${resumeInfo.exitCode}`;
			const summary =
				summaryText.slice(0, 2000) + (summaryText.length > 2000 ? "\n(truncated, full: session-recap)" : "");
			const meta = [
				resumeInfo.explicitExtensions?.length ? `Compat: ${resumeInfo.explicitExtensions.join(", ")}` : null,
				resumeInfo.warnings?.length ? `Warnings: ${resumeInfo.warnings.join(" | ")}` : null,
			]
				.filter(Boolean)
				.join("\n");

			callbacks.deliverCompletion({
				customType: "entwurf-complete",
				content: [
					`${resumeInfo.status === "failed" ? "❌" : "🏁"} resume \`${params.sessionId}\` (run ${runId}) ${resumeInfo.status} (${analysis.turns} turns, $${analysis.cost.toFixed(4)})`,
					meta || null,
					summary,
				]
					.filter(Boolean)
					.join("\n\n"),
				display: true,
				details: {
					sessionId: params.sessionId,
					runId,
					status: resumeInfo.status,
					error: resumeInfo.error,
					stopReason: resumeInfo.stopReason,
					explicitExtensions: resumeInfo.explicitExtensions,
					warnings: resumeInfo.warnings,
				},
			});
		} else if (stderr || resumeInfo.exitCode !== 0) {
			resumeInfo.status = "failed";
			resumeInfo.error = stderr.slice(0, 500) || `exit code ${resumeInfo.exitCode} (no session file)`;
			resumeInfo.output = resumeInfo.error;
			callbacks.deliverCompletion({
				customType: "entwurf-complete",
				content: `❌ resume \`${params.sessionId}\` (run ${runId}) failed (${host}, no session file): ${resumeInfo.error}`,
				display: true,
				details: {
					sessionId: params.sessionId,
					runId,
					status: "failed",
					exitCode: resumeInfo.exitCode,
					error: resumeInfo.error,
					explicitExtensions: resumeInfo.explicitExtensions,
					warnings: resumeInfo.warnings,
				},
			});
		}
	});

	proc.on("error", (err) => {
		resumeInfo.status = "failed";
		resumeInfo.error = err.message;
		resumeInfo.output = err.message;
		delete resumeInfo.proc;
	});

	return {
		text: [
			`🔄 Resume spawned (async)`,
			`Session ID: ${params.sessionId}`,
			`Run: ${runId}`,
			`Session: ${sessionFile}`,
			`PID: ${pid}`,
			"",
			"Use entwurf_status to check progress. You'll be notified on completion.",
		].join("\n"),
		details: { sessionId: params.sessionId, runId, sessionFile, pid },
	};
}
