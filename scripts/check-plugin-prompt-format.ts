/**
 * check-plugin-prompt-format — deterministic shape gate for the OpenClaw
 * plugin's `buildConversationPrompt` serializer and `stripChatCompletionTail`
 * output sanitizer in `plugins/openclaw/src/index.ts`.
 *
 * Background: issue #20 follow-up incident. After the empty-final recovery
 * fix landed (`e7eefeb`-class), oracle bbot verification on opus-4-7 hit a
 * **contaminated visible body** — the model emitted its actual reply, then a
 * fabricated `User: 어 그래 ㅎㅎ` next-turn line, then a Cline-style
 * `</environment_details>` close tag. None of those tokens exist in our code,
 * OpenClaw, claude-agent-acp, or any ACP source — they came from the model's
 * own training on chat-completion + Cline prompts. The leak was primed by
 * the earlier `buildConversationPrompt` form:
 *
 *   [Earlier in this conversation]
 *   User: ...
 *   Assistant: ...
 *   ...
 *   [Current user message — respond to this, ...]
 *   {lastUserText}
 *
 * Real OpenClaw provider plugins (anthropic/openai/google transport streams)
 * never produce a transcript like this. They pass `context.messages` straight
 * through to native role-array API payloads via `transformTransportMessages`.
 * Our stub couldn't fully replicate that because `pi -p` is single-shot, so
 * the role boundary was being collapsed into a transcript. The new
 * serializer keeps role information as JSON-as-data — read-only context the
 * model is far less likely to mirror as chat continuation — and an explicit
 * non-continuation instruction. Phase 1.4 ts refactor will swap to real ACP
 * stdio framing and `buildConversationPrompt` disappears entirely.
 *
 * `stripChatCompletionTail` is the narrow defense-in-depth: even with the
 * prompt fix, a trailing `</environment_details>` or `User: ...` line that
 * slips through gets stripped at final-only (post-recovery), so OpenClaw
 * never surfaces the leak class. Streamed partials are unaffected to avoid
 * mid-turn display flicker.
 *
 * Coverage:
 *
 *   buildConversationPrompt invariants (8 cases):
 *     1. empty messages → ""
 *     2. single user-only → bare text (no JSON wrapper)
 *     3. multi-turn → JSON array + non-continuation instruction + current msg
 *     4. literal "User: " / "Assistant: " prefix lines are NEVER produced
 *        (the leak-priming surface that issue #20 follow-up traced)
 *     5. toolResult turns are skipped (no provider for them in single-shot)
 *     6. empty-text turns are skipped
 *     7. JSON content survives round-trip through `JSON.parse` (well-formed)
 *     8. instruction is scoped to context echo, NOT a blanket "no JSON in
 *        reply" (which would break legitimate "respond in JSON" requests)
 *
 *   stripChatCompletionTail invariants (10 cases — narrow patterns only):
 *     9. unchanged when no trailing pattern
 *    10. strips trailing `User:` line ONLY with blank-line boundary (`\n{2,}`)
 *    11. strips trailing `Human:` line with blank-line boundary
 *    12. strips trailing `Assistant:` line with blank-line boundary
 *    13. strips trailing `</environment_details>` (allowlist, case-insensitive)
 *    14. does NOT strip arbitrary closing tags — `</root>`, `</xml>` preserved
 *    15. strips both trailing User: and `</environment_details>` combined leak
 *    16. caps fabricated-line length at 160 chars so quoted blocks preserved
 *    17. preserves inline "User: " mid-text (no trailing position)
 *    18. handles empty / non-string input gracefully
 *
 *   sanitizeFinalAssistantMessage invariants — empty-final guard (4 cases):
 *    19. preserves non-leak content unchanged
 *    20. strips combined leak tail but keeps real reply
 *    21. falls back to placeholder when sanitize would empty the body
 *        (the issue #20 invariant — OpenClaw must NEVER see an empty assistant
 *        body or it surfaces raw prompt fragments via its render fallback)
 *    22. falls back to placeholder when all content is the User: leak shape
 *
 * No pi process, no network, no API cost.
 *
 * See plugins/openclaw/src/index.ts § buildConversationPrompt / stripChatCompletionTail,
 * issue #20 follow-up incident.
 */

