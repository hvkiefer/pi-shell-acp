/**
 * entwurf-preflight — 0.11 Stage 0 (2): the SINGLE trust/launch decision owner.
 *
 * The controlled-launch surface, the global `project_trust` handler, and any
 * MCP fact tool ALL consume this module's outcome — nobody else re-derives a
 * prefix, re-reads `trust.json`, or re-probes trust inputs. pi's raw trust
 * semantics are followed by importing pi's PUBLIC root exports directly (frozen
 * decision 9, 재구현 금지): `ProjectTrustStore` (the canonical `trust.json`
 * reader, which itself canonicalizes the cwd and takes a `proper-lockfile` on
 * every read) and `hasProjectTrustInputs` (the trust-input probe). We never copy
 * pi's trust detail — if pi changes it, this import tracks it.
 *
 * The returned `PreflightOutcome` is deliberately RICH, not just {kind,reason}:
 * a fact tool must explain *why* a cwd is approved and *what* it may load
 * without re-running the probe, and an error/handler must name the matched root
 * or the trust-store value. Thin outcomes would push callers to recompute, which
 * is exactly the re-derivation this module exists to prevent.
 *
 * trust ≠ discovery: this decision touches the store for a SINGLE launch-time
 * cwd only. `peers`/`who-can` discovery does not call here (frozen decision 4).
 *
 * Precedence (frozen decision 8) — saved distrust is stronger than a prefix
 * allow; a prefix only promotes the UNDECIDED (null) case; no-trust-inputs is
 * trusted but needs no launch arg; everything else is fail-fast:
 *
 *   saved === false        → deny           (explicit distrust; store wins)
 *   saved === true         → approve        (saved trust → internal --approve)
 *   null + prefix match    → approve        (operator prefix promotes null→yes)
 *   null + no trust inputs → trusted-no-arg (no trust-gated input — pi 0.79.1
 *                                             excludes AGENTS.md/CLAUDE.md, so
 *                                             context files may still be loaded)
 *   else (null + inputs)   → fail-fast      (unknown/untrusted controlled launch)
 *
 * Injection (frozen decision 4): `agentDir` defaults to `getAgentDir()` but is
 * overridable so tests point `ProjectTrustStore` at a temp dir (or set
 * `PI_CODING_AGENT_DIR`, same isolation as 0.10.0) and never read or dirty the
 * operator's real `~/.pi/agent/trust.json`. `prefixRoots` is an OPERATOR-policy
 * input with NO package default (frozen decision 7): a public package must not
 * hardcode a broad auto-approve, so an empty roots list means "no prefix
 * promotion" — the caller injects the operator's roots (e.g. `~/repos/gh`).
 */

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import {
	getAgentDir,
	hasProjectTrustInputs,
	type ProjectTrustDecision,
	ProjectTrustStore,
} from "@earendil-works/pi-coding-agent";

export interface PreflightInput {
	/** The single launch-time cwd whose trust is being decided. */
	cwd: string;
	/**
	 * pi agent dir holding `trust.json`. Defaults to `getAgentDir()` (which
	 * honors `PI_CODING_AGENT_DIR`). Override to a temp dir for isolated tests.
	 */
	agentDir?: string;
	/**
	 * Operator-policy auto-approve roots. NO package default (frozen decision 7).
	 * Roots may be `~`-relative (`~/repos/gh`) or relative; they are normalized
	 * the same way as the cwd. A cwd at or under one of these (canonical path +
	 * separator boundary) promotes an UNDECIDED trust into approve. Empty ⇒ no
	 * prefix promotion.
	 */
	prefixRoots?: readonly string[];
}

/** Fields present on every outcome — the fact/handler/error evidence. */
interface PreflightEvidence {
	/**
	 * Args the launcher must add. `["--approve"]` when approving, `[]` otherwise.
	 * Frozen decision 6: never `--no-approve` (that is a silent degraded launch).
	 */
	readonly launchArgs: readonly string[];
	/** The raw `ProjectTrustStore.get(cwd)` value: true / false / null. */
	readonly trustStoreDecision: ProjectTrustDecision;
	/** `hasProjectTrustInputs(cwd)` — computed even when a prefix already won. */
	readonly hasTrustInputs: boolean;
	/** The canonical operator root that matched, if the decision is prefix-driven. */
	readonly matchedPrefixRoot?: string;
	/** The cwd after tilde-expand → resolve → realpath (raw-resolved fallback). */
	readonly canonicalCwd: string;
}

