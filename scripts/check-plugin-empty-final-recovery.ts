/**
 * check-plugin-empty-final-recovery — deterministic unit test for the
 * `resolveRecoveredFinalMessage` helper in `plugins/openclaw/src/index.ts`.
 *
 * Background: issue #20 (post-#17 regression on the OpenClaw plugin/ACP path).
 * Active Memory `context_pre_compute` returned `status=ok` but the assistant
 * turn surfaced no visible text — the user only saw raw `<command-name>` /
 * `<command-message>` prompt fragments from OpenClaw's render fallback.
 *
 * Root cause was a pair of asymmetric recovery branches inside
 * `finalizeChild`:
 *
 *   - `partialOverridesFinal` fired only on **abnormal** exit.
 *   - `recoveredFromPartial` fired only when finalMessage was **null**.
 *
 * Both branches missed the case where pi exited cleanly with a
 * `message_end{role:"assistant", content:[]}` — non-null final, normal
 * exit, but zero visible text after the stripper. OpenClaw then surfaced
 * the raw prompt block instead of an assistant body.
 *
 * The fix extracts the recovery decision into `resolveRecoveredFinalMessage`
 * and adds two missing covers:
 *   1. `finalIsEmpty` extends both partial-recovery branches symmetrically.
 *   2. A last-resort placeholder synthesizes a minimal text block on a clean
 *      exit with no recovery available — so OpenClaw never sees an empty
 *      assistant body it could fall back on.
 *
 * Abnormal exits with no recovery option still return `recoveryKind: "none"`
 * so the existing diagnostic error path (stderr tail preserved) survives.
 *
 * Coverage matrix (19 cases — every assertion must pass):
 *
 *   | # | finalMessage      | lastPartial    | abnormal | expected kind     | maps to #20 test case        |
 *   |---|-------------------|----------------|----------|-------------------|------------------------------|
 *   | 1 | null              | null           | false    | placeholder       | pre_compute only (no other)  |
 *   | 2 | null              | null           | true     | none              | abnormal exit, nothing       |
 *   | 3 | null              | "streamed"     | false    | partial-recovery  | role guard rejected final    |
 *   | 4 | null              | "streamed"     | true     | partial-override  | failed/timeout pre_compute   |
 *   | 5 | {role:asst, []}   | null           | false    | placeholder       | issue #20 primary surface    |
 *   | 6 | {role:asst, []}   | null           | true     | none              | abnormal + empty + no partial|
 *   | 7 | {role:asst, []}   | "streamed"     | false    | partial-override  | empty final + streamed body  |
 *   | 8 | {role:asst, []}   | "streamed"     | true     | partial-override  | abnormal + empty + partial   |
 *   | 9 | "short"           | "much longer"  | true     | partial-override  | legacy partial-override path |
 *   |10 | "longer reply"    | "tiny"         | true     | as-is             | legacy as-is preserved       |
 *   |11 | "normal reply"    | null           | false    | as-is             | baseline + pre_compute       |
 *   |12 | "normal reply"    | "partial"      | false    | as-is             | normal stream then final     |
 *   |13 | "normal reply"    | "much longer"  | false    | as-is             | clean exit honors final      |
 *   |14 | {role:asst, []}   | "   "          | false    | placeholder       | whitespace-only partial      |
 *   |15 | {role:asst, []}   | "   "          | true     | none              | abnormal + whitespace partial|
 *   |16 | "normal reply"    | "  pad  "      | false    | as-is             | padded partial honors final  |
 *   |17 | "   " (whitespace)| null           | false    | placeholder       | whitespace-only final        |
 *   |18 | "   " (whitespace)| null           | true     | none              | abnormal + whitespace final  |
 *   |19 | "   " (whitespace)| "real text"    | false    | partial-override  | whitespace final + real body |
 *
 * Why this exists separate from smoke gates:
 *   The existing smoke gates spawn pi children and observe end-to-end
 *   behavior. They cannot deterministically construct the
 *   `message_end{role:assistant, content:[]}` shape that issue #20 trips on,
 *   because that shape depends on the upstream model emitting no visible
 *   text after Active Memory pre_compute. This script exercises the
 *   recovery decision directly on synthetic inputs — no pi process, no
 *   network, no API cost.
 *
 * See plugins/openclaw/src/index.ts § final-message recovery, issue #20.
 */

