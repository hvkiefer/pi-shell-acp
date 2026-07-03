#!/usr/bin/env bash
#
# Raw entwurf-bridge dist emit (the inner half of the `build-bridge` npm script).
# `rm -rf` the dist dir then tsc-emit into it. Serialization against concurrent
# packs/builds is NOT done here — it is the caller's job via scripts/with-dist-lock.sh
# (package.json wraps this: `with-dist-lock.sh build-bridge.sh`). Keeping the emit
# lock-free here is deliberate: the vulnerable window is the WHOLE `npm pack`
# (prepack build + npm's post-build dist read), not just this emit, so the lock has
# to wrap the pack, not this script — see with-dist-lock.sh for the full rationale.
set -euo pipefail

REPO_DIR=$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

rm -rf "$REPO_DIR/mcp/entwurf-bridge/dist"

# Prefer the repo-local tsc (present under both pnpm and npm layouts); fall back to
# a PATH tsc for a bare invocation outside the npm lifecycle.
TSC="$REPO_DIR/node_modules/.bin/tsc"
[ -x "$TSC" ] || TSC=tsc
"$TSC" -p "$REPO_DIR/mcp/entwurf-bridge/tsconfig.build.json"
