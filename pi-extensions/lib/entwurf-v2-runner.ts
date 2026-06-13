/**
 * entwurf-v2-runner — the 5d-1 pure EXECUTE-router for the unified `entwurf_v2` verb.
 * It takes a `DispatchDecision` the 5b decider ALREADY produced and routes it to the
 * right 5c transport hand, returning ONE outcome-rich `EntwurfV2RunResult`. It performs
 * ZERO IO of its own and makes ZERO routing decisions — `decideDispatch` chose the plan,
 * this only DISPATCHES it. Each hand is an injected dep (the gate fakes them; 5d-2 wires
 * the production `executeControlSocketSend` / `executeSpawnBgResume` / production
 * `sendViaMailbox`), so the routing + result mapping is gate-provable without a socket,
 * spawn, or timer — the same pure-before-IO, IO-via-dep discipline 5b/5c kept.
 *
 * Why a result type richer than the receipt: the carry-over contracts from 5c demand it.
 *   - N3 (5c-2b): a dead-path re-resolve `rejected` carries the resolver's `rejectReason`
 *     (dormant-fire-forget-unsupported / mailbox-undeliverable / …). The runner carries it
 *     verbatim so the surface distinguishes "in-band refusal" from "no live route".
 *   - N1 (5c-2a): a non-`failed` outcome whose `releaseLock` then threw is a
 *     `SendDeliveredReleaseFailedError` — the delivery HAPPENED, the lock is dirty, a
 *     re-send would double-deliver. The runner surfaces this as `execution-failed` with
 *     `finalizedOutcome` + `releaseFailed` so the surface renders "delivered, lock dirty,
 *     do NOT retry", never "send failed".
 *   - spawn-bg `lock-retained` is a RETURNED result (fail-closed, not a throw): it rides
 *     the `executed` branch so 5d's surface can render the retained-lock diagnostic.
 *
 * `retrySafe` is conservatively `false` on EVERY `execution-failed`: a thrown send is
 * never confidently retry-safe (an `indeterminate` connect may have delivered to an
 * alive-but-stalled socket — the exact double-delivery hazard 5c-2a refuses to gamble on).
 * The runner never re-judges the lock — it passes `decision.lock` to the hand verbatim and
 * lets the hand's `decideReleasePolicy` fail loud on a mis-pairing.
 */

import type {
	DispatchDecision,
	ExecutionPlan,
	RejectDiagnostic,
	RejectReceipt,
	SuccessReceipt,
} from "./entwurf-v2-decider.ts";
import type { LockClaim } from "./entwurf-v2-lock.ts";
import {
	type ControlSocketPlan,
	type ControlSocketSendResult,
	type MetaMailboxPlan,
	type RpcSendResult,
	SendDeliveredReleaseFailedError,
	type SendFinalOutcome,
} from "./entwurf-v2-send.ts";
import type { SpawnBgPlan, SpawnBgResumeResult } from "./entwurf-v2-spawn.ts";

/**
 * The three transport hands, each PRE-BOUND with its own deps (production or fake). Lock
 * is typed `LockClaim | null` to mirror the real hands EXACTLY — the runner passes
 * `decision.lock` straight through and the hand fails loud on a null/mis-paired lock
 * (control-socket / spawn-bg get a non-null claim; meta-mailbox gets null — ？7).
 */
export interface DispatchExecutorDeps {
	sendControl: (plan: ControlSocketPlan, lock: LockClaim | null) => Promise<ControlSocketSendResult>;
	resumeSpawnBg: (plan: SpawnBgPlan, lock: LockClaim | null) => Promise<SpawnBgResumeResult>;
	sendMailbox: (plan: MetaMailboxPlan, lock: LockClaim | null) => Promise<RpcSendResult>;
}

/** The per-transport success outcome, discriminated by transport so the surface renders
 * each without guessing. `control-socket` carries the optional N3 `rejectReason`;
 * `spawn-bg` carries the whole `SpawnBgResumeResult` (incl. the `lock-retained`
 * fail-closed diagnostic); `meta-mailbox` is always `success:true` (enqueue has no
 * in-band refuse — a failure is a throw, handled as `execution-failed`). */
