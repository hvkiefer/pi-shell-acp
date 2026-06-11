/**
 * entwurf-v2-contract — the FROZEN contract surface for the unified `entwurf_v2`
 * verb (0.11 Stage 0 step 4-pre / 동결결정 10). PURE: TypeBox schemas + the
 * intent×liveness decision table + the reject taxonomy + a pure resolver.
 * NO runtime dispatch, NO spawn/send, NO I/O — step 5 wires this to transports.
 *
 * Why a frozen contract BEFORE the fact-provider (step 4): with the legacy
 * 3-verb surface (`entwurf`/`entwurf_resume`/`entwurf_send`) still live, building
 * discovery first bakes verb-routing into the fact layer and `entwurf_peers`
 * goes wrong (동결결정 10 순서 근거). So the SHAPE is locked here; the facts read
 * it; dispatch computes from facts at call time (step 5). The legacy 3-verb
 * surface is untouched — this is purely additive (동결결정 10 scope A).
 *
 * Source-verified invariants folded in (Opus 실측 + GPT 보정 + Fable R1-R5, 2026-06-11):
 *  - F1: caller intent is DECLARED in the input, so the contract a caller
 *    receives is deterministic — never computed from liveness at call time.
 *    `owned-outcome` (caller owns completion) ≠ `fire-and-forget` (ack only).
 *  - R1: the liveness predicate is defined PER-BACKEND. Only pi (direct-inject,
 *    control-socket) has one initially; claude-code is self-fetch with no socket,
 *    so its liveness is `unsupported`, NOT folded into dead/indeterminate — that
 *    fold is the identity-split trap. `unsupported` is a 4th FACT value, not a
 *    4th dispatch column: an out-of-domain backend rejects before the table.
 *  - R2: `target` is the garden-id of an EXISTING citizen. spawn-new is out of
 *    v2 scope (legacy `entwurf` keeps it; additive later). Absent/typo gid =
 *    `bad-target` (so F6 "오타 gid가 신규 spawn 사고 막기" holds automatically).
 *  - N1/F3: an `indeterminate` target never spawns. N2: `fire-and-forget` to a
 *    `dormant` target is "reject for now" (mailbox-wake lacks a reply-correlation
 *    id in the substrate; an additive extension later, not a permanent no).
 *  - Q2: every cell is a SINGLE verdict — no "default", no escape hatch (a
 *    "default reject" would re-admit the call-time nondeterminism F1 closes).
 *
 * The decision table here is a constant; `check-entwurf-v2-contract` asserts it
 * exhaustively + proves the "table cell ↔ receipt" round-trip. THAT round-trip
 * is the machine proof of F6 "결정표가 코드로 강제됨" — the executable contract,
 * not prose.
 */

import { StringEnum, Type } from "@earendil-works/pi-ai";
import { SESSION_ID_RE } from "./session-id.js";
import type { SocketLiveness } from "./socket-probe.ts";

// ── Caller-declared intent (F1) ────────────────────────────────────────────
// The outcome contract is an INPUT, not an inference. `fire-and-forget` = the
// RPC ack is the end of the contract (entwurf-control.ts:29-37). `owned-outcome`
// = the caller owns the dispatched session's completion.
export const ENTWURF_INTENTS = ["fire-and-forget", "owned-outcome"] as const;
export type EntwurfIntent = (typeof ENTWURF_INTENTS)[number];

// ── Liveness axes ──────────────────────────────────────────────────────────
// FactLiveness (R1/R3b) = what `entwurf_peers` exposes: the 3 socket-probe
// values PLUS `unsupported` (predicate undefined for this backend). Four values.
export const FACT_LIVENESSES = ["alive", "dead", "indeterminate", "unsupported"] as const;
export type FactLiveness = SocketLiveness | "unsupported";

// DispatchLiveness = the in-domain routing axis the table is keyed on. The
// socket result maps: alive→live (send), dead→dormant (resume from disk),
// indeterminate→indeterminate (never spawn). `unsupported` is NOT here — it is
// handled by the domain guard before the table is consulted.
export const DISPATCH_LIVENESSES = ["live", "dormant", "indeterminate"] as const;
export type DispatchLiveness = (typeof DISPATCH_LIVENESSES)[number];

// ── Backend liveness domain (R1 + F4) ──────────────────────────────────────
// Backends whose liveness predicate is DEFINED. Initial = pi only (control-socket
// connect + RPC `get_info`, entwurf-control.ts). claude-code (self-fetch, no
// socket) and codex/antigravity (direct-inject without a probe surface yet) are
// OUT of domain → `unsupported`. Widening this set is a deliberate future
// decision (Stage 1+), gated by a REAL liveness predicate for that backend —
// never by silently mapping its sessions to dead/indeterminate (R1 핵심).
export const LIVENESS_DOMAIN_BACKENDS = ["pi"] as const;
export type LivenessDomainBackend = (typeof LIVENESS_DOMAIN_BACKENDS)[number];

