/**
 * check-entwurf-delivery — delivery-ack gate for in-pi entwurf_send.
 *
 * Renamed from check-entwurf-send-stuck (2026-05-18). The former script
 * tried to prove two layers separately:
 *   - former Phase A: send handler reliability (`wait_until=message_processed`)
 *   - former Phase B: turn completion reliability (`wait_until=turn_end`)
 * Phase B was a calcification of a contract that did not belong in pi-shell-acp:
 * `entwurf_send` is fire-and-forget (Send-is-throw). Waiting on the receiver's
 * turn completion is a worker pattern, not a peer-message pattern, and the
 * right tool for caller-owned results is `entwurf(mode=async)` + `entwurf_resume`.
 * That surface was removed and Phase B with it.
 *
 * What this gate verifies:
 *   1. send RPC reaches the receiver and the response acks (success / failure).
 *   2. the message is persisted into the receiver's session jsonl
 *      (nonce-tagged grep, best-effort).
 *
 * Anything beyond that — whether the receiver started a turn, whether the
 * receiver finished it, whether the assistant produced output — is OUT OF
 * SCOPE for this gate, by design.
 *
 * Receiver options:
 *   --target <sessionId>     manual — operator has launched a receiver pi
 *                            with `pi --entwurf-control --provider ... --model ...`.
 *   --auto-receiver          auto — tmux-spawn a fresh receiver loaded from
 *                            the working-tree entwurf-control.ts, then tear
 *                            it down on exit. Avoids stale-installed-extension
 *                            confusion. Default provider/model is the cheapest
 *                            native pair so trials cost ~$0 even at 100 sends.
 *
 * Manual gate. Not in `pnpm check`. Spawns a real pi and burns provider API
 * budget per trial (only via the receiver's idle handshake — sends themselves
 * are RPC-only and free).
 *
 * Companion docs: NEXT.md.
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
	target?: string;
	autoReceiver: boolean;
	autoReceiverProvider: string;
	autoReceiverModel: string;
	receiverBootTimeoutMs: number;
	trials: number;
	sendTimeoutMs: number;
}

function parseArgs(): Args {
	const out: Partial<Args> = {
		autoReceiver: false,
		autoReceiverProvider: "openai-codex",
		autoReceiverModel: "gpt-5.4",
		receiverBootTimeoutMs: 30_000,
		trials: 5,
		sendTimeoutMs: 5_000,
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
			case "--auto-receiver":
				out.autoReceiver = true;
				break;
			case "--auto-receiver-provider":
				out.autoReceiverProvider = value;
				i += 1;
				break;
			case "--auto-receiver-model":
				out.autoReceiverModel = value;
				i += 1;
				break;
			case "--receiver-boot-timeout-ms":
				out.receiverBootTimeoutMs = Number.parseInt(value, 10);
				i += 1;
				break;
			case "--trials":
				out.trials = Number.parseInt(value, 10);
				i += 1;
				break;
			case "--send-timeout-ms":
				out.sendTimeoutMs = Number.parseInt(value, 10);
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
	if (!out.target && !out.autoReceiver) usage("missing --target <sessionId> (or --auto-receiver)");
	if (out.target && out.autoReceiver) usage("--target and --auto-receiver are mutually exclusive");
	return out as Args;
}

function usage(error?: string): never {
	if (error) stdout.write(`error: ${error}\n\n`);
	stdout.write(
		`usage: check-entwurf-delivery [--target <sessionId> | --auto-receiver] [options]\n` +
			`\n` +
			`receiver selection (exactly one):\n` +
			`  --target <sessionId>                manual: operator has launched the receiver pi.\n` +
			`  --auto-receiver                     auto: tmux-spawn a fresh receiver loaded from\n` +
			`                                      the working-tree entwurf-control.ts, then tear\n` +
			`                                      it down on exit.\n` +
			`\n` +
			`auto-receiver knobs:\n` +
			`  --auto-receiver-provider <name>     default openai-codex\n` +
			`  --auto-receiver-model <id>          default gpt-5.4 (cheap; switch to opus only when needed)\n` +
			`  --receiver-boot-timeout-ms <N>      default 30000\n` +
			`\n` +
			`trial knobs:\n` +
			`  --trials <N>                        default 5.\n` +
			`  --send-timeout-ms <N>               default 5000.\n` +
			`\n` +
			`Send-is-throw: this gate verifies delivery-ack only (RPC ack + jsonl persist).\n` +
			`No turn-completion wait, no assistant-output capture. Use entwurf(mode=async)\n` +
			`+ entwurf_resume when the caller needs to own a result.\n` +
			`\n` +
			`output: per-trial milestones + summary. exit 0 if every trial acked successfully\n` +
			`and persisted in receiver jsonl, else 1.\n`,
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
	sendAckAt?: number;
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

function rpcSend(socketPath: string, message: string, nonce: string, timeoutMs: number): Promise<TrialResult> {
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

		const timeout = setTimeout(() => socket.destroy(new Error("timeout")), timeoutMs);

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

		socket.on("connect", () => {
			trial.milestones.connectedAt = Date.now();
			const sendCmd = {
				type: "send",
				message,
				mode: "follow_up",
				sender: {
					sessionId: "delivery-smoke",
					agentId: "smoke/check-entwurf-delivery",
					cwd: process.cwd(),
					timestamp: new Date().toISOString(),
					origin: "external-mcp",
					replyable: false,
				},
				wants_reply: false,
			};
			socket.write(`${JSON.stringify(sendCmd)}\n`);
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
					if (msg.type === "response" && msg.command === "send") {
						trial.milestones.sendAckAt = Date.now();
						if (msg.success === false) {
							settle("response-not-success", msg.error ?? "(no error message)");
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
			if (msg === "timeout") settle("timeout", "timed out waiting for response");
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
	const result = spawnSync("grep", ["-l", `delivery-smoke nonce=${nonce}`, jsonlPath], {
		stdio: ["ignore", "pipe", "ignore"],
	});
	return result.status === 0;
}

// ============================================================================
// Auto-receiver — tmux-spawn a fresh pi loaded from working-tree extension
// ============================================================================

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ENTWURF_CONTROL_TS = path.join(REPO_ROOT, "pi-extensions", "entwurf-control.ts");

interface SpawnedReceiver {
	sessionId: string;
	tmuxSession: string;
	socketPath: string;
}

function listExistingSockets(): Set<string> {
	const out = new Set<string>();
	if (!fs.existsSync(ENTWURF_DIR)) return out;
	for (const entry of fs.readdirSync(ENTWURF_DIR)) {
		if (entry.endsWith(".sock")) out.add(entry);
	}
	return out;
}

function killTmuxSession(name: string): void {
	spawnSync("tmux", ["kill-session", "-t", name], { stdio: "ignore" });
}

async function spawnAutoReceiver(args: Args): Promise<SpawnedReceiver> {
	if (!fs.existsSync(ENTWURF_CONTROL_TS)) {
		throw new Error(`working-tree entwurf-control.ts not found at ${ENTWURF_CONTROL_TS}`);
	}
	const tmuxCheck = spawnSync("tmux", ["-V"], { stdio: "ignore" });
	if (tmuxCheck.status !== 0) throw new Error("tmux not found on PATH — required for --auto-receiver");

	const baseline = listExistingSockets();
	const tmuxSession = `delivery-smoke-${crypto.randomUUID().slice(0, 8)}`;
	// Spawn the receiver from os.tmpdir() with --no-context-files /
	// --no-skills / --no-extensions so the first prompt does not pull in
	// the host repo's AGENTS.md, skills, or other extensions as context.
	// -e still loads our working-tree entwurf-control.ts so the actual code
	// under test is fresh, not the globally-installed extension.
	const tmpReceiverCwd = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-smoke-receiver-"));
	const piCmd = [
		"cd",
		tmpReceiverCwd,
		"&&",
		"pi",
		"--no-context-files",
		"--no-skills",
		"--no-extensions",
		"-e",
		ENTWURF_CONTROL_TS,
		"--entwurf-control",
		"--provider",
		args.autoReceiverProvider,
		"--model",
		args.autoReceiverModel,
	].join(" ");

	stdout.write(
		`[delivery-smoke] auto-receiver: spawning in tmux session ${tmuxSession}\n` +
			`                 cwd: ${tmpReceiverCwd}\n` +
			`                 cmd: ${piCmd}\n` +
			`                 extension: ${ENTWURF_CONTROL_TS}\n`,
	);

	const spawnResult = spawnSync("tmux", ["new", "-d", "-s", tmuxSession, piCmd], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (spawnResult.status !== 0) {
		const stderr = spawnResult.stderr?.toString() ?? "(no stderr)";
		throw new Error(`tmux new failed (exit ${spawnResult.status}): ${stderr}`);
	}

	const deadline = Date.now() + args.receiverBootTimeoutMs;
	let newSessionId: string | null = null;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 500));
		const current = listExistingSockets();
		for (const entry of current) {
			if (!baseline.has(entry)) {
				newSessionId = entry.replace(/\.sock$/, "");
				break;
			}
		}
		if (newSessionId) break;
	}
	if (!newSessionId) {
		killTmuxSession(tmuxSession);
		throw new Error(`no new entwurf-control socket appeared within ${args.receiverBootTimeoutMs}ms`);
	}

	const socketPath = path.join(ENTWURF_DIR, `${newSessionId}.sock`);
	// Wait until the receiver responds with idle:true — the pi process can
	// register its socket before the bridge/model handshake settles, and
	// hammering it during that window produces false-positive failures.
	const idleDeadline = Date.now() + args.receiverBootTimeoutMs;
	let idle = false;
	while (Date.now() < idleDeadline) {
		const info = await getReceiverInfo(socketPath);
		if (info?.idle === true) {
			idle = true;
			break;
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	if (!idle) {
		killTmuxSession(tmuxSession);
		throw new Error(`receiver socket appeared but never reported idle within ${args.receiverBootTimeoutMs}ms`);
	}

	stdout.write(`[delivery-smoke] auto-receiver: sessionId=${newSessionId} ready (idle)\n`);
	return { sessionId: newSessionId, tmuxSession, socketPath };
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
// Trial driver
// ============================================================================

async function runTrial(
	socketPath: string,
	sessionId: string,
	idx: number,
	total: number,
	args: Args,
): Promise<TrialResult> {
	const nonce = crypto.randomUUID().slice(0, 8);
	const message = `[delivery-smoke nonce=${nonce}] trial=${idx + 1}/${total}`;
	const trial = await rpcSend(socketPath, message, nonce, args.sendTimeoutMs);

	// Persist check — best-effort. Re-resolve the jsonl path every trial:
	// auto-receiver does not create the session jsonl until the first
	// message arrives, so a path captured before run start is permanently
	// null and persist verification becomes a false RED. Brief sleep gives
	// the receiver time to flush before grep.
	await new Promise((r) => setTimeout(r, 200));
	const jsonlPath = findReceiverJsonl(sessionId);
	if (jsonlPath && fs.existsSync(jsonlPath)) {
		trial.persisted = jsonlContainsNonce(jsonlPath, nonce);
		trial.persistCheckedAt = Date.now();
	}

	return trial;
}

function renderMilestones(m: RpcMilestones): string {
	const dt = (after?: number, before = m.startedAt) =>
		after !== undefined ? `${(after - before).toString().padStart(5, " ")}ms` : "  -  ";
	return [`connect=${dt(m.connectedAt)}`, `sendAck=${dt(m.sendAckAt)}`, `settled=${dt(m.settledAt)}`].join(" ");
}

function renderTrial(t: TrialResult, idx: number, total: number): string {
	const status = t.outcome.padEnd(20, " ");
	const persist = t.persisted ? "✅" : "❌";
	const err = t.error ? `  err=${t.error.slice(0, 80)}` : "";
	return `  trial ${idx + 1}/${total}  ${status}  persist=${persist}  ${renderMilestones(t.milestones)}${err}`;
}

function summarize(trials: TrialResult[]): boolean {
	stdout.write(`\n[delivery-smoke] ─── summary ───\n`);
	const total = trials.length;
	const success = trials.filter((t) => t.outcome === "success").length;
	const persisted = trials.filter((t) => t.persisted).length;
	const timeouts = trials.filter((t) => t.outcome === "timeout").length;
	const closes = trials.filter((t) => t.outcome === "closed").length;
	const errors = trials.filter((t) => t.outcome === "error" || t.outcome === "response-not-success").length;
	stdout.write(
		`  delivery  success=${success}/${total}  persist=${persisted}/${total}  ` +
			`timeout=${timeouts}  close=${closes}  error=${errors}\n`,
	);
	const allGreen = success === total && persisted === total;
	stdout.write(
		`\n[delivery-smoke] verdict: ${allGreen ? "GREEN — delivery + persist OK" : "RED — see per-trial details"}\n`,
	);
	return allGreen;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
	const args = parseArgs();

	let target: string;
	let spawned: SpawnedReceiver | null = null;

	if (args.autoReceiver) {
		spawned = await spawnAutoReceiver(args);
		target = spawned.sessionId;
		// Ensure the tmux receiver is killed on every termination path: clean
		// exit, fatal throw, ctrl+C, parent SIGTERM. Without this we leak pi
		// processes that hold sockets and confuse subsequent runs.
		const cleanup = () => {
			if (spawned) {
				killTmuxSession(spawned.tmuxSession);
				stdout.write(`[delivery-smoke] auto-receiver: tmux session ${spawned.tmuxSession} killed\n`);
				spawned = null;
			}
		};
		process.on("exit", cleanup);
		process.on("SIGINT", () => {
			cleanup();
			exit(130);
		});
		process.on("SIGTERM", () => {
			cleanup();
			exit(143);
		});
	} else {
		target = args.target as string;
	}

	const socketPath = path.join(ENTWURF_DIR, `${target}.sock`);
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
			`warning: receiver reports idle=false; trials run against a busy receiver still ack\n` +
				`         on enqueue, but the message lands as follow_up.\n`,
		);
	}
	stdout.write(
		`[delivery-smoke] target sessionId=${target}\n` +
			`                 cwd=${info.cwd ?? "(unknown)"}\n` +
			`                 model=${info.model?.provider ?? "?"}/${info.model?.id ?? "?"}\n` +
			`                 idle=${info.idle === true ? "yes" : info.idle === false ? "NO" : "?"}\n` +
			`                 trials=${args.trials}  send_timeout=${args.sendTimeoutMs}ms\n`,
	);

	stdout.write(`\n[delivery-smoke] delivery × ${args.trials}\n`);
	const trials: TrialResult[] = [];
	for (let i = 0; i < args.trials; i += 1) {
		const trial = await runTrial(socketPath, target, i, args.trials, args);
		stdout.write(`${renderTrial(trial, i, args.trials)}\n`);
		trials.push(trial);
	}

	const ok = summarize(trials);
	exit(ok ? 0 : 1);
}

main().catch((err) => {
	stdout.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
	exit(1);
});