export type ExecutedOutcome =
	| { transport: "control-socket"; outcome: SendFinalOutcome; rejectReason?: string }
	| { transport: "spawn-bg"; result: SpawnBgResumeResult }
	| { transport: "meta-mailbox"; success: true };

/** The single outcome-rich result the 5d surface renders. `rejected` = the decider
 * refused (no execution). `executed` = a hand ran to a terminal result. `execution-failed`
 * = a hand THREW (the lock-leak backstop / a transport failure / the N1 delivered+release
 * failed error) — `finalizedOutcome`+`releaseFailed` mark the N1 "delivered, do not retry"
 * case; `retrySafe` is always false (see module header). */
export type EntwurfV2RunResult =
	| { kind: "rejected"; receipt: RejectReceipt; diagnostic?: RejectDiagnostic }
	| { kind: "executed"; receipt: SuccessReceipt; transport: ExecutionPlan["transport"]; outcome: ExecutedOutcome }
	| {
			kind: "execution-failed";
			receipt: SuccessReceipt;
			transport: ExecutionPlan["transport"];
			error: string;
			/** Present ONLY for the N1 case: the delivery/refusal reached a terminal outcome
			 * but `releaseLock` then threw (lock dirty). A re-send would double-deliver. */
			finalizedOutcome?: Exclude<SendFinalOutcome, "failed">;
			releaseFailed?: true;
			retrySafe: false;
	  };

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Route an already-decided `DispatchDecision` to its transport hand. The decider owns the
 * routing; this owns ONLY the dispatch + the outcome→result mapping (incl. the N1/N3
 * carry-overs). A `reject` runs no hand. An `execute` switches on `plan.transport`.
 */
export async function executeDispatch(
	decision: DispatchDecision,
	deps: DispatchExecutorDeps,
): Promise<EntwurfV2RunResult> {
	if (decision.kind === "reject") {
		return { kind: "rejected", receipt: decision.receipt, diagnostic: decision.diagnostic };
	}

	const { receipt, plan, lock } = decision;
	const transport = plan.transport;

	switch (plan.transport) {
		case "control-socket": {
			try {
				const r = await deps.sendControl(plan, lock);
				return {
					kind: "executed",
					receipt,
					transport,
					outcome: { transport: "control-socket", outcome: r.outcome, rejectReason: r.rejectReason },
				};
			} catch (err) {
				// N1: a delivered/refused send whose release then threw — lock dirty, do NOT retry.
				if (err instanceof SendDeliveredReleaseFailedError) {
					return {
						kind: "execution-failed",
						receipt,
						transport,
						error: errorMessage(err),
						finalizedOutcome: err.finalizedOutcome,
						releaseFailed: true,
						retrySafe: false,
					};
				}
				// A `failed` send rethrows its original transport error (lock already released).
				return { kind: "execution-failed", receipt, transport, error: errorMessage(err), retrySafe: false };
			}
		}
		case "spawn-bg": {
			try {
				// `lock-retained` is a RETURNED result (fail-closed), not a throw — it rides `executed`.
				const result = await deps.resumeSpawnBg(plan, lock);
				return { kind: "executed", receipt, transport, outcome: { transport: "spawn-bg", result } };
			} catch (err) {
				return { kind: "execution-failed", receipt, transport, error: errorMessage(err), retrySafe: false };
			}
		}
		case "meta-mailbox": {
			try {
				// lock is null here (？7) — passed verbatim; the production adapter ignores it.
				const r = await deps.sendMailbox(plan, lock);
				// 5c-4 contract: a mailbox enqueue is `{success:true}` OR a throw — there is NO
				// in-band reject (no live receiver to refuse). A `success:false` is therefore a
				// CONTRACT VIOLATION, not a soft failure: fail loud rather than silently render it
				// as a success ("Never warn. Throw."). The catch below folds it to execution-failed.
				if (r.success !== true) {
					throw new Error(
						"entwurf-v2-runner: meta-mailbox send returned success:false (contract violation; a mailbox has no in-band reject).",
					);
				}
				return { kind: "executed", receipt, transport, outcome: { transport: "meta-mailbox", success: true } };
			} catch (err) {
				return { kind: "execution-failed", receipt, transport, error: errorMessage(err), retrySafe: false };
			}
		}
	}
}