/**
 * Controlled-launch decision. The launcher maps:
 *   approve         → spawn child with `launchArgs` (`--approve`; load project files)
 *   trusted-no-arg  → spawn child, no `--approve` needed (no project files)
 *   deny            → refuse to spawn (throw); never a silent `--no-approve`
 */
export type PreflightOutcome =
	| (PreflightEvidence & { readonly kind: "approve"; readonly reason: "saved-true" | "prefix-match" })
	| (PreflightEvidence & { readonly kind: "trusted-no-arg"; readonly reason: "no-trust-inputs" })
	| (PreflightEvidence & { readonly kind: "deny"; readonly reason: "saved-false" | "fail-fast" });

/**
 * Normalize a path the way pi resolves one before the trust store sees it:
 * expand a leading `~`, make it absolute (`path.resolve`), then `realpathSync`;
 * on a resolve failure fall back to the RESOLVED absolute path (not the raw
 * input), so a not-yet-existing root still compares on an absolute basis.
 */
function normalizePath(p: string): string {
	let expanded = p;
	if (p === "~") {
		expanded = homedir();
	} else if (p.startsWith("~/")) {
		expanded = join(homedir(), p.slice(2));
	}
	const abs = isAbsolute(expanded) ? expanded : resolve(expanded);
	try {
		return realpathSync(abs);
	} catch {
		return abs;
	}
}

/**
 * Return the canonical operator root that contains `canonicalCwd`, by canonical
 * path + separator boundary (frozen decision 7). `/org` matches `/org/a` but NOT
 * `/org2` — never a bare `startsWith`. Roots are normalized the same as the cwd.
 */
function matchedPrefixRoot(canonicalCwd: string, roots: readonly string[]): string | undefined {
	for (const root of roots) {
		const r = normalizePath(root);
		if (canonicalCwd === r || canonicalCwd.startsWith(r + sep)) {
			return r;
		}
	}
	return undefined;
}

/** Decide trust for a single controlled-launch cwd. See module header. */
export function preflight(input: PreflightInput): PreflightOutcome {
	const agentDir = input.agentDir ?? getAgentDir();
	const prefixRoots = input.prefixRoots ?? [];

	const canonicalCwd = normalizePath(input.cwd);
	const store = new ProjectTrustStore(agentDir);
	const trustStoreDecision = store.get(input.cwd);
	// Computed unconditionally: a fact tool must report what a prefix-approved
	// cwd could load, so the probe runs even when a prefix already decides.
	const hasTrustInputs = hasProjectTrustInputs(input.cwd);
	const matched = matchedPrefixRoot(canonicalCwd, prefixRoots);

	const evidence: PreflightEvidence = {
		launchArgs: [],
		trustStoreDecision,
		hasTrustInputs,
		canonicalCwd,
		...(matched !== undefined ? { matchedPrefixRoot: matched } : {}),
	};

	// Explicit distrust wins over everything, including a prefix match.
	if (trustStoreDecision === false) {
		return { ...evidence, kind: "deny", reason: "saved-false" };
	}
	if (trustStoreDecision === true) {
		return { ...evidence, kind: "approve", reason: "saved-true", launchArgs: ["--approve"] };
	}

	// trustStoreDecision === null (undecided): a prefix promotes it; otherwise the
	// absence of trust inputs makes it trusted-but-no-arg; otherwise fail-fast.
	if (matched !== undefined) {
		return { ...evidence, kind: "approve", reason: "prefix-match", launchArgs: ["--approve"] };
	}
	if (!hasTrustInputs) {
		return { ...evidence, kind: "trusted-no-arg", reason: "no-trust-inputs" };
	}
	return { ...evidence, kind: "deny", reason: "fail-fast" };
}