export function isLivenessSupported(backend: string): boolean {
	return (LIVENESS_DOMAIN_BACKENDS as readonly string[]).includes(backend);
}

/**
 * Compose the 4-value FACT liveness from a backend and its socket probe.
 * Out-of-domain backend → `unsupported` (NOT dead/indeterminate, R1). An
 * in-domain backend with no probe result yet → `indeterminate` (no proof → the
 * table will refuse to spawn; we never coerce absence of proof into `dead`).
 */
export function factLivenessOf(backend: string, socket: SocketLiveness | null): FactLiveness {
	if (!isLivenessSupported(backend)) return "unsupported";
	return socket ?? "indeterminate";
}

/** Map an in-domain socket-probe result to the table's routing axis. */
export function dispatchLivenessOf(socket: SocketLiveness): DispatchLiveness {
	return socket === "alive" ? "live" : socket === "dead" ? "dormant" : "indeterminate";
}

// ── Reject taxonomy (R5) ───────────────────────────────────────────────────
// SCOPE: these are PRE-DISPATCH reject reasons — decided before any transport is
// attempted. A post-dispatch "send-fail fallback" (transport failed after the
// verdict) is a SEPARATE axis (bucket B) and must NOT be merged into this enum.
export const ENTWURF_V2_REJECT_REASONS = [
	"indeterminate-no-spawn", // N1/F3: never spawn an indeterminate target
	"dormant-fire-forget-unsupported", // N2: fire-and-forget to a dormant target — reject for now
	"owned-live-no-autosend", // Q2/F1: owned-outcome to a live target is not an auto-send
	"backend-liveness-unsupported", // R1: backend has no liveness predicate (e.g. claude-code)
	"bad-target", // R2: absent/typo garden-id (no existing citizen); spawn-new out of v2 scope
	"untrusted-fail-fast", // 동결결정 5: controlled launch into an untrusted cwd
	"target-locked", // R5 pre-claim for bucket B F2 per-gid lockfile conflict
] as const;
export type EntwurfV2RejectReason = (typeof ENTWURF_V2_REJECT_REASONS)[number];

// Reasons the (intent × liveness) table itself can emit. The remaining taxonomy
// members (bad-target, untrusted-fail-fast, target-locked) are produced by the
// EARLIER stages (target resolution / preflight / lockfile) that run before the
// resolver — pre-claimed in the enum so bucket B does not reopen it.
export const TABLE_REJECT_REASONS = [
	"indeterminate-no-spawn",
	"dormant-fire-forget-unsupported",
	"owned-live-no-autosend",
	"backend-liveness-unsupported",
] as const satisfies readonly EntwurfV2RejectReason[];

// ── Transport + verdict ────────────────────────────────────────────────────
export const ENTWURF_V2_TRANSPORTS = ["control-socket", "spawn-bg", "tmux-live"] as const;
export type EntwurfV2Transport = (typeof ENTWURF_V2_TRANSPORTS)[number];

// Allow-branch facets (exported so the schema↔types gate asserts every enum).
export const ENTWURF_V2_ACTIONS = ["send", "resume"] as const;
export const ENTWURF_V2_OWNERSHIPS = ["ack-only", "owned"] as const;
// Delivery mode of the message to the target (how it is injected) — steer =
// interrupt the current turn, follow_up = queue after it. A SEPARATE axis from
// both the intent/ownership axis (F1) and the liveness-routing axis; the legacy
// entwurf_send carries the same steer|follow_up surface.
export const ENTWURF_V2_MODES = ["steer", "follow_up"] as const;

export type DispatchVerdict =
	| { action: "send"; transport: "control-socket"; ownership: "ack-only" }
	| { action: "resume"; transport: "spawn-bg" | "tmux-live"; ownership: "owned" }
	| { action: "reject"; reason: EntwurfV2RejectReason };

// ── The FROZEN decision table ──────────────────────────────────────────────
// intent × dispatch-liveness → exactly one verdict (Q2). v2-initial ALLOWS
// exactly two cells (fire-and-forget+live = send; owned-outcome+dormant =
// resume); the other four reject. The reject cells are honest "지금은 없음"
// locks (N2) — the legacy 3-verb surface still covers those flows unchanged.
export const DISPATCH_TABLE: Record<EntwurfIntent, Record<DispatchLiveness, DispatchVerdict>> = {
	"fire-and-forget": {
		live: { action: "send", transport: "control-socket", ownership: "ack-only" },
		dormant: { action: "reject", reason: "dormant-fire-forget-unsupported" },
		indeterminate: { action: "reject", reason: "indeterminate-no-spawn" },
	},
	"owned-outcome": {
		// wants_reply is etiquette, not ownership — owned+live never auto-sends (Q2/F1).
		live: { action: "reject", reason: "owned-live-no-autosend" },
		dormant: { action: "resume", transport: "spawn-bg", ownership: "owned" },
		indeterminate: { action: "reject", reason: "indeterminate-no-spawn" },
	},
};

