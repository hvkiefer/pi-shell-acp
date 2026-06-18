// ACP plugin — real streamSimple backend (S2c). Replaces the S0 fail-loud stub.
//
// This is where the provider path FINALLY opens: selecting a pi-shell-acp model
// and prompting it now drives a real claude-agent-acp turn over stdio NDJSON and
// maps the result back into pi's event stream.
//
// S2c boundary (spawn-per-turn — GPT S2c Q1): every streamSimple call spawns a
// FRESH ACP session (initialize → newSession → setSessionModel → prompt →
// teardown). NO session reuse / persisted record / compatibility signature
// (S2d), NO `_meta.systemPrompt` / engraving (S2d), NO first-user AGENTS /
// project-context augment (S2d). The whole conversation rides as a flattened
// transcript (contextToAcpPrompt) so spawn-per-turn does not silently drop
// multi-turn history.
//
// Errors are encoded into the RETURNED event stream as an `error` event with a
// final assistant message — never thrown after the stream is returned (the
// AssistantMessageEventStream contract).

import { type ChildProcessByStdio, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { contextToAcpPrompt } from "./context.js";
import {
	type AcpPiStreamState,
	applyAcpSessionUpdate,
	createAcpStreamState,
	finalizeAcpStreamState,
	pushPermissionNotice,
} from "./event-mapper.js";
import { claudeLaunchEnvDefaults, ensureClaudeConfigOverlay } from "./overlay.js";
import {
	assertExcludeToolsHonored,
	buildClaudeSessionMeta,
	DEFAULT_CLAUDE_DISALLOWED_TOOLS,
	DEFAULT_CLAUDE_PERMISSION_ALLOW,
	DEFAULT_CLAUDE_TOOLS,
	PI_BUILTIN_BACKED_TOOLS,
} from "./tool-surface.js";

const INITIALIZE_TIMEOUT_MS = 30_000;
const NEW_SESSION_TIMEOUT_MS = 30_000;
const SET_MODEL_TIMEOUT_MS = 30_000;
const PROMPT_TIMEOUT_MS = 600_000;

type StdioChild = ChildProcessByStdio<Writable, Readable, Readable>;

// Race a promise against a timeout, ALWAYS clearing the timer afterwards. A
// naive `Promise.race([p, sleep(ms)])` leaves the timer pending when `p` wins —
// a dangling (here 10-minute) timer that keeps pi's event loop alive long after
// the turn, so pi would never exit a `-p` run. clearTimeout in finally fixes it.
function withTimeout<T>(label: string, p: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
		timer.unref?.();
	});
	return Promise.race([p, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

/** Resolve the claude-agent-acp launch — package bin (resolve), env override for debug. */
function resolveLaunch(): { command: string; args: string[] } {
	const override = process.env.CLAUDE_AGENT_ACP_COMMAND?.trim();
	if (override) return { command: "bash", args: ["-lc", override] };
	const require = createRequire(import.meta.url);
	const pkgJsonPath = require.resolve("@agentclientprotocol/claude-agent-acp/package.json");
	const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { bin?: string | Record<string, string> };
	const binPath = typeof pkgJson.bin === "string" ? pkgJson.bin : pkgJson.bin?.["claude-agent-acp"];
	if (!binPath) throw new Error("@agentclientprotocol/claude-agent-acp resolved but exposes no bin entry");
	return { command: process.execPath, args: [join(dirname(pkgJsonPath), binPath)] };
}

/** Approve-all permission policy (YOLO — oracle F). options empty → cancelled. */
function resolvePermissionResponse(params: { options?: Array<{ optionId: string; kind?: string }> }): {
	outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
} {
	const options = Array.isArray(params?.options) ? params.options : [];
	if (options.length === 0) return { outcome: { outcome: "cancelled" } };
	const allow = options.find((o) => o.kind === "allow_once" || o.kind === "allow_always");
	return { outcome: { outcome: "selected", optionId: (allow ?? options[0]).optionId } };
}

/** ACP prompt stopReason → pi stopReason. */
function mapPromptStopReason(stopReason: string | undefined): AssistantMessage["stopReason"] {
	switch (stopReason) {
		case "max_tokens":
			return "length";
		case "cancelled":
			return "aborted";
		default:
			return "stop";
	}
}

// Signal the child's whole PROCESS GROUP. claude-agent-acp spawns a `claude`
// grandchild that inherits the stdio pipe fds; killing only the direct child
// leaves the grandchild holding the write end of pi's stdout pipe, so pi's event
// loop never drains and the process hangs. The child is spawned `detached` (its
// own group), so a negative-pid kill reaches the grandchild too.
function killChildGroup(child: StdioChild, signal: NodeJS.Signals): void {
	try {
		if (child.pid != null) process.kill(-child.pid, signal);
		else child.kill(signal);
	} catch {
		try {
			child.kill(signal);
		} catch {
			// already gone
		}
	}
}

// Tear the child down WITHOUT blocking pi's exit. The pi process exits only when
// its event loop has no ref'd handles; the backend child's stdio pipes are such
// handles. Awaiting the child's death (it may be slow to honor SIGTERM, and its
// `claude` grandchild can linger) would pin pi open. Instead we (1) destroy pi's
// own pipe handles immediately so the loop frees, (2) unref the child so it never
// keeps the loop alive, (3) SIGTERM the group now and SIGKILL it after a grace on
// an UNREF'd timer (best-effort reaping that does not itself hold pi open).
function teardownChild(child: StdioChild, graceMs = 2_000): void {
	const alreadyDead = child.exitCode !== null || child.signalCode !== null;
	if (!alreadyDead) killChildGroup(child, "SIGTERM");
	for (const s of [child.stdin, child.stdout, child.stderr]) {
		try {
			s?.destroy();
		} catch {
			// best-effort
		}
	}
	try {
		child.unref();
	} catch {
		// best-effort
	}
	if (!alreadyDead) {
		const t = setTimeout(() => killChildGroup(child, "SIGKILL"), graceMs);
		t.unref?.();
	}
}

/**
 * streamSimple for the pi-shell-acp provider. Returns the event stream
 * synchronously and drives the ACP turn on a microtask.
 */
export function streamShellAcp(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): ReturnType<typeof createAssistantMessageEventStream> {
	const stream = createAssistantMessageEventStream();
	const state: AcpPiStreamState = createAcpStreamState(stream, {
		api: "pi-shell-acp",
		provider: "pi-shell-acp",
		model: model.id,
	});
	const opts = options as ({ cwd?: string; signal?: AbortSignal } & SimpleStreamOptions) | undefined;
	const cwd = opts?.cwd ?? process.cwd();
	const signal = opts?.signal;

	stream.push({ type: "start", partial: state.output });

	queueMicrotask(async () => {
		let child: StdioChild | undefined;
		let onAbort: (() => void) | undefined;
		const stderrTail: string[] = [];
		try {
			if (signal?.aborted) throw new Error("aborted before launch");

			// Tool-surface truthfulness preflight (S2b assertExcludeToolsHonored)
			// wired into the RUNTIME path — BEFORE any spawn. If pi excluded a
			// built-in the Claude child will still expose (declared != actual), we
			// fail fast into the stream rather than lie to the model. The pure gate
			// only proves the predicate; this is where it actually guards a turn.
			const activeToolNames = context.tools?.map((t) => t.name) ?? [...PI_BUILTIN_BACKED_TOOLS];
			assertExcludeToolsHonored(activeToolNames, { backend: "claude", tools: DEFAULT_CLAUDE_TOOLS });

			const launch = resolveLaunch();
			// Production overlay (idempotent): redirects the child's Claude
			// SettingsManager at our hooks:{} settings while passing creds through.
			ensureClaudeConfigOverlay();

			child = spawn(launch.command, launch.args, {
				cwd,
				env: { ...process.env, ...claudeLaunchEnvDefaults() },
				stdio: ["pipe", "pipe", "pipe"],
				// Own process group so teardown can signal the claude grandchild too
				// (it inherits pi's stdout pipe fd — see killChildGroup).
				detached: true,
			}) as StdioChild;

			// Drain stderr: an unconsumed stderr pipe can backpressure-deadlock a
			// long turn. Keep a small tail for error diagnostics.
			child.stderr.on("data", (c: Buffer) => {
				stderrTail.push(c.toString());
				if (stderrTail.length > 50) stderrTail.shift();
			});

			// Abort → kill the child; the in-flight RPC rejects and the catch
			// below encodes an `aborted` final message.
			if (signal) {
				onAbort = () => {
					if (child) killChildGroup(child, "SIGTERM");
				};
				signal.addEventListener("abort", onAbort, { once: true });
			}

			const stdoutWeb = Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>;
			const stdinWeb = Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>;
			const transport = ndJsonStream(stdinWeb, stdoutWeb);

			const connection = new ClientSideConnection(
				() => ({
					sessionUpdate: async (notification: { update?: Record<string, unknown> }) => {
						applyAcpSessionUpdate(state, notification?.update);
					},
					requestPermission: async (request: { options?: Array<{ optionId: string; kind?: string }> }) => {
						const response = resolvePermissionResponse(request);
						const decision = response.outcome.outcome === "selected" ? "approved" : "cancelled";
						pushPermissionNotice(state, "permission request", decision);
						return response;
					},
					// fs delegation: clientCapabilities below advertises none, so the
					// agent uses its own tools. Handlers are kept defensively, mirroring
					// 0.11.0: reads are served from real fs, writes are not a surface we
					// expose (the child writes directly via its own Write tool).
					readTextFile: async (request: { path: string }) => ({ content: readFileSync(request.path, "utf8") }),
					writeTextFile: async (): Promise<never> => {
						throw new Error("Client-side writeTextFile is not supported in pi-shell-acp ACP mode.");
					},
				}),
				transport as unknown as ConstructorParameters<typeof ClientSideConnection>[1],
			);

			await withTimeout(
				"initialize",
				connection.initialize({
					protocolVersion: PROTOCOL_VERSION,
					clientCapabilities: {},
					clientInfo: { name: "pi-shell-acp", version: "s2c" },
				} as Parameters<typeof connection.initialize>[0]),
				INITIALIZE_TIMEOUT_MS,
			);

			// Tool-narrowed session meta (S2b). NO _meta.systemPrompt (carrier absent).
			const sessionMeta = buildClaudeSessionMeta({
				modelId: model.id,
				tools: DEFAULT_CLAUDE_TOOLS,
				permissionAllow: DEFAULT_CLAUDE_PERMISSION_ALLOW,
				disallowedTools: DEFAULT_CLAUDE_DISALLOWED_TOOLS,
				settingSources: [],
				strictMcpConfig: false,
				skillPlugins: [],
			});
			const created = (await withTimeout(
				"newSession",
				connection.newSession({ cwd, mcpServers: [], _meta: sessionMeta } as Parameters<
					typeof connection.newSession
				>[0]),
				NEW_SESSION_TIMEOUT_MS,
			)) as { sessionId?: string };
			const sessionId = created?.sessionId;
			if (!sessionId) throw new Error("newSession returned no sessionId");

			// Enforce the requested model — a silent default would lie about which
			// model answered.
			const setModel = (connection as unknown as { unstable_setSessionModel?: (a: unknown) => Promise<unknown> })
				.unstable_setSessionModel;
			if (typeof setModel !== "function") {
				throw new Error(`unstable_setSessionModel unsupported — cannot enforce model ${model.id}`);
			}
			await withTimeout(
				"setSessionModel",
				setModel.call(connection, { sessionId, modelId: model.id }),
				SET_MODEL_TIMEOUT_MS,
			);

			const prompt = contextToAcpPrompt(context);
			if (prompt.length === 0) throw new Error("empty pi context — nothing to prompt");

			const promptResult = (await withTimeout(
				"prompt",
				connection.prompt({ sessionId, prompt } as Parameters<typeof connection.prompt>[0]),
				PROMPT_TIMEOUT_MS,
			)) as { stopReason?: string };

			finalizeAcpStreamState(state);
			const mapped = mapPromptStopReason(promptResult?.stopReason);
			if (signal?.aborted || mapped === "aborted") {
				state.output.stopReason = "aborted";
				stream.push({ type: "error", reason: "aborted", error: state.output });
			} else {
				state.output.stopReason = mapped;
				stream.push({ type: "done", reason: mapped === "length" ? "length" : "stop", message: state.output });
			}
			stream.end();
		} catch (err) {
			finalizeAcpStreamState(state);
			const aborted = Boolean(signal?.aborted);
			state.output.stopReason = aborted ? "aborted" : "error";
			const base = err instanceof Error ? err.message : String(err);
			const tail = stderrTail.join("").trim().slice(-1_000);
			state.output.errorMessage = tail ? `${base}\n--- backend stderr (tail) ---\n${tail}` : base;
			stream.push({ type: "error", reason: aborted ? "aborted" : "error", error: state.output });
			stream.end();
		} finally {
			if (signal && onAbort) signal.removeEventListener("abort", onAbort);
			if (child) teardownChild(child);
		}
	});

	return stream;
}
