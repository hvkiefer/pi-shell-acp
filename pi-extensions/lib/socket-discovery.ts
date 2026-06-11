/**
 * socket-discovery — the SOCKET-axis wiring for the fact-provider (0.11 Stage 0
 * step 4, slice 3). Turns the control-socket directory + the in-domain citizen
 * list into the `SocketProbe[]` that `resolveFactList` (slice 2) consumes.
 *
 * Why a probe per in-domain citizen, not just a directory listing: slice 2's
 * frozen invariant is that EVERY in-domain (pi) citizen must arrive PROBED — a
 * dormant citizen whose socket file is gone must read as `dead` (ENOENT =
 * positive proof of absence) so it routes dormant→resumable, never as an
 * unprobed `null`/`indeterminate` that would strand it (resolveFactList throws
 * on an unprobed in-domain citizen). So we probe the union of
 *   (sockets present in the dir) ∪ (every in-domain citizen's canonical path):
 * a dir-present socket yields alive / indeterminate / dead; a citizen with no
 * file yields `dead` via ENOENT. Three-valued throughout (`probeSocketLiveness`)
 * — an indeterminate stall is NEVER folded to dead (F3). This is exactly why we
 * cannot reuse the legacy `getLiveSessions` (alive-only listing): folding the
 * hidden indeterminate/dead sockets into "absent" would resurrect the F3 split.
 *
 * This slice fills only the LIVENESS axis. The get_info enrich (cwd / model /
 * idle) is a separate follow-up — `SocketProbe`'s enrich fields are
 * nullable-by-design, so a probe with no RPC enrich is HONEST, not synthetic.
 *
 * Deps (dir / readdir / probe) are injectable so the gate drives it without IO.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { SocketProbe } from "./entwurf-facts.ts";
import { SESSION_ID_RE } from "./session-id.js";
import { probeSocketLiveness, type SocketLiveness } from "./socket-probe.ts";

/** Canonical control-socket directory; the socket filename IS the gardenId
 * (동결결정3 correlation authority). */
export const CONTROL_SOCKET_DIR = path.join(os.homedir(), ".pi", "entwurf-control");
export const SOCKET_SUFFIX = ".sock";

// A control-socket filename is a bare garden id. We reuse the repo-wide
// `SESSION_ID_RE` SSOT (not a local copy): 동결결정3 makes the socket filename the
// correlation authority, which only holds if the socket axis and the meta-record
// axis speak the SAME id grammar — a drifted local regex would silently drop a
// legitimate gid's socket from the scan. A malformed name has no citizen to
// correlate to and is ignored.

export function controlSocketPath(gardenId: string, dir: string = CONTROL_SOCKET_DIR): string {
	return path.join(dir, `${gardenId}${SOCKET_SUFFIX}`);
}

export interface SocketScanDeps {
	dir: string;
	readdir: (dir: string) => Promise<string[]>;
	probe: (socketPath: string) => Promise<SocketLiveness>;
}

/**
 * Probe the union of (control sockets present in `dir`) ∪ (`piCitizenGardenIds`)
 * and return one `SocketProbe` per gardenId (liveness only; enrich = null).
 * A missing / unreadable directory is treated as empty — the in-domain citizens
 * are still probed (their absent canonical paths read `dead`). Output is sorted
 * by gardenId for determinism.
 */
export async function scanSocketProbes(
	piCitizenGardenIds: readonly string[],
	deps: Partial<SocketScanDeps> = {},
): Promise<SocketProbe[]> {
	const dir = deps.dir ?? CONTROL_SOCKET_DIR;
	const readdir = deps.readdir ?? ((d: string) => fs.readdir(d));
	const probe = deps.probe ?? ((p: string) => probeSocketLiveness(p));

	let names: string[] = [];
	try {
		names = await readdir(dir);
	} catch {
		names = [];
	}
	const socketGids = names
		.filter((n) => n.endsWith(SOCKET_SUFFIX))
		.map((n) => n.slice(0, -SOCKET_SUFFIX.length))
		.filter((gid) => SESSION_ID_RE.test(gid));

	const allGids = [...new Set([...socketGids, ...piCitizenGardenIds])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	const probes: SocketProbe[] = [];
	for (const gardenId of allGids) {
		const liveness = await probe(controlSocketPath(gardenId, dir));
		probes.push({ gardenId, liveness, cwd: null, model: null, idle: null, infoError: null });
	}
	return probes;
}
