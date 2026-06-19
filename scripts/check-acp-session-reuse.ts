// Deterministic gate for S2d-1b-2b in-memory session reuse (backend.ts).
//
// The whole point of reuse is delta-only: turn 2 of a reused session must send
// ONLY the latest user delta, NOT the full transcript (the live ACP session
// already remembers turn 1 — re-sending it would duplicate history). A source
// check ("does it call buildAcpPrompt?") cannot prove that — "I remembered" does
// not prove "I did not also re-send turn 1". So this gate injects a FAKE
// spawn/connection seam and CAPTURES the prompt payload of each turn (GPT ①):
//
//   turn 1 (new):   payload contains the turn-1 nonce          (full transcript)
//   turn 2 (reuse): payload contains the turn-2 nonce          (delta present)
//                   payload does NOT contain the turn-1 nonce  (delta-only proof)
//                   NO second spawn / newSession               (reuse, not respawn)
//
// It also proves: the mutable activePromptHandler routes each turn's
// notifications to THAT turn's stream; a retained child is unref'd (no exit pin)
// but never torn down between turns; a persisted record is NOT resumed in 1b-2b;
// a concurrent prompt fails loud BOTH on a retained busy session AND on a same-key
// first-turn race (GPT blocker 1); an incompatible existing → new closes the old
// child so it is not orphaned, while a model-lock throw leaves the live child
// alone (GPT blocker 2); plus source-shape locks.
//
// backend.ts imports its siblings with `.js` suffixes (the root/jiti runtime
// convention), so — like check-acp-backend-preflight — we tsc-emit the project
// and import the COMPILED backend.js whose `.js` imports resolve to real siblings.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Api, AssistantMessageEvent, Context, Message, Model } from "@earendil-works/pi-ai";

const sonnet = { id: "claude-sonnet-4-6" } as unknown as Model<Api>;
const opus = { id: "claude-opus-4-8" } as unknown as Model<Api>;

type Stream = AsyncIterable<AssistantMessageEvent> & {
	result: () => Promise<{ stopReason: string; errorMessage?: string }>;
};

async function collect(stream: Stream): Promise<AssistantMessageEvent[]> {
	const events: AssistantMessageEvent[] = [];
	for await (const ev of stream) events.push(ev);
	return events;
}

function deltaText(events: AssistantMessageEvent[]): string {
	return events
		.filter((e): e is Extract<AssistantMessageEvent, { type: "text_delta" }> => e.type === "text_delta")
		.map((e) => e.delta)
		.join("");
}

function errorOf(events: AssistantMessageEvent[]): string | undefined {
	const e = events.find((x): x is Extract<AssistantMessageEvent, { type: "error" }> => x.type === "error");
	return e ? (e.error.errorMessage ?? "error") : undefined;
}

// --- fake spawn/connection seam -------------------------------------------

function makeFakeChild() {
	let killed = 0;
	let unrefs = 0;
	const pipe = () => ({
		destroy() {},
		unref() {
			unrefs++;
		},
	});
	return {
		pid: undefined as number | undefined,
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
		stdin: pipe(),
		stdout: pipe(),
		stderr: {
			on() {},
			destroy() {},
			unref() {
				unrefs++;
			},
		},
		kill() {
			killed++;
			return true;
		},
		unref() {
			unrefs++;
		},
		once() {},
		get killed() {
			return killed;
		},
		get unrefs() {
			return unrefs;
		},
	};
}

interface PromptCall {
	sessionId: string;
	text: string;
}

function makeHarness(recordDir: string) {
	const children: ReturnType<typeof makeFakeChild>[] = [];
	const promptCalls: PromptCall[] = [];
	let newSessionSeq = 0;
	let noticeSeq = 0;
	let block: Promise<void> | null = null;

	// biome-ignore lint/suspicious/noExplicitAny: fake seam objects
	const makeConnection = (handlers: any) => ({
		initialize: async () => ({ agentCapabilities: {} }),
		newSession: async () => {
			newSessionSeq++;
			return { sessionId: `ACP-${newSessionSeq}` };
		},
		unstable_setSessionModel: async () => ({}),
		// biome-ignore lint/suspicious/noExplicitAny: fake seam objects
		prompt: async ({ sessionId, prompt }: any) => {
			promptCalls.push({ sessionId, text: prompt.map((b: { text: string }) => b.text).join("\n") });
			if (block) await block;
			noticeSeq++;
			await handlers.sessionUpdate({
				update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `NOTICE-${noticeSeq}` } },
				sessionId,
			});
			return { stopReason: "end_turn" };
		},
	});

	const deps = {
		resolveLaunch: () => ({ command: "node", args: ["fake"] }),
		ensureOverlay: () => {},
		spawnChild: () => {
			const c = makeFakeChild();
			children.push(c);
			return c;
		},
		// biome-ignore lint/suspicious/noExplicitAny: fake seam objects
		createConnection: (_child: any, handlers: any) => makeConnection(handlers),
		lifecyclePolicy: () => "process-scoped",
		now: () => "2026-06-18T00:00:00Z",
		sessionDir: recordDir,
	};

	return {
		deps,
		children,
		promptCalls,
		setBlock(p: Promise<void> | null) {
			block = p;
		},
	};
}

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** An assistant message with arbitrary content blocks (S2f signature/replay tests). */
function mkAssistant(content: Array<{ type: "text"; text: string; textSignature?: string }>): Message {
	return {
		role: "assistant",
		content,
		api: "x",
		provider: "x",
		model: "x",
		usage: ZERO_USAGE,
		stopReason: "stop",
		timestamp: 0,
	} as unknown as Message;
}