import assert from "node:assert/strict";

import {
	EMPTY_FINAL_PLACEHOLDER_TEXT,
	type RecoveryKind,
	resolveRecoveredFinalMessage,
} from "../plugins/openclaw/src/index.ts";

interface StubModelRow {
	id: string;
	name: string;
	api: string;
	provider: string;
	input: string[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
}

interface AssistantMessage {
	role: "assistant";
	content: Array<{ type: string; text?: string; [k: string]: unknown }>;
	api: string;
	provider: string;
	model: string;
	usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
	stopReason?: string;
	timestamp?: number;
}

const MODEL: StubModelRow = {
	id: "claude-sonnet-4-6",
	name: "Claude Sonnet 4.6 (test)",
	api: "pi-shell-acp",
	provider: "pi-shell-acp",
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200000,
	maxTokens: 8192,
	reasoning: false,
};

function buildMsg(text: string | "empty"): AssistantMessage {
	return {
		role: "assistant",
		content: text === "empty" ? [] : [{ type: "text", text }],
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

function extractText(msg: AssistantMessage | null): string {
	if (!msg) return "";
	return msg.content
		.filter((b) => b.type === "text" && typeof b.text === "string")
		.map((b) => b.text as string)
		.join("\n");
}

interface Case {
	id: number;
	label: string;
	finalMessage: AssistantMessage | null;
	lastPartial: AssistantMessage | null;
	abnormal: boolean;
	expected: RecoveryKind;
}

const CASES: Case[] = [
	{
		id: 1,
		label: "null + null + clean → placeholder",
		finalMessage: null,
		lastPartial: null,
		abnormal: false,
		expected: "placeholder",
	},
	{
		id: 2,
		label: "null + null + abnormal → none",
		finalMessage: null,
		lastPartial: null,
		abnormal: true,
		expected: "none",
	},
	{
		id: 3,
		label: "null + partial + clean → partial-recovery",
		finalMessage: null,
		lastPartial: buildMsg("streamed text"),
		abnormal: false,
		expected: "partial-recovery",
	},
	{
		id: 4,
		label: "null + partial + abnormal → partial-override",
		finalMessage: null,
		lastPartial: buildMsg("streamed text"),
		abnormal: true,
		expected: "partial-override",
	},
	{
		id: 5,
		label: "empty + null + clean → placeholder (issue #20)",
		finalMessage: buildMsg("empty"),
		lastPartial: null,
		abnormal: false,
		expected: "placeholder",
	},
	{
		id: 6,
		label: "empty + null + abnormal → none",
		finalMessage: buildMsg("empty"),
		lastPartial: null,
		abnormal: true,
		expected: "none",
	},
	{
		id: 7,
		label: "empty + partial + clean → partial-override",
		finalMessage: buildMsg("empty"),
		lastPartial: buildMsg("streamed text"),
		abnormal: false,
		expected: "partial-override",
	},
	{
		id: 8,
		label: "empty + partial + abnormal → partial-override",
		finalMessage: buildMsg("empty"),
		lastPartial: buildMsg("streamed text"),
		abnormal: true,
		expected: "partial-override",
	},
	{
		id: 9,
		label: "short final + long partial + abnormal → partial-override",
		finalMessage: buildMsg("short"),
		lastPartial: buildMsg("much longer streamed text"),
		abnormal: true,
		expected: "partial-override",
	},
	{
		id: 10,
		label: "long final + short partial + abnormal → as-is",
		finalMessage: buildMsg("longer assistant reply"),
		lastPartial: buildMsg("tiny"),
		abnormal: true,
		expected: "as-is",
	},
	{
		id: 11,
		label: "valid final + null partial + clean → as-is",
		finalMessage: buildMsg("normal reply"),
		lastPartial: null,
		abnormal: false,
		expected: "as-is",
	},
	{
		id: 12,
		label: "valid final + partial + clean → as-is",
		finalMessage: buildMsg("normal reply"),
		lastPartial: buildMsg("partial chunk"),
		abnormal: false,
		expected: "as-is",
	},
	{
		id: 13,
		label: "valid final + longer partial + clean → as-is (no override on clean exit)",
		finalMessage: buildMsg("normal reply"),
		lastPartial: buildMsg("much longer streamed text"),
		abnormal: false,
		expected: "as-is",
	},
	{
		id: 14,
		label: "empty + whitespace-only partial + clean → placeholder (no whitespace promotion)",
		finalMessage: buildMsg("empty"),
		lastPartial: buildMsg("   "),
		abnormal: false,
		expected: "placeholder",
	},
	{
		id: 15,
		label: "empty + whitespace-only partial + abnormal → none (no whitespace promotion)",
		finalMessage: buildMsg("empty"),
		lastPartial: buildMsg("   "),
		abnormal: true,
		expected: "none",
	},
	{
		id: 16,
		label: "valid final + padded partial of same visible length + clean → as-is (trim equality)",
		finalMessage: buildMsg("normal reply"),
		lastPartial: buildMsg("  normal reply  "),
		abnormal: false,
		expected: "as-is",
	},
	{
		id: 17,
		label: "whitespace-only final + null partial + clean → placeholder",
		finalMessage: buildMsg("   "),
		lastPartial: null,
		abnormal: false,
		expected: "placeholder",
	},
	{
		id: 18,
		label: "whitespace-only final + null partial + abnormal → none",
		finalMessage: buildMsg("   "),
		lastPartial: null,
		abnormal: true,
		expected: "none",
	},
	{
		id: 19,
		label: "whitespace-only final + valid partial + clean → partial-override",
		finalMessage: buildMsg("   "),
		lastPartial: buildMsg("real assistant text"),
		abnormal: false,
		expected: "partial-override",
	},
];

let pass = 0;
const fail: string[] = [];

for (const c of CASES) {
	const result = resolveRecoveredFinalMessage({
		finalMessage: c.finalMessage as never,
		lastPartial: c.lastPartial as never,
		abnormal: c.abnormal,
		model: MODEL as never,
	});

	try {
		assert.equal(
			result.recoveryKind,
			c.expected,
			`case #${c.id} (${c.label}): expected kind=${c.expected}, got ${result.recoveryKind}`,
		);

		if (c.expected === "none") {
			assert.equal(result.finalMessage, null, `case #${c.id}: kind=none must return finalMessage=null`);
		} else {
			assert.ok(result.finalMessage, `case #${c.id}: kind=${c.expected} must return a finalMessage`);
			const text = extractText(result.finalMessage as unknown as AssistantMessage);
			assert.ok(text.length > 0, `case #${c.id}: kind=${c.expected} must produce visible text (got "${text}")`);

			if (c.expected === "placeholder") {
				assert.equal(text, EMPTY_FINAL_PLACEHOLDER_TEXT, `case #${c.id}: placeholder text mismatch`);
			} else if (c.expected === "partial-override" || c.expected === "partial-recovery") {
				assert.equal(text, extractText(c.lastPartial), `case #${c.id}: recovered final must echo partial text`);
			} else if (c.expected === "as-is") {
				assert.equal(text, extractText(c.finalMessage), `case #${c.id}: as-is must preserve original final text`);
			}
		}

		pass += 1;
	} catch (err) {
		fail.push((err as Error).message);
	}
}

// Invariant: empty finalMessage on clean exit MUST never propagate (issue #20 success criterion).
// Equivalently — no case should produce a non-null finalMessage with empty content.
for (const c of CASES) {
	const result = resolveRecoveredFinalMessage({
		finalMessage: c.finalMessage as never,
		lastPartial: c.lastPartial as never,
		abnormal: c.abnormal,
		model: MODEL as never,
	});
	if (result.finalMessage) {
		const text = extractText(result.finalMessage as unknown as AssistantMessage);
		try {
			assert.ok(
				text.trim().length > 0,
				`invariant violated for case #${c.id} (${c.label}): finalMessage returned with empty content — would trigger OpenClaw raw-prompt fallback`,
			);
			pass += 1;
		} catch (err) {
			fail.push((err as Error).message);
		}
	}
}

if (fail.length > 0) {
	for (const m of fail) console.error(`[check-plugin-empty-final-recovery] FAIL: ${m}`);
	console.error(`[check-plugin-empty-final-recovery] ${fail.length} failure(s), ${pass} pass`);
	process.exit(1);
}

console.log(
	`[check-plugin-empty-final-recovery] ${pass} assertions ok (${CASES.length} cases + ${pass - CASES.length} invariant checks)`,
);