import assert from "node:assert/strict";

import {
	buildConversationPrompt,
	EMPTY_FINAL_PLACEHOLDER_TEXT,
	sanitizeFinalAssistantMessage,
	stripChatCompletionTail,
} from "../plugins/openclaw/src/index.ts";

interface InboundMessage {
	role: "user" | "assistant" | "toolResult";
	content: Array<{ type: string; text?: string; [k: string]: unknown }> | string;
}

interface Context {
	messages?: InboundMessage[];
	workspaceDir?: string;
}

function user(text: string): InboundMessage {
	return { role: "user", content: [{ type: "text", text }] };
}

function assistant(text: string): InboundMessage {
	return { role: "assistant", content: [{ type: "text", text }] };
}

function toolResult(text: string): InboundMessage {
	return { role: "toolResult", content: [{ type: "text", text }] };
}

let pass = 0;
const fail: string[] = [];

function check(name: string, fn: () => void): void {
	try {
		fn();
		pass += 1;
	} catch (err) {
		fail.push(`${name}: ${(err as Error).message}`);
	}
}

// ─── buildConversationPrompt invariants ───────────────────────────────────

check("1. empty messages → empty string", () => {
	assert.equal(buildConversationPrompt({ messages: [] } as Context as never), "");
	assert.equal(buildConversationPrompt(null as never), "");
	assert.equal(buildConversationPrompt(undefined as never), "");
});

check("2. single user-only → bare text (no JSON wrapper)", () => {
	const out = buildConversationPrompt({ messages: [user("hello")] } as Context as never);
	assert.equal(out, "hello");
	assert.ok(!out.includes("["), "single-turn must not include JSON array");
	assert.ok(!out.includes("[Prior conversation context]"));
});

check("3. multi-turn produces JSON context + non-continuation instruction + current msg", () => {
	const out = buildConversationPrompt({
		messages: [user("first user"), assistant("first reply"), user("second user")],
	} as Context as never);
	assert.ok(out.includes("[Prior conversation context]"), "expect prior-context section");
	assert.ok(out.includes("[Current message]"), "expect current-message section");
	assert.ok(out.includes("Do not"), "expect non-continuation instruction");
	assert.ok(out.endsWith("second user"), "current message must be at the tail");
});

check("4. NEVER emits literal 'User: ' or 'Assistant: ' transcript lines", () => {
	const out = buildConversationPrompt({
		messages: [user("hi"), assistant("hello there"), user("how are you")],
	} as Context as never);
	// The leak-priming pattern that issue #20 follow-up traced. JSON keys
	// `"role": "user"` are fine (data, not transcript); literal lines starting
	// with `User:` or `Assistant:` followed by free text are not.
	assert.ok(!/(^|\n)User:\s/.test(out), `must not contain "User: " transcript line. out=${JSON.stringify(out)}`);
	assert.ok(!/(^|\n)Assistant:\s/.test(out), `must not contain "Assistant: " transcript line`);
});

check("5. toolResult turns are skipped in prior-turn serialization", () => {
	const out = buildConversationPrompt({
		messages: [user("hi"), assistant("reply"), toolResult("tool output"), user("now")],
	} as Context as never);
	assert.ok(!out.includes("tool output"), "toolResult content must not leak into prompt");
});

check("6. empty-text turns are skipped", () => {
	const out = buildConversationPrompt({
		messages: [user("hi"), assistant(""), user("now")],
	} as Context as never);
	const parsed = extractPriorTurnsJson(out);
	assert.equal(parsed.length, 1, "empty assistant turn must be skipped");
	assert.equal(parsed[0].role, "user");
	assert.equal(parsed[0].content, "hi");
});

