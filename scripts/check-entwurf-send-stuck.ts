/**
 * check-entwurf-send-stuck — reproduce gate for the 2026-05-18 top bug.
 *
 * Drives the entwurf-control unix-socket RPC against a live receiver pi
 * session and measures whether send messages reach the receiver (jsonl
 * persist) and what the wait surface returns (response / event / timeout /
 * close). Splits the matrix into the two layers the incident left
 * ambiguous: send handler reliability (Phase A) vs turn completion event
 * reliability (Phase B), and exposes the subscribe/send ordering variant
 * so a server-side race shows up against the back-to-back baseline.
 *
 * Receiver is launched by the operator (not this script) so we do not
 * burn provider API budget on automated spawn:
 *
 *   $ cd <some dir>
 *   $ pi --entwurf-control --provider pi-shell-acp --model claude-opus-4-7
 *
 * The receiver's sessionId appears in its status bar / get_info response.
 * Pass it via --target.
 *
 *   $ ./run.sh check-entwurf-stuck --target <sessionId>
 *
 * Default trial count is small (5) so a first pass does not blow real-API
 * budget. Push it up with --trials when you want statistical signal.
 * Phase B trials trigger an actual receiver turn each — that is the cost
 * driver. Phase A trials do not start a turn.
 *
 * No fix here. This script's job is to gather evidence so we know whether
 * commits 2beb213 (server-side handleCommand .catch) and d563743
 * (client-side close-before-response) are sufficient, or whether a
 * second root cause is still hiding behind them.
 *
 * Companion docs: NEXT.md §Top Bug → §Reproduce 방법.
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { argv, exit, stdout } from "node:process";

// ============================================================================
// Args
// ============================================================================

interface Args {
	target: string;
	trials: number;
	phase: "A" | "B" | "both";
	variant: "back-to-back" | "ack-first" | "both";
	turnEndTimeoutMs: number;
	messageProcessedTimeoutMs: number;
}

function parseArgs(): Args {
	const out: Partial<Args> = {
		trials: 5,
		phase: "both",
		variant: "back-to-back",
		turnEndTimeoutMs: 60_000,
		messageProcessedTimeoutMs: 5_000,
	};
	const rest = argv.slice(2);
	for (let i = 0; i < rest.length; i += 1) {
		const key = rest[i];
		const value = rest[i + 1];
		switch (key) {
			case "--target":
				out.target = value;
				i += 1;
				break;
			case "--trials":
				out.trials = Number.parseInt(value, 10);
				i += 1;
				break;
			case "--phase":
				if (value !== "A" && value !== "B" && value !== "both") usage(`invalid --phase: ${value}`);
				out.phase = value;
				i += 1;
				break;
			case "--variant":
				if (value !== "back-to-back" && value !== "ack-first" && value !== "both") usage(`invalid --variant: ${value}`);
				out.variant = value;
				i += 1;
				break;
			case "--turn-end-timeout-ms":
				out.turnEndTimeoutMs = Number.parseInt(value, 10);
				i += 1;
				break;
			case "--message-processed-timeout-ms":
				out.messageProcessedTimeoutMs = Number.parseInt(value, 10);
				i += 1;
				break;
			case "-h":
			case "--help":
				usage();
				break;
			default:
				usage(`unknown arg: ${key}`);
		}
	}
	if (!out.target) usage("missing --target <sessionId>");
	return out as Args;
}

function usage(error?: string): never {
	if (error) stdout.write(`error: ${error}\n\n`);
	stdout.write(
		`usage: check-entwurf-send-stuck --target <sessionId> [options]\n` +
			`\n` +
			`options:\n` +
			`  --target <sessionId>                target pi sessionId (UUID). REQUIRED.\n` +
			`  --trials <N>                        trials per (phase × variant). default 5.\n` +
			`  --phase A | B | both                A=message_processed, B=turn_end. default both.\n` +
			`  --variant back-to-back | ack-first | both\n` +
			`                                      subscribe/send ordering for Phase B. default back-to-back.\n` +
			`  --message-processed-timeout-ms <N>  default 5000.\n` +
			`  --turn-end-timeout-ms <N>           default 60000 (shorter than prod 300000 for fast iteration).\n` +
			`\n` +
			`output: per-trial milestones + summary. exit 0 if every trial in every\n` +
			`phase/variant resolved successfully and persisted in receiver jsonl, else 1.\n`,
	);
	exit(error ? 2 : 0);
}

// ============================================================================
// RPC client — minimal reimplementation of sendRpcCommand for instrumentation
// ============================================================================

const ENTWURF_DIR = path.join(os.homedir(), ".pi", "entwurf-control");

interface RpcMilestones {
	startedAt: number;
	connectedAt?: number;
	subscribeAckAt?: number;
	sendAckAt?: number;
	turnEndAt?: number;
	settledAt?: number;
}

type TrialOutcome = "success" | "timeout" | "closed" | "error" | "response-not-success";

interface TrialResult {
	nonce: string;
	outcome: TrialOutcome;
	error?: string;
	milestones: RpcMilestones;
	persisted: boolean;
	persistCheckedAt?: number;
}

interface RpcOptions {
	waitForEvent?: "turn_end";
	timeoutMs: number;
	ackBeforeSend: boolean; // only meaningful when waitForEvent === "turn_end"
}

function rpcSend(socketPath: string, message: string, nonce: string, options: RpcOptions): Promise<TrialResult> {
	const trial: TrialResult = {
		nonce,
		outcome: "error",
		milestones: { startedAt: Date.now() },
		persisted: false,
	};

	return new Promise((resolve) => {
		const socket = net.createConnection(socketPath);
		socket.setEncoding("utf8");

		let buffer = "";
		let settled = false;
		let response: { success?: boolean; error?: string } | null = null;
		let baselineTurnIndex: number | undefined;
		let baselineResolved = false;

		const timeout = setTimeout(() => socket.destroy(new Error("timeout")), options.timeoutMs);

		const settle = (outcome: TrialOutcome, errMsg?: string) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			socket.removeAllListeners();
			socket.destroy();
			trial.outcome = outcome;
			if (errMsg) trial.error = errMsg;
			trial.milestones.settledAt = Date.now();
			resolve(trial);
		};

		const writeSend = () => {
			const sendCmd = {
				type: "send",
				message,
				mode: "follow_up",
				sender: {
					sessionId: "stuck-smoke",
					agentId: "smoke/check-entwurf-send-stuck",
					cwd: process.cwd(),
					timestamp: new Date().toISOString(),
					origin: "external-mcp",
					replyable: false,
				},
				wants_reply: false,
			};
			socket.write(`${JSON.stringify(sendCmd)}\n`);
		};

		socket.on("connect", () => {
			trial.milestones.connectedAt = Date.now();
			if (options.waitForEvent === "turn_end") {
				const subscribeCmd = { type: "subscribe", event: "turn_end" };
				socket.write(`${JSON.stringify(subscribeCmd)}\n`);
				if (!options.ackBeforeSend) writeSend();
			} else {
				writeSend();
			}
		});

		socket.on("data", (chunk) => {
			buffer += chunk;
			let nl = buffer.indexOf("\n");
			while (nl !== -1) {
				const line = buffer.slice(0, nl).trim();
				buffer = buffer.slice(nl + 1);
				nl = buffer.indexOf("\n");
				if (!line) continue;
				try {
					const msg = JSON.parse(line);
					if (msg.type === "response") {
						if (msg.command === "subscribe" && !baselineResolved) {
							trial.milestones.subscribeAckAt = Date.now();
							const data = msg.data as { baselineTurnIndex?: number } | undefined;
							baselineTurnIndex = data?.baselineTurnIndex;
							baselineResolved = true;
							if (options.waitForEvent === "turn_end" && options.ackBeforeSend) writeSend();
							continue;
						}
						if (msg.command === "send") {
							trial.milestones.sendAckAt = Date.now();
							response = msg;
							if (msg.success === false) {
								settle("response-not-success", msg.error ?? "(no error message)");
								return;
							}
							if (options.waitForEvent !== "turn_end") {
								settle("success");
								return;
							}
						}
						continue;
					}
					if (msg.type === "event" && msg.event === "turn_end" && options.waitForEvent === "turn_end") {
						const evtTurnIndex = typeof msg.data?.turnIndex === "number" ? msg.data.turnIndex : undefined;
						if (
							baselineResolved &&
							typeof baselineTurnIndex === "number" &&
							typeof evtTurnIndex === "number" &&
							evtTurnIndex <= baselineTurnIndex
						) {
							continue;
						}
						trial.milestones.turnEndAt = Date.now();
						if (!response) {
							settle("error", "received turn_end before send response");
							return;
						}
						settle("success");
						return;
					}
				} catch {
					// keep waiting
				}
			}
		});

		socket.on("close", () => {
			if (settled) return;
			settle("closed", "connection closed before final outcome");
		});

		socket.on("error", (error) => {
			if (settled) return;
			const msg = error instanceof Error ? error.message : String(error);
			if (msg === "timeout") settle("timeout", "timed out waiting for response/event");
			else settle("error", msg);
		});
	});
}

// ============================================================================
// jsonl persist verification
// ============================================================================

function findReceiverJsonl(target: string): string | null {
	const sessionsRoot = path.join(os.homedir(), ".pi", "agent", "sessions");
	if (!fs.existsSync(sessionsRoot)) return null;
	const dirs = fs.readdirSync(sessionsRoot);
	for (const dir of dirs) {
		const dirPath = path.join(sessionsRoot, dir);
		let entries: string[];
		try {
			entries = fs.readdirSync(dirPath);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.endsWith(`_${target}.jsonl`)) return path.join(dirPath, entry);
		}
	}
	return null;
}

function jsonlContainsNonce(jsonlPath: string, nonce: string): boolean {
	const result = spawnSync("grep", ["-l", `stuck-smoke nonce=${nonce}`, jsonlPath], {
		stdio: ["ignore", "pipe", "ignore"],
	});
	return result.status === 0;
}

// ============================================================================
// Pre-flight — receiver alive and idle
// ============================================================================

interface ReceiverInfo {
	sessionId: string;
	cwd?: string;
	model?: { id?: string; provider?: string };
	idle?: boolean;
}

function getReceiverInfo(socketPath: string): Promise<ReceiverInfo | null> {
	return new Promise((resolve) => {
		const socket = net.createConnection(socketPath);
		socket.setEncoding("utf8");
		let buffer = "";
		const timeout = setTimeout(() => {
			socket.destroy();
			resolve(null);
		}, 2000);
		socket.on("connect", () => {
			socket.write(`${JSON.stringify({ type: "get_info" })}\n`);
		});
		socket.on("data", (chunk) => {
			buffer += chunk;
			const nl = buffer.indexOf("\n");
			if (nl === -1) return;
			const line = buffer.slice(0, nl).trim();
			try {
				const msg = JSON.parse(line);
				if (msg.type === "response" && msg.command === "get_info" && msg.success) {
					clearTimeout(timeout);
					socket.destroy();
					resolve(msg.data as ReceiverInfo);
					return;
				}
			} catch {
				// ignore
			}
		});
		socket.on("error", () => {
			clearTimeout(timeout);
			resolve(null);
		});
	});
}

// ============================================================================
// Phase runners
// ============================================================================

interface PhaseSummary {
	phase: "A" | "B";
	variant: "back-to-back" | "ack-first";
	trials: TrialResult[];
}

async function runTrial(
	socketPath: string,
	jsonlPath: string | null,
	phase: "A" | "B",
	variant: "back-to-back" | "ack-first",
	idx: number,
	total: number,
	args: Args,
): Promise<TrialResult> {
	const nonce = crypto.randomUUID().slice(0, 8);
	const message = `[stuck-smoke nonce=${nonce}] phase=${phase} variant=${variant} trial=${idx + 1}/${total}`;
	const opts: RpcOptions =
		phase === "A"
			? { timeoutMs: args.messageProcessedTimeoutMs, ackBeforeSend: false }
			: {
					waitForEvent: "turn_end",
					timeoutMs: args.turnEndTimeoutMs,
					ackBeforeSend: variant === "ack-first",
				};
	const trial = await rpcSend(socketPath, message, nonce, opts);

	// Persist check — best-effort. Wait briefly for the receiver to flush
	// the jsonl entry before grepping.
	if (jsonlPath && fs.existsSync(jsonlPath)) {
		await new Promise((r) => setTimeout(r, 200));
		trial.persisted = jsonlContainsNonce(jsonlPath, nonce);
		trial.persistCheckedAt = Date.now();
	}

	return trial;
}

function renderMilestones(m: RpcMilestones): string {
	const dt = (after?: number, before = m.startedAt) =>
		after !== undefined ? `${(after - before).toString().padStart(5, " ")}ms` : "  -  ";
	return [
		`connect=${dt(m.connectedAt)}`,
		`subAck=${dt(m.subscribeAckAt)}`,
		`sendAck=${dt(m.sendAckAt)}`,
		`turnEnd=${dt(m.turnEndAt)}`,
		`settled=${dt(m.settledAt)}`,
	].join(" ");
}

function renderTrial(t: TrialResult, idx: number, total: number): string {
	const status = t.outcome.padEnd(20, " ");
	const persist = t.persisted ? "✅" : "❌";
	const err = t.error ? `  err=${t.error.slice(0, 80)}` : "";
	return `  trial ${idx + 1}/${total}  ${status}  persist=${persist}  ${renderMilestones(t.milestones)}${err}`;
}

async function runPhase(
	socketPath: string,
	jsonlPath: string | null,
	phase: "A" | "B",
	variant: "back-to-back" | "ack-first",
	args: Args,
): Promise<PhaseSummary> {
	const label = phase === "A" ? "Phase A — message_processed" : `Phase B — turn_end (${variant})`;
	stdout.write(`\n[stuck-smoke] ${label} × ${args.trials}\n`);
	const trials: TrialResult[] = [];
	for (let i = 0; i < args.trials; i += 1) {
		const trial = await runTrial(socketPath, jsonlPath, phase, variant, i, args.trials, args);
		stdout.write(`${renderTrial(trial, i, args.trials)}\n`);
		trials.push(trial);
	}
	return { phase, variant, trials };
}

// ============================================================================
// Summary
// ============================================================================

function summarize(summaries: PhaseSummary[]): boolean {
	stdout.write(`\n[stuck-smoke] ─── summary ───\n`);
	let allGreen = true;
	for (const s of summaries) {
		const label = s.phase === "A" ? "A msg_proc      " : `B turn_end ${s.variant.padEnd(13, " ")}`;
		const total = s.trials.length;
		const success = s.trials.filter((t) => t.outcome === "success").length;
		const persisted = s.trials.filter((t) => t.persisted).length;
		const timeouts = s.trials.filter((t) => t.outcome === "timeout").length;
		const closes = s.trials.filter((t) => t.outcome === "closed").length;
		const errors = s.trials.filter((t) => t.outcome === "error" || t.outcome === "response-not-success").length;
		stdout.write(
			`  ${label}  success=${success}/${total}  persist=${persisted}/${total}  ` +
				`timeout=${timeouts}  close=${closes}  error=${errors}\n`,
		);
		if (success !== total || persisted !== total) allGreen = false;
	}
	stdout.write(`\n[stuck-smoke] verdict: ${allGreen ? "GREEN — no stuck observed" : "RED — see per-trial details"}\n`);
	return allGreen;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
	const args = parseArgs();
	const socketPath = path.join(ENTWURF_DIR, `${args.target}.sock`);
	if (!fs.existsSync(socketPath)) {
		stdout.write(`error: socket not found at ${socketPath}\n`);
		stdout.write(`hint: is the receiver running with --entwurf-control?\n`);
		exit(2);
	}

	const info = await getReceiverInfo(socketPath);
	if (!info) {
		stdout.write(`error: receiver not responding on ${socketPath}\n`);
		exit(2);
	}
	if (info.idle === false) {
		stdout.write(
			`warning: receiver reports idle=false; trials run against a busy receiver may not exercise the\n` +
				`         follow_up + idle direct-promote path the incident reproduces from.\n`,
		);
	}
	const jsonlPath = findReceiverJsonl(args.target);
	stdout.write(
		`[stuck-smoke] target sessionId=${args.target}\n` +
			`              cwd=${info.cwd ?? "(unknown)"}\n` +
			`              model=${info.model?.provider ?? "?"}/${info.model?.id ?? "?"}\n` +
			`              idle=${info.idle === true ? "yes" : info.idle === false ? "NO" : "?"}\n` +
			`              jsonl=${jsonlPath ?? "(not found — persist check disabled)"}\n` +
			`              trials=${args.trials} phase=${args.phase} variant=${args.variant}\n` +
			`              timeouts: msg_proc=${args.messageProcessedTimeoutMs}ms turn_end=${args.turnEndTimeoutMs}ms\n`,
	);

	const summaries: PhaseSummary[] = [];

	if (args.phase === "A" || args.phase === "both") {
		summaries.push(await runPhase(socketPath, jsonlPath, "A", "back-to-back", args));
	}

	if (args.phase === "B" || args.phase === "both") {
		const variants: ("back-to-back" | "ack-first")[] =
			args.variant === "both" ? ["back-to-back", "ack-first"] : [args.variant];
		for (const v of variants) {
			summaries.push(await runPhase(socketPath, jsonlPath, "B", v, args));
		}
	}

	const ok = summarize(summaries);
	exit(ok ? 0 : 1);
}

main().catch((err) => {
	stdout.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
	exit(1);
});
