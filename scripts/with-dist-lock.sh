#!/usr/bin/env bash
#
# Serialize a command that rebuilds OR reads mcp/entwurf-bridge/dist against every
# other such command: `with-dist-lock.sh <cmd...>` runs <cmd> holding an atomic
# lock over the shared dist dir.
#
# Why the lock has to wrap the WHOLE command, not just the emit:
# build-bridge does `rm -rf dist` then a tsc emit; `npm pack` runs build-bridge as
# its prepack hook and then, AFTER prepack returns, walks the tree to read dist into
# the tarball. So the window where dist must stay intact is [prepack build ‥ npm's
# post-build read] — the entire pack, not the emit alone. A lock scoped to just the
# emit (released when build-bridge exits) is not merely insufficient, it BACKFIRES:
# it staggers concurrent packs so each run's lock-free read lands squarely inside
# the next run's `rm -rf dist`, turning an occasional race into a near-deterministic
# phantom "dist missing" pack failure (measured: 7/8 packs MISSING). Wrapping the
# whole pack fixes it — the read is now inside the lock (2026-07-03).
#
# Reentrancy: the wrapped `npm pack` re-invokes build-bridge as its prepack, which
# is itself wrapped by this script (package.json). ENTWURF_BUILD_LOCK_HELD, exported
# once the outer wrapper acquires, tells the nested invocation to run through
# without re-acquiring, so the prepack never self-deadlocks against its own gate.
#
# mkdir is the atomic primitive (POSIX, no `flock` dependency — portable across the
# npm/pnpm lifecycle on the Linux publish host). Mirrors the entwurf-v2 dispatch
# lock discipline: atomic acquire, holder pid recorded for human cleanup, same-host
# stale reclaim (a SIGKILL'd holder never wedges every future build), and a
# bounded wait that fails loud rather than hanging or building into a half-wiped dir.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: with-dist-lock.sh <command> [args...]" >&2
  exit 2
fi

# An ancestor already holds the dist lock (e.g. this is `npm pack`'s prepack
# build-bridge under a gate that wraps the whole pack) — run reentrantly.
if [ -n "${ENTWURF_BUILD_LOCK_HELD:-}" ]; then
  exec "$@"
fi

REPO_DIR=$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
LOCK_DIR="$REPO_DIR/.tmp-verify/dist.lock"
mkdir -p "$REPO_DIR/.tmp-verify"

try_acquire() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    return 0
  fi
  # Same-host stale reclaim: a holder killed with SIGKILL leaves the dir behind.
  # If its recorded pid is gone, the lock is dead — reclaim it so a crashed build
  # never wedges every future one. (Builds/packs always run on the local host, so
  # a same-host pid probe is authoritative.)
  local holder
  holder=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
  if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR" 2>/dev/null && return 0
  fi
  return 1
}

# Bounded wait (~120s): a full pack (prepack tsc emit + npm tree walk) is a few
# seconds, so this clears several serialized contenders with headroom, then fails
# loud rather than hanging forever.
acquired=0
for _ in $(seq 1 1200); do
  if try_acquire; then acquired=1; break; fi
  sleep 0.1
done
if [ "$acquired" != 1 ]; then
  echo "[with-dist-lock] could not acquire dist lock after ~120s: $LOCK_DIR" >&2
  echo "[with-dist-lock] if no other build/pack is running, remove it: rm -rf \"$LOCK_DIR\"" >&2
  exit 1
fi
echo "$$" > "$LOCK_DIR/pid" 2>/dev/null || true
# Release on ANY exit (incl. the wrapped command failing) so a red run never wedges
# the next. The nested prepack build-bridge sees this and skips re-acquiring.
export ENTWURF_BUILD_LOCK_HELD=$$
trap 'rm -rf "$LOCK_DIR"' EXIT

"$@"