// ── Dispatch receipt (R3) ──────────────────────────────────────────────────
// Carries `observedLiveness` + the transport/action so `check-entwurf-v2-contract`
// can assert a "table cell ↔ receipt" round-trip — the machine proof of F6.
export type EntwurfV2Receipt =
	| {
			ok: true;
			action: "send" | "resume";
			transport: EntwurfV2Transport;
			ownership: "ack-only" | "owned";
			observedLiveness: FactLiveness;
	  }
	| { ok: false; reason: EntwurfV2RejectReason; observedLiveness: FactLiveness };

/**
 * PURE dispatch decision over already-resolved facts. The caller resolves the
 * target (→ `bad-target` if no existing citizen), runs preflight (→
 * `untrusted-fail-fast`), and acquires the per-gid lock (→ `target-locked`)
 * BEFORE reaching here; this function only decides the liveness-routed verdict.
 * R1 domain guard runs first: an `unsupported` liveness rejects before the table.
 * No spawn, no send, no I/O — step 5 executes the chosen transport.
 */
export function resolveDispatch(intent: EntwurfIntent, liveness: FactLiveness): EntwurfV2Receipt {
	if (liveness === "unsupported") {
		return { ok: false, reason: "backend-liveness-unsupported", observedLiveness: liveness };
	}
	// liveness is now narrowed to SocketLiveness.
	const cell = DISPATCH_TABLE[intent][dispatchLivenessOf(liveness)];
	if (cell.action === "reject") {
		return { ok: false, reason: cell.reason, observedLiveness: liveness };
	}
	return {
		ok: true,
		action: cell.action,
		transport: cell.transport,
		ownership: cell.ownership,
		observedLiveness: liveness,
	};
}

// ── TypeBox schemas (for step 5 MCP tool params + the gate's structural assert) ──
// StringEnum (typebox 1.x) inside Type.Object (typebox 0.34) — same mix the
// existing entwurf tools use (entwurf-control.ts:92-95). The logic types above
// are hand-written unions, NOT `Static<>` inferences, so the 0.34/1.x widening
// caveat does not touch them; the gate keeps schema ↔ types in lockstep.
export const EntwurfV2InputSchema = Type.Object({
	// R2/F6 executable: the garden-id shape is enforced by pattern, not prose —
	// a malformed/typo gid fails the schema (→ bad-target) and can never reach a
	// spawn. SSOT regex = SESSION_ID_RE (pi-extensions/lib/session-id.js).
	target: Type.String({
		pattern: SESSION_ID_RE.source,
		description:
			"garden-id of an EXISTING citizen (pattern-enforced). spawn-new is out of v2 scope (legacy entwurf keeps it); a malformed/typo gid is bad-target.",
	}),
	intent: StringEnum(ENTWURF_INTENTS, {
		description:
			"caller's declared outcome contract (F1): fire-and-forget = ack only, owned-outcome = caller owns completion.",
	}),
	mode: Type.Optional(
		StringEnum(ENTWURF_V2_MODES, {
			description:
				"delivery mode (steer = interrupt current turn, follow_up = queue) — NOT the ownership axis (F1) nor liveness routing.",
		}),
	),
	wantsReply: Type.Optional(
		Type.Boolean({
			description: "conversation etiquette only — NOT ownership; never triggers an auto-send (Q2).",
		}),
	),
});

// Receipt = a DISCRIMINATED union on `ok` (R3/F6) — NOT one flat object with
// optionals. A flat-optional object would admit an illegal receipt like
// {ok:true, reason:...}; the union makes the success and reject shapes mutually
// exclusive at the schema level (success carries action/transport/ownership and
// NO reason; reject carries reason and NONE of the allow facets).
export const EntwurfV2ReceiptSuccessSchema = Type.Object({
	ok: Type.Literal(true),
	action: StringEnum(ENTWURF_V2_ACTIONS),
	transport: StringEnum(ENTWURF_V2_TRANSPORTS),
	ownership: StringEnum(ENTWURF_V2_OWNERSHIPS),
	observedLiveness: StringEnum(FACT_LIVENESSES, {
		description: "the 4-value fact liveness the verdict was computed from (R1/R3).",
	}),
});

export const EntwurfV2ReceiptRejectSchema = Type.Object({
	ok: Type.Literal(false),
	reason: StringEnum(ENTWURF_V2_REJECT_REASONS),
	observedLiveness: StringEnum(FACT_LIVENESSES, {
		description: "the 4-value fact liveness the reject was computed from (R1/R3).",
	}),
});

export const EntwurfV2ReceiptSchema = Type.Union([EntwurfV2ReceiptSuccessSchema, EntwurfV2ReceiptRejectSchema]);
