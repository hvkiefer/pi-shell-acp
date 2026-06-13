/**
 * entwurf-v2-spawn — the 5c-3a spawn-bg RESUME watcher hand (0.11 Stage 0 step 5c-3a).
 * It WIRES the real spawn + socket-observe IO onto the pure release reducer (5c-1):
 * launch the resume child, watch for the FIRST observable liveness transition, feed
 * that observation to `reduceRelease`, and release the held lock EXACTLY ONCE — or, if
 * NO observation can be obtained, RETAIN the lock and surface the evidence rather than
 * release blind. Every IO seam is an injected dep (the gate fakes it with controlled
 * promises), so the spawn→observe→release ORDERING is gate-provable without a real
 * child, socket, or timer — the same "pure-before-IO, IO-via-dep" discipline 5b/5c-2
 * used.
 *
 * The load-bearing contract (Fable 3, the whole reason 5c is sliced pure-before-IO):
 *   TIMEOUT IS NOT A RELEASE EVENT. A spawn-bg dispatch holds its per-gid lock until an
 *   OBSERVED transition — `socket-alive` (the resumed child stood its control socket up)
 *   or `child-exited` (any code, incl. null = killed by signal). A bare `observeTimeoutMs`
 *   expiry proves NOTHING (the child may stand its socket up a moment later), so releasing
 *   on it would reopen the exact double-spawn window 5a's lock exists to close. Instead the
 *   timeout RESOLVES BY OBSERVATION: kill the child, then wait a BOUNDED `killGraceMs` for
 *   the kill to produce a real `child-exited` (or a racing `socket-alive`). Only THAT
 *   observation releases. If even the grace elapses with no observation, the hand does NOT
 *   release — it returns a `lock-retained` diagnostic (released:false, with pid / socket /
 *   lockPath / timeouts) so an operator can SEE the long-held lock, exactly as F2-P2
 *   ("관측 가능해야 수용") demands. The function always returns BOUNDED — it never hangs.
 *
 * Post-spawn unexpected dep failure follows the SAME rule (GPT 5c-3a correction): once a
 * child exists, an observation-less release is forbidden. A watch/timer/kill dep that
 * throws is handled by best-effort kill → bounded attempt to OBSERVE the exit → release
 * if observed, else `lock-retained` fail-closed. There is NO direct-release escape hatch:
 * `deps.releaseLock` is reached ONLY through `reduceRelease` on a real observation event.
 *
 * Release authority is ALWAYS the LockClaim the decider handed over; the watcher reads
 * ONLY `plan.expectedSocketPath` and never re-derives a socket path or a lock by gid.
 */

import type { ExecutionPlan } from "./entwurf-v2-decider.ts";
import type { LockClaim } from "./entwurf-v2-lock.ts";
import {
	decideReleasePolicy,
	initialReleaseState,
	type ReleaseEvent,
	type ReleasePolicy,
	type ReleaseState,
	reduceRelease,
} from "./entwurf-v2-release.ts";

/** The spawn-bg plan shape, narrowed from the decider's ExecutionPlan union. */
export type SpawnBgPlan = Extract<ExecutionPlan, { transport: "spawn-bg" }>;

/** A started resume child. `pid` is diagnostic-only (surfaced on a retained lock); the
 * watcher tracks the child by this opaque handle, never by gid. */
export interface SpawnedChild {
	pid?: number;
}

/**
 * Every IO seam is a REQUIRED dep — the hand performs ZERO IO of its own so the gate can
 * drive every observation order without a real spawn/socket/timer.
 *   - spawnChild       — launch the resume child. Resolves a handle on a STARTED process;
 *     THROWS on a spawn-time failure (→ `spawn-start-failed`: no child to watch).
 *   - awaitSocketAlive — resolve when `expectedSocketPath` becomes observable (the child
 *     stood its control socket up). NEVER resolves if the socket never appears — the
 *     timeout path handles that. Honors the abort signal so a loser can be torn down.
 *   - awaitChildExit   — resolve with the child's exit code (null = killed by signal).
 *     Honors the abort signal.
 *   - awaitTimeout     — resolve after `ms` (the observe deadline, and again the kill
 *     grace). Honors the abort signal. NOTE: a timeout is NEVER fed to the reducer.
 *   - killChild        — terminate the started child. Used ONLY to escalate a timeout (or
 *     a post-spawn dep failure) into a real `child-exited`; it is never a release itself.
 *   - releaseLock      — release the held claim; reached ONLY via reduceRelease, at most
 *     once, only on a real observation event.
 *   - killGraceMs      — bounded wait, after a kill, for the resulting observation. Keeps
 *     the watcher from hanging on a zombie: if it elapses, the lock is RETAINED (surfaced),
 *     not released. A watcher-policy constant (NOT a routing decision — so it lives on the
 *     dep, not the decider's plan).
 */
export interface SpawnBgResumeDeps {
	spawnChild: (plan: SpawnBgPlan) => Promise<SpawnedChild>;
	awaitSocketAlive: (socketPath: string, signal: AbortSignal) => Promise<void>;
	awaitChildExit: (child: SpawnedChild, signal: AbortSignal) => Promise<number | null>;
	awaitTimeout: (ms: number, signal: AbortSignal) => Promise<void>;
	killChild: (child: SpawnedChild) => void;
	releaseLock: (lock: LockClaim) => void;
	killGraceMs: number;
}