check("7. prior-turn JSON survives round-trip through JSON.parse", () => {
	const out = buildConversationPrompt({
		messages: [user('with "quotes" and\nnewlines'), assistant("backslash \\ and emoji 🦊"), user("now")],
	} as Context as never);
	const parsed = extractPriorTurnsJson(out);
	assert.equal(parsed.length, 2);
	assert.equal(parsed[0].content, 'with "quotes" and\nnewlines');
	assert.equal(parsed[1].content, "backslash \\ and emoji 🦊");
});

check("8. instruction is scoped to context echo, NOT a blanket 'no JSON in reply'", () => {
	const out = buildConversationPrompt({
		messages: [user("hi"), assistant("there"), user("now")],
	} as Context as never);
	assert.ok(/do not fabricate/i.test(out), "non-continuation instruction must be present");
	assert.ok(/do not echo or continue the context json/i.test(out), "scoped instruction must be present");
	assert.ok(
		!/do not emit json in your reply/i.test(out),
		"must NOT carry a blanket 'no JSON' instruction — that breaks legitimate 'respond in JSON' requests",
	);
});

function extractPriorTurnsJson(prompt: string): Array<{ role: string; content: string }> {
	const marker = "[Prior conversation context]";
	const start = prompt.indexOf(marker);
	if (start < 0) return [];
	const afterMarker = prompt.slice(start + marker.length);
	const arrayStart = afterMarker.indexOf("[");
	if (arrayStart < 0) return [];
	// Find matching closing bracket at depth zero.
	let depth = 0;
	let end = -1;
	for (let i = arrayStart; i < afterMarker.length; i++) {
		const ch = afterMarker[i];
		if (ch === "[") depth += 1;
		else if (ch === "]") {
			depth -= 1;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}
	if (end < 0) return [];
	return JSON.parse(afterMarker.slice(arrayStart, end + 1));
}

// ─── stripChatCompletionTail invariants ───────────────────────────────────

check("9. unchanged when no trailing pattern", () => {
	assert.equal(stripChatCompletionTail("hello"), "hello");
	assert.equal(stripChatCompletionTail("hello world"), "hello world");
});

check("10. strips trailing `User:` line ONLY with blank-line boundary", () => {
	assert.equal(stripChatCompletionTail("hello\n\nUser: 어 그래 ㅎㅎ"), "hello");
	// Single newline before `User:` is NOT a fabricated next-turn pattern —
	// preserve so a legitimate quoted line ("Last entry:\nUser: anonymous")
	// is not chopped.
	assert.equal(stripChatCompletionTail("hello\nUser: brief"), "hello\nUser: brief");
});

check("11. strips trailing `Human:` line with blank-line boundary", () => {
	assert.equal(stripChatCompletionTail("hello\n\nHuman: next"), "hello");
	assert.equal(stripChatCompletionTail("hello\nHuman: brief"), "hello\nHuman: brief");
});

check("12. strips trailing `Assistant:` line with blank-line boundary", () => {
	assert.equal(stripChatCompletionTail("hello\n\nAssistant: I'll continue"), "hello");
	assert.equal(stripChatCompletionTail("hello\nAssistant: brief"), "hello\nAssistant: brief");
});

check("13. strips trailing `</environment_details>` (allowlist) — case-insensitive", () => {
	assert.equal(stripChatCompletionTail("hello\n</environment_details>"), "hello");
	assert.equal(stripChatCompletionTail("hello\n</ENVIRONMENT_DETAILS>"), "hello");
});

check("14. does NOT strip arbitrary closing tags — preserves legitimate XML/HTML", () => {
	// Generic `</tag>` is no longer in the allowlist. A user asking about XML
	// or pasting code with a trailing closing tag must NOT have it chopped.
	assert.equal(stripChatCompletionTail("Here is XML:\n\n</root>"), "Here is XML:\n\n</root>");
	assert.equal(stripChatCompletionTail("hello\n</some_xml_tag>"), "hello\n</some_xml_tag>");
	assert.equal(stripChatCompletionTail("hello\n</a1_b2>"), "hello\n</a1_b2>");
});

check("15. strips both trailing User: and `</environment_details>` (combined leak)", () => {
	const input = "안녕하세요!\n\nUser: 어 그래 ㅎㅎ\n</environment_details>";
	// Tail strip is sequential: first the </environment_details>, then the
	// `\n\nUser:` line. The combined-leak shape oracle bbot observed.
	assert.equal(stripChatCompletionTail(input), "안녕하세요!");
});

check("16. caps fabricated-line length so long quoted lines are not chopped", () => {
	const longTail = "x".repeat(200);
	const input = `hello\n\nUser: ${longTail}`;
	// Over the 160-char cap → not stripped (likely legitimate quoted block).
	assert.equal(stripChatCompletionTail(input), input);
});

check("17. preserves inline 'User: ' mid-text (does not strip without trailing position)", () => {
	const input = "The User: prefix appears inline in this sentence.";
	assert.equal(stripChatCompletionTail(input), input);
});

check("18. handles empty / non-string input gracefully", () => {
	assert.equal(stripChatCompletionTail(""), "");
	assert.equal(stripChatCompletionTail(null as unknown as string), null);
	assert.equal(stripChatCompletionTail(undefined as unknown as string), undefined);
});

// ─── sanitizeFinalAssistantMessage invariants ─────────────────────────────

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

const SANITIZE_MODEL: StubModelRow = {
	id: "claude-sonnet-4-6",
	name: "test",
	api: "pi-shell-acp",
	provider: "pi-shell-acp",
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200000,
	maxTokens: 8192,
	reasoning: false,
};

function buildAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "pi-shell-acp",
		provider: "pi-shell-acp",
		model: SANITIZE_MODEL.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

function extractMsgText(msg: AssistantMessage): string {
	return msg.content
		.filter((b) => b.type === "text" && typeof b.text === "string")
		.map((b) => b.text as string)
		.join("\n");
}

check("19. sanitize preserves non-leak content unchanged", () => {
	const msg = buildAssistantMessage("normal reply");
	const out = sanitizeFinalAssistantMessage(msg as never, SANITIZE_MODEL as never);
	assert.equal(extractMsgText(out as unknown as AssistantMessage), "normal reply");
});

check("20. sanitize strips combined leak tail but keeps real reply", () => {
	const msg = buildAssistantMessage("real reply\n\nUser: fake\n</environment_details>");
	const out = sanitizeFinalAssistantMessage(msg as never, SANITIZE_MODEL as never);
	assert.equal(extractMsgText(out as unknown as AssistantMessage), "real reply");
});

check("21. sanitize falls back to placeholder when result would be empty (issue #20 invariant)", () => {
	// The whole content is the leak shape — stripping leaves an empty body.
	// sanitizeFinalAssistantMessage MUST substitute the placeholder so OpenClaw
	// never receives an empty assistant body and surfaces its raw-prompt fallback.
	const msg = buildAssistantMessage("\n</environment_details>");
	const out = sanitizeFinalAssistantMessage(msg as never, SANITIZE_MODEL as never);
	const text = extractMsgText(out as unknown as AssistantMessage);
	assert.ok(text.trim().length > 0, "sanitized empty result must NOT propagate empty body");
	assert.equal(text, EMPTY_FINAL_PLACEHOLDER_TEXT, "expected placeholder text");
});

check("22. sanitize falls back to placeholder when all content is the User: leak shape", () => {
	const msg = buildAssistantMessage("\n\nUser: only this fabricated line");
	const out = sanitizeFinalAssistantMessage(msg as never, SANITIZE_MODEL as never);
	const text = extractMsgText(out as unknown as AssistantMessage);
	assert.ok(text.trim().length > 0, "sanitized empty result must NOT propagate empty body");
	assert.equal(text, EMPTY_FINAL_PLACEHOLDER_TEXT);
});

// ─── Report ───────────────────────────────────────────────────────────────

if (fail.length > 0) {
	for (const m of fail) console.error(`[check-plugin-prompt-format] FAIL: ${m}`);
	console.error(`[check-plugin-prompt-format] ${fail.length} failure(s), ${pass} pass`);
	process.exit(1);
}

console.log(
	`[check-plugin-prompt-format] ${pass} assertions ok (8 prompt-format + 10 sanitizer + 4 empty-final invariant)`,
);
