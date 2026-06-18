// ACP plugin — pi Context → ACP prompt conversion (S2c).
//
// S2c is spawn-per-turn: every streamSimple call spawns a fresh ACP session, so
// the backend has NO memory of prior turns. Sending only the last user message
// would silently drop multi-turn history — that is context loss, not a thin
// substrate. So this flattens the whole pi conversation into ONE text transcript
// and sends it as a single ACP user prompt block.
//
// S2c/S2d boundary (GPT S2c Q2): this is CONVERSATION TRANSCRIPT PASSTHROUGH, not
// rich-carrier identity injection. Deliberately EXCLUDED here (all S2d):
//   - `context.systemPrompt` — never read into the prompt or `_meta.systemPrompt`
//     (the billing carrier stays absent — NEXT §S2-scout 핀1);
//   - `~/AGENTS.md` / cwd AGENTS / bridge identity narrative;
//   - first-user-message augment + project-context de-dup;
//   - `context.tools` — the ACP child tool surface is the S2b
//     `_meta.claudeCode.options` SSOT, never re-sent here.
// Structured tool replay is also excluded: tool calls/results render as plain
// transcript text, never as ACP tool invocations (the child runs its own tools).

import type { AssistantMessage, Context, Message, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";

/** An ACP text content block. */
export interface AcpTextBlock {
	type: "text";
	text: string;
}

function textFromUserOrToolContent(content: UserMessage["content"] | ToolResultMessage["content"]): string {
	if (typeof content === "string") return content;
	// Render text verbatim; images are NOT dropped silently — they leave a text
	// marker so the transcript honestly records an attachment the text-only S2c
	// transcript cannot carry (real ACP image passthrough is a later lane).
	return content
		.map((c) => {
			if (c.type === "text") return c.text;
			if (c.type === "image") return `[image omitted: ${c.mimeType ?? "unknown"}]`;
			return "";
		})
		.filter((s) => s !== "")
		.join("\n");
}

function textFromAssistantContent(content: AssistantMessage["content"]): string {
	// Assistant text only — thinking is omitted and tool calls are not replayed
	// (the ACP child executes its own tools; replaying structured calls would be
	// a lie). Tool RESULTS still appear via their own toolResult message below.
	return content
		.filter((c): c is { type: "text"; text: string; textSignature?: string } => c.type === "text")
		.map((c) => c.text)
		.join("");
}

/** Render one pi message as a transcript line, or undefined to skip it. */
function renderMessage(message: Message): string | undefined {
	switch (message.role) {
		case "user": {
			const text = textFromUserOrToolContent(message.content).trim();
			return text ? `User: ${text}` : undefined;
		}
		case "assistant": {
			const text = textFromAssistantContent(message.content).trim();
			return text ? `Assistant: ${text}` : undefined;
		}
		case "toolResult": {
			const text = textFromUserOrToolContent(message.content).trim();
			const tag = message.isError ? "Tool error" : "Tool result";
			return text ? `${tag} (${message.toolName}): ${text}` : undefined;
		}
		default:
			return undefined;
	}
}

/**
 * Flatten a pi Context into a single transcript string. Excludes
 * `context.systemPrompt` and `context.tools` by construction.
 */
export function contextTranscript(context: Context): string {
	const lines: string[] = [];
	for (const message of context.messages) {
		const line = renderMessage(message);
		if (line) lines.push(line);
	}
	return lines.join("\n\n");
}

/**
 * Convert a pi Context into the ACP `prompt` array (a single text block holding
 * the flattened transcript). Empty history yields an empty array — the caller
 * decides whether that is a hard error.
 */
export function contextToAcpPrompt(context: Context): AcpTextBlock[] {
	const transcript = contextTranscript(context);
	if (!transcript) return [];
	return [{ type: "text", text: transcript }];
}