/** Evidence carried on a `lock-retained` outcome so an operator can SEE (and clear) the
 * lock that no observation released. */
export interface SpawnRetainedDiagnostic {
	targetGardenId: string;
	pid?: number;
	expectedSocketPath: string;
	lockPath: string;
	observeTimeoutMs: number;
	killGraceMs: number;
}

/**
 * The terminal outcome of a spawn-bg resume watch. The three RELEASED outcomes each fed
 * exactly one observation event to the reducer; the `lock-retained` outcome fed NONE (it
 * is the observation-less fail-closed — `released:false`, lock left for the operator).
 *   - socket-alive       — the resumed child stood its socket up.
 *   - child-exited        — the child exited (any code; null = signal/kill).
 *   - spawn-start-failed  — the child never started (spawnChild threw); nothing to watch.
 *   - lock-retained       — no observation was obtainable (kill grace elapsed, or a
 *     post-spawn dep failed and the exit could not be observed). Lock NOT released.
 */
export type SpawnBgResumeResult =
	| { kind: "socket-alive"; released: true; pid?: number }
	| { kind: "child-exited"; released: true; exitCode: number | null; pid?: number }
	| { kind: "spawn-start-failed"; released: true; error: string }
	| {
			kind: "lock-retained";
			released: false;
			reason: "kill-unconfirmed" | "observe-failed";
			error?: string;
			diagnostic: SpawnRetainedDiagnostic;
	  };

// An internal tag for the observation race: which source settled first.
type Observation = { tag: "socket" } | { tag: "exit"; code: number | null } | { tag: "timeout" };

function tagSocket(p: Promise<void>): Promise<Observation> {
	return p.then(() => ({ tag: "socket" }) as const);
}
function tagExit(p: Promise<number | null>): Promise<Observation> {
	return p.then((code) => ({ tag: "exit", code }) as const);
}
function tagTimeout(p: Promise<void>): Promise<Observation> {
	return p.then(() => ({ tag: "timeout" }) as const);
}

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Swallow a watcher promise's eventual rejection when it is abandoned without a race
 * handler (the S1 sync-throw path tears down before the race attaches one), so an aborted
 * loser cannot surface as an unhandledRejection. A no-op when the promise never started. */
function defuse(p: Promise<unknown> | undefined): void {
	if (p) void p.catch(() => {});
}

/**
 * Launch a spawn-bg resume child and watch for the first observable liveness transition,
 * releasing the held lock EXACTLY ONCE on that observation — or RETAINING the lock (with
 * surfaced evidence) if no observation can be obtained. `lock` MUST be the in-domain claim
 * the decider handed over — `decideReleasePolicy` throws if it is null or paired with the
 * wrong gid (a mis-wire is fail-loud, not a runtime branch). Always returns bounded.
 *
 * A `releaseLock` throw on a RELEASED path propagates honestly (the observation already
 * happened, so the caller must NOT re-spawn; the lock is dirty and needs manual cleanup —
 * 5b masking direction). Such a throw is the ONE non-result exit; every other terminal
 * state is a returned `SpawnBgResumeResult`.
 */
