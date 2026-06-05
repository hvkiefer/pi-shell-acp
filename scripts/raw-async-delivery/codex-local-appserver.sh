#!/usr/bin/env bash
# codex-local-appserver.sh — make Codex sessions ADDRESSABLE for local raw async
# delivery, with NO managed standalone and NO cloud.
#
# WHAT IT DOES: starts a bare `codex app-server --listen unix://<default control
# socket>`. Once it is up, every PLAIN `codex` launch (no `-c` overrides) auto-
# attaches to it (`maybe_probe_default_daemon_socket`), so its thread becomes
# reachable by raw-codex-ws-turn-start.py over the same socket. This is the Codex
# analogue of arming every Claude session via global settings.json.
#
# WHY NOT `codex remote-control start` / `codex app-server daemon start`:
#   those require the managed standalone install (`~/.codex/packages/standalone/
#   current/codex`, via `curl chatgpt.com/codex/install.sh`) AND `remote-control`
#   additionally enables the CLOUD bridge (ChatGPT app access). We want neither.
#   A bare `app-server --listen` needs no standalone and stays purely local.
#
# GOTCHAS:
#   - The socket DIRECTORY must be owner-owned and end up mode 0700. Codex's
#     prepare_private_socket_directory() chmods it to 0700; pointing at a dir you
#     do NOT own (e.g. /tmp directly) fails with EPERM. The default
#     ~/.codex/app-server-control/ is fine (Codex creates it 0700).
#   - Auto-attach is DISABLED when the TUI is launched with `-c` overrides,
#     --strict-config, a non-default loader, or bypass-hook-trust. Launch plain
#     `codex` for auto-attach, or use `codex --remote unix://PATH` explicitly.
#   - A TUI that is ALREADY running standalone (Embedded) cannot be retrofitted;
#     only launches made AFTER this server is up will attach.
#
# PERSISTENCE: for an always-on setup, run this under a home-manager / systemd
#   user service instead of by hand (fits the reproducible-env model).
#
# USAGE:
#   codex-local-appserver.sh            # foreground on the default control socket
#   codex-local-appserver.sh <sock>     # foreground on a custom owned socket path
set -euo pipefail
SOCK="${1:-$HOME/.codex/app-server-control/app-server-control.sock}"
echo "starting codex app-server on unix://$SOCK"
echo "  -> plain \`codex\` launches will auto-attach and become addressable"
echo "  -> deliver with: raw-codex-ws-turn-start.py '$SOCK' <threadId> <message>"
exec codex app-server --listen "unix://$SOCK"