// A multi-turn (reuse-shaped) context: a prior user, an assistant, a new user.
function reuseCtx(prior: string, latest: string): Context {
	return {
		messages: [
			{ role: "user", content: prior, timestamp: 0 },
			{
				role: "assistant",
				content: [{ type: "text", text: "ok" }],
				api: "x",
				provider: "x",
				model: "x",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 0,
			},
			{ role: "user", content: latest, timestamp: 0 },
		],
	};
}

const TMP_EMIT = ".tmp-verify/acp-session-reuse";
rmSync(TMP_EMIT, { recursive: true, force: true });
const recordDir = mkdtempSync(resolve(tmpdir(), "acp-reuse-rec-"));

try {
	execFileSync("node_modules/.bin/tsc", ["--outDir", TMP_EMIT, "--rootDir", ".", "--noEmit", "false"], {
		stdio: "pipe",
	});
	const backendUrl = pathToFileURL(resolve(TMP_EMIT, "pi-extensions/lib/acp/backend.js")).href;
	const storeUrl = pathToFileURL(resolve(TMP_EMIT, "pi-extensions/lib/acp/session-store.js")).href;
	// biome-ignore lint/suspicious/noExplicitAny: compiled module imported by URL
	const backend = (await import(backendUrl)) as any;
	// biome-ignore lint/suspicious/noExplicitAny: compiled module imported by URL
	const store = (await import(storeUrl)) as any;

	// ----------------------------------------------------------------------
	// Section A — capture: new=full transcript, reuse=delta-only, no respawn,
	//             mutable routing, retained child unref'd, persisted NOT used
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		const sessionKey = "pi:gate-A";

		// Pre-write a COMPATIBLE persisted record at a DIFFERENT acp id — if the
		// backend (wrongly) resumed it, turn 1 would prompt "OLD-RESUME-ID".
		const turn1Ctx: Context = { messages: [{ role: "user", content: "remember NONCE-AAA", timestamp: 0 }] };
		store.writeSessionRecord(
			store.buildSessionRecord(
				{
					sessionKey,
					acpSessionId: "OLD-RESUME-ID",
					cwd: process.cwd(),
					modelId: sonnet.id,
					bridgeConfigSignature: store.bridgeConfigSignature({
						backend: "claude",
						modelId: sonnet.id,
						appendSystemPrompt: "",
						mcpServers: [],
						settingSources: [],
					}),
					contextMessageSignatures: store.contextMessageSignatures(turn1Ctx),
				},
				"2026-06-17T00:00:00Z",
			),
			recordDir,
		);

		// --- turn 1: new ---
		const t1 = await collect(backend.streamAcpTurn(sonnet, turn1Ctx, { sessionId: "gate-A" }, h.deps) as Stream);
		assert.equal(h.children.length, 1, "turn 1 spawns exactly one child");
		assert.equal(h.promptCalls.length, 1, "turn 1 issued one prompt");
		assert.equal(
			h.promptCalls[0].sessionId,
			"ACP-1",
			"turn 1 uses the FRESH newSession id — NOT the persisted resume id (persisted resume/load is OFF in 1b-2b)",
		);
		assert.match(
			h.promptCalls[0].text,
			/NONCE-AAA/,
			"turn 1 payload carries the turn-1 nonce (full transcript; false-positive guard)",
		);
		assert.match(deltaText(t1), /NOTICE-1/, "turn 1 notice routed to the turn-1 stream");
		assert.ok(
			t1.some((e) => e.type === "done"),
			"turn 1 completes as done",
		);
		assert.ok(h.children[0].unrefs > 0, "retained child is unref'd on retain (no exit pin) — GPT amber");
		assert.equal(h.children[0].killed, 0, "retained child is NOT torn down on a successful new turn");

		// --- turn 2: reuse (compatible prefix) ---
		const t2 = await collect(
			backend.streamAcpTurn(
				sonnet,
				reuseCtx("remember NONCE-AAA", "recall NONCE-BBB"),
				{ sessionId: "gate-A" },
				h.deps,
			) as Stream,
		);
		assert.equal(h.children.length, 1, "turn 2 REUSES — no second spawn");
		assert.equal(h.promptCalls.length, 2, "turn 2 issued one prompt on the reused connection");
		assert.match(h.promptCalls[1].text, /NONCE-BBB/, "turn 2 payload carries the turn-2 delta");
		assert.ok(
			!h.promptCalls[1].text.includes("NONCE-AAA"),
			"turn 2 payload is DELTA-ONLY — it must NOT re-send the turn-1 history (no duplicate injection)",
		);
		assert.match(deltaText(t2), /NOTICE-2/, "turn 2 notice routed to the turn-2 stream (mutable handler)");
		assert.ok(!deltaText(t2).includes("NOTICE-1"), "turn 2 stream does not leak turn-1 notices");
		assert.equal(h.children[0].killed, 0, "reused child is NEVER torn down between turns (stdio preserved)");
	}

	// ----------------------------------------------------------------------
	// Section B — concurrent prompt on a RETAINED live session fails loud
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		// turn 1 (new) → retained.
		await collect(
			backend.streamAcpTurn(
				sonnet,
				{ messages: [{ role: "user", content: "first", timestamp: 0 }] },
				{ sessionId: "gate-B" },
				h.deps,
			) as Stream,
		);

		// Block the next prompt so two reuse turns collide.
		let release!: () => void;
		h.setBlock(new Promise<void>((r) => (release = r)));
		const ctx2 = reuseCtx("first", "second");
		const aDone = collect(backend.streamAcpTurn(sonnet, ctx2, { sessionId: "gate-B" }, h.deps) as Stream);
		await new Promise((r) => setTimeout(r, 20)); // let turn A set busy
		const bEvents = await collect(backend.streamAcpTurn(sonnet, ctx2, { sessionId: "gate-B" }, h.deps) as Stream);
		assert.match(
			String(errorOf(bEvents) ?? ""),
			/busy/,
			"a concurrent prompt on a busy retained session errors (busy)",
		);
		release();
		const aEvents = await aDone;
		assert.ok(
			aEvents.some((e) => e.type === "done"),
			"the blocking turn still completes once released",
		);
	}

	// ----------------------------------------------------------------------
	// Section D — same-key FIRST-turn race fails loud BEFORE retention
	//             (GPT blocker 1: a NEW turn is not in the map yet)
	// ----------------------------------------------------------------------
	{
		const h = makeHarness(recordDir);
		let release!: () => void;
		h.setBlock(new Promise<void>((r) => (release = r)));
		const ctx: Context = { messages: [{ role: "user", content: "only", timestamp: 0 }] };
		// turn A: first turn, blocks in prompt (still in flight, not yet retained).
		const aDone = collect(backend.streamAcpTurn(sonnet, ctx, { sessionId: "gate-D" }, h.deps) as Stream);
		await new Promise((r) => setTimeout(r, 20)); // let turn A claim the key + spawn
		// turn B: second FIRST turn for the SAME key — must fail loud, not spawn.
		const bEvents = await collect(backend.streamAcpTurn(sonnet, ctx, { sessionId: "gate-D" }, h.deps) as Stream);
		assert.match(
			String(errorOf(bEvents) ?? ""),
			/busy/,
			"a concurrent FIRST turn for the same key errors before retention (no double spawn)",
		);
		assert.equal(h.children.length, 1, "the race spawned exactly ONE child (turn B did not spawn)");
		release();
		await aDone;
	}

	// ----------------------------------------------------------------------
	// Section E — incompatible existing → new closes the old child (no orphan);
	//             model-lock throw leaves the live child alone (GPT blocker 2)
	// ----------------------------------------------------------------------
	{
		// E1: cwd drift → incompatible → new spawns childB + closes childA.
		const h = makeHarness(recordDir);
		await collect(
			backend.streamAcpTurn(
				sonnet,
				{ messages: [{ role: "user", content: "x", timestamp: 0 }] },
				{ sessionId: "gate-E1", cwd: "/w1" },
				h.deps,
			) as Stream,
		);
		assert.equal(h.children.length, 1, "E1 turn 1 spawned childA");
		const childA = h.children[0];
		// same key (sessionId), DIFFERENT cwd → existing incompatible → new.
		await collect(
			backend.streamAcpTurn(
				sonnet,
				{ messages: [{ role: "user", content: "y", timestamp: 0 }] },
				{ sessionId: "gate-E1", cwd: "/w2" },
				h.deps,
			) as Stream,
		);
		assert.equal(h.children.length, 2, "E1 incompatible existing → a NEW child spawned");
		assert.ok(childA.killed > 0, "E1 the abandoned incompatible child is CLOSED (not orphaned in retainedChildren)");

		// E2: model-lock throw → live child NOT killed, NOT dropped (survives reuse).
		const h2 = makeHarness(recordDir);
		await collect(
			backend.streamAcpTurn(
				sonnet,
				{ messages: [{ role: "user", content: "x", timestamp: 0 }] },
				{ sessionId: "gate-E2" },
				h2.deps,
			) as Stream,
		);
		const lockChild = h2.children[0];
		const lockEvents = await collect(
			backend.streamAcpTurn(opus, reuseCtx("x", "y"), { sessionId: "gate-E2" }, h2.deps) as Stream,
		);
		assert.match(String(errorOf(lockEvents) ?? ""), /locked/, "E2 model mismatch surfaces a model-lock error");
		assert.equal(lockChild.killed, 0, "E2 model-lock throw does NOT kill the live child");
		assert.equal(h2.children.length, 1, "E2 model-lock throw does NOT spawn a replacement");
		// the locked child still serves a subsequent COMPATIBLE (same-model) reuse.
		await collect(backend.streamAcpTurn(sonnet, reuseCtx("x", "z"), { sessionId: "gate-E2" }, h2.deps) as Stream);
		assert.equal(h2.children.length, 1, "E2 the live child survived the lock throw and was reused (no respawn)");
	}

	// ----------------------------------------------------------------------
	// Section F — S2f progress visibility: lifecycle notices are emitted in the
	//             right order, are display-only (NEVER replayed into a `new`
	//             full-transcript ACP prompt), and do NOT perturb the reuse
	//             signature. Without these the "output-side only" claim is L0.
	// ----------------------------------------------------------------------
	{
		const contextUrl = pathToFileURL(resolve(TMP_EMIT, "pi-extensions/lib/acp/context.js")).href;
		const eventUrl = pathToFileURL(resolve(TMP_EMIT, "pi-extensions/lib/acp/event-mapper.js")).href;
		const ctxMod = (await import(contextUrl)) as any;
		const eventMod = (await import(eventUrl)) as any;
		const MARKER: string = eventMod.LIFECYCLE_NOTICE_SIGNATURE;
		assert.equal(typeof MARKER, "string", "event-mapper exports the lifecycle marker (SSOT)");
		// The two consumer mirrors MUST equal the producer SSOT (strip-types gates
		// forbid a cross-sibling value import, so the constant is mirrored). A drift
		// is what F3/F5 below would catch behaviorally; this is the direct check.
		assert.ok(
			readFileSync("pi-extensions/lib/acp/context.ts", "utf8").includes(`"${MARKER}"`),
			"context.ts mirrors the lifecycle marker exactly (no drift)",
		);
		assert.ok(
			readFileSync("pi-extensions/lib/acp/session-store.ts", "utf8").includes(`"${MARKER}"`),
			"session-store.ts mirrors the lifecycle marker exactly (no drift)",
		);

		// F1: new-turn notice order — preparing → session ready → prompt sent.
		const h = makeHarness(recordDir);
		const t1 = await collect(
			backend.streamAcpTurn(
				sonnet,
				{ messages: [{ role: "user", content: "hi NONCE-F", timestamp: 0 }] },
				{ sessionId: "gate-F" },
				h.deps,
			) as Stream,
		);
		const d1 = deltaText(t1);
		const iPrep = d1.indexOf("[acp: preparing claude session]");
		const iReady = d1.indexOf("[acp: session ready model=claude-sonnet-4-6]");
		const iSent = d1.indexOf("[acp: sending prompt]");
		assert.ok(
			iPrep >= 0 && iReady > iPrep && iSent > iReady,
			"new turn emits preparing → session ready(model) → sending prompt, in order (no silent bootstrap)",
		);

		// F2: reuse-turn notice — reusing → prompt sent, and NO spawn re-announce.
		const t2 = await collect(
			backend.streamAcpTurn(sonnet, reuseCtx("hi NONCE-F", "again NONCE-G"), { sessionId: "gate-F" }, h.deps) as Stream,
		);
		const d2 = deltaText(t2);
		const iReuse = d2.indexOf("[acp: reusing live session]");
		const iSent2 = d2.indexOf("[acp: sending prompt]");
		assert.ok(iReuse >= 0 && iSent2 > iReuse, "reuse turn emits reusing → sending prompt, in order");
		assert.ok(!d2.includes("[acp: preparing"), "reuse turn does NOT re-announce spawn/preparing (it skipped them)");

		// F3: lifecycle notices NEVER reach the ACP wire — display-only, not replayed.
		assert.ok(
			h.promptCalls.every((p) => !p.text.includes("[acp:")),
			"no captured ACP prompt carries a lifecycle notice (display-only, never on the wire)",
		);

		// F4: a `new` full-transcript rebuild DROPS a lifecycle-marked assistant block
		// (context.ts filter) while keeping the real transcript text.
		const ctxWithNotice: Context = {
			messages: [
				{ role: "user", content: "real user line", timestamp: 0 },
				mkAssistant([
					{ type: "text", text: "\n[acp: session ready model=claude-sonnet-4-6]\n", textSignature: MARKER },
					{ type: "text", text: "real assistant line" },
				]),
			],
		};
		const built = ctxMod
			.buildAcpPrompt(ctxWithNotice, "new")
			.map((b: { text: string }) => b.text)
			.join("\n");
		assert.ok(!built.includes("[acp:"), "buildAcpPrompt('new') drops lifecycle-marked blocks (no transcript replay)");
		assert.ok(
			built.includes("real assistant line") && built.includes("real user line"),
			"buildAcpPrompt('new') keeps the real transcript text",
		);

		// F5: a lifecycle-marked block does NOT change the reuse-compat signature —
		// the per-message signature is identical with and without the notice.
		const ctxNoNotice: Context = {
			messages: [
				{ role: "user", content: "real user line", timestamp: 0 },
				mkAssistant([{ type: "text", text: "real assistant line" }]),
			],
		};
		assert.deepEqual(
			store.contextMessageSignatures(ctxWithNotice),
			store.contextMessageSignatures(ctxNoNotice),
			"a lifecycle notice is signature-invariant (display-only does not perturb reuse compatibility)",
		);
	}

	// ----------------------------------------------------------------------
	// Section C — source-shape locks
	// ----------------------------------------------------------------------
	{
		const src = readFileSync("pi-extensions/lib/acp/backend.ts", "utf8");
		assert.match(
			src,
			/buildAcpPrompt\(context,\s*"new"\)/,
			"new turn must build the full transcript via buildAcpPrompt",
		);
		assert.match(src, /buildAcpPrompt\(context,\s*"reuse"\)/, "reuse turn must build the delta via buildAcpPrompt");
		assert.ok(
			!/\bcontextToAcpPrompt\(/.test(src),
			"backend must not hardcode contextToAcpPrompt — the prompt scope must follow bootstrapPath via buildAcpPrompt",
		);
		assert.match(
			src,
			/session\?\.activePromptHandler\?\./,
			"connection callbacks must delegate to the mutable session.activePromptHandler",
		);
		const applyCalls = src.match(/applyAcpSessionUpdate\(/g) ?? [];
		assert.equal(
			applyCalls.length,
			1,
			"applyAcpSessionUpdate must be called exactly once (inside the mutable router, never directly in the connection callback)",
		);
		assert.match(src, /unrefRetainedChild\(spawned\)/, "retained success path must unref the child (no exit pin)");
		assert.match(
			src,
			/inFlightKeys\.add\(sessionKey\)/,
			"the turn must claim the key in flight (first-turn race guard)",
		);
	}
} finally {
	rmSync(TMP_EMIT, { recursive: true, force: true });
	rmSync(recordDir, { recursive: true, force: true });
}

console.log(
	"[check-acp-session-reuse] ok — captured prompts prove new=full transcript / reuse=DELTA-ONLY (turn-2 carries the " +
		"new nonce, never the turn-1 history) with no respawn; mutable activePromptHandler routes each turn's notices to " +
		"its own stream; retained child is unref'd (no exit pin) yet never torn down between turns; persisted record is NOT " +
		"resumed in 1b-2b; concurrent prompts fail loud BOTH on a retained busy session AND on a same-key first-turn race " +
		"(no double spawn); incompatible existing → new closes the old child (no orphan) while a model-lock throw leaves " +
		"the live child alive + reusable; source locks buildAcpPrompt wiring + single-site applyAcpSessionUpdate + unref + " +
		"in-flight claim; S2f progress notices emit in order (new: preparing→ready→sending prompt / reuse: reusing→sending " +
		"prompt), are display-only (never on the ACP wire, dropped from a `new` rebuild, signature-invariant)",
);