export async function executeSpawnBgResume(
	plan: SpawnBgPlan,
	lock: LockClaim | null,
	deps: SpawnBgResumeDeps,
): Promise<SpawnBgResumeResult> {
	// Throws on a null / mis-paired lock (？7 + gid invariants). After this the spawn-bg
	// policy is release-after-spawn-observation and the lock is non-null.
	const policy: ReleasePolicy = decideReleasePolicy(plan, lock);
	const held = lock as LockClaim;

	let state: ReleaseState = initialReleaseState();
	// The ONLY path to deps.releaseLock: fold a real observation event through the reducer
	// and release iff (and exactly once) the reducer says so. No direct-release hatch.
	const fire = (event: ReleaseEvent): void => {
		const r = reduceRelease(policy, state, event);
		state = r.state;
		if (r.shouldRelease) deps.releaseLock(held);
	};

	// Spawn. A throw here means NO child exists → spawn-start-failed releases (nothing to
	// watch; keeping the lock would pin the gid forever). No child means no lock-leak risk.
	let child: SpawnedChild;
	try {
		child = await deps.spawnChild(plan);
	} catch (err) {
		fire({ kind: "spawn-start-failed", error: errMsg(err) });
		return { kind: "spawn-start-failed", released: true, error: errMsg(err) };
	}

	const controller = new AbortController();
	const { signal } = controller;
	// Created ONCE and reused across the primary race and the kill-grace race; in the
	// timeout branch both are still pending (timeout won), so re-racing them is safe.
	//
	// S1 (Fable 2차): the creation is in its OWN try because a watch dep can throw
	// SYNCHRONOUSLY (a buggy dep that throws where it must RETURN a Promise — the same grade
	// the send hand's case-13 backstop covers). The child already exists, so this is a
	// post-spawn failure and the SAME rule applies: an observation-less release is forbidden.
	// Best-effort kill, defuse any watcher that DID start (so its later rejection is not
	// unhandled), tear down, and fail-closed to a retained diagnostic. We do NOT try to
	// observe the exit — awaitChildExit may itself be the thrower; retained is the honest
	// floor. (The async-rejection path is handled later by the race catch → backstop.)
	let socketP!: Promise<Observation>;
	let exitP!: Promise<Observation>;
	try {
		socketP = tagSocket(deps.awaitSocketAlive(plan.expectedSocketPath, signal));
		exitP = tagExit(deps.awaitChildExit(child, signal));
	} catch (err) {
		try {
			deps.killChild(child);
		} catch {
			// best-effort
		}
		controller.abort();
		defuse(socketP);
		defuse(exitP);
		return retained(plan, child, "observe-failed", deps.killGraceMs, held.lockPath, errMsg(err));
	}

	try {
		// Primary observation race. `timeout` participates but is NEVER a release event.
		let first: Observation;
		try {
			const timeoutP = tagTimeout(deps.awaitTimeout(plan.observeTimeoutMs, signal));
			first = await Promise.race([socketP, exitP, timeoutP]);
		} catch (err) {
			// A watch/timer dep rejected BEFORE any observation → post-spawn backstop.
			return await backstop(plan, deps, child, held.lockPath, exitP, signal, fire, errMsg(err));
		}

		if (first.tag === "socket") {
			fire({ kind: "socket-alive" });
			return { kind: "socket-alive", released: true, pid: child.pid };
		}
		if (first.tag === "exit") {
			fire({ kind: "child-exited", code: first.code });
			return { kind: "child-exited", released: true, exitCode: first.code, pid: child.pid };
		}

		// first.tag === "timeout": NOT a release. Escalate to a kill, then wait a BOUNDED
		// grace for the kill to produce a real child-exited (or a racing socket-alive).
		try {
			deps.killChild(child);
		} catch {
			// kill itself threw — still try to observe within the grace; if nothing, retain.
		}
		let second: Observation;
		try {
			const graceP = tagTimeout(deps.awaitTimeout(deps.killGraceMs, signal));
			second = await Promise.race([socketP, exitP, graceP]);
		} catch (err) {
			// A dep rejected during the grace → cannot confirm; retain the lock, surface it.
			return retained(plan, child, "kill-unconfirmed", deps.killGraceMs, held.lockPath, errMsg(err));
		}
		if (second.tag === "socket") {
			fire({ kind: "socket-alive" });
			return { kind: "socket-alive", released: true, pid: child.pid };
		}
		if (second.tag === "exit") {
			fire({ kind: "child-exited", code: second.code });
			return { kind: "child-exited", released: true, exitCode: second.code, pid: child.pid };
		}
		// Grace elapsed with NO observation → the kill is unconfirmed. Do NOT release blind;
		// retain the lock and surface the evidence (bounded return, never a hang).
		return retained(plan, child, "kill-unconfirmed", deps.killGraceMs, held.lockPath, undefined);
	} finally {
		// Tear down the losing watchers (their timers / FS watches) on every exit.
		controller.abort();
	}
}

/**
 * Post-spawn backstop (GPT 5c-3a correction): a child exists but a watch/timer dep threw
 * before any observation. An observation-less release is forbidden (it reopens the
 * double-spawn window), so: best-effort kill → BOUNDED attempt to OBSERVE the exit →
 * release iff observed, else `lock-retained` fail-closed. We race ONLY the exit (not the
 * already-suspect socket watcher) plus a fresh grace timer.
 */
async function backstop(
	plan: SpawnBgPlan,
	deps: SpawnBgResumeDeps,
	child: SpawnedChild,
	lockPath: string,
	exitP: Promise<Observation>,
	signal: AbortSignal,
	fire: (event: ReleaseEvent) => void,
	originalError: string,
): Promise<SpawnBgResumeResult> {
	try {
		deps.killChild(child);
	} catch {
		// best-effort
	}
	try {
		const graceP = tagTimeout(deps.awaitTimeout(deps.killGraceMs, signal));
		const obs = await Promise.race([exitP, graceP]);
		if (obs.tag === "exit") {
			fire({ kind: "child-exited", code: obs.code });
			return { kind: "child-exited", released: true, exitCode: obs.code, pid: child.pid };
		}
	} catch {
		// exit watcher itself was the failing dep (or threw again) → fall through to retain.
	}
	return retained(plan, child, "observe-failed", deps.killGraceMs, lockPath, originalError);
}

function retained(
	plan: SpawnBgPlan,
	child: SpawnedChild,
	reason: "kill-unconfirmed" | "observe-failed",
	killGraceMs: number,
	lockPath: string,
	error: string | undefined,
): SpawnBgResumeResult {
	return {
		kind: "lock-retained",
		released: false,
		reason,
		error,
		diagnostic: {
			targetGardenId: plan.targetGardenId,
			pid: child.pid,
			expectedSocketPath: plan.expectedSocketPath,
			lockPath,
			observeTimeoutMs: plan.observeTimeoutMs,
			killGraceMs,
		},
	};
}
