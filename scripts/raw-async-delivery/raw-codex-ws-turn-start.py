#!/usr/bin/env python3
# raw-codex-ws-turn-start.py — ADDRESSED async delivery into a LIVE Codex thread
# via the LOCAL app-server control socket, using WebSocket-over-UnixDomainSocket
# JSON-RPC `turn/start`. No managed standalone, no cloud, no typing in the TUI.
#
# WHY WS-DIRECT (not the managed-daemon proxy path):
#   - The other Codex surface is the managed DAEMON control socket, driven via
#     `codex app-server proxy --sock` (newline JSON-RPC). That daemon REQUIRES the
#     managed standalone install (`~/.codex/packages/standalone/current/codex`),
#     and `codex remote-control start` also enables the cloud bridge. Out of scope.
#   - This script talks DIRECTLY to a bare `codex app-server --listen unix://PATH`
#     socket, which needs NO managed standalone and no cloud. The Codex unix-socket
#     transport speaks WebSocket (tokio-tungstenite `accept_async`) with NO auth
#     token (the 0700 owner-only socket dir is the security boundary). So a plain
#     WS-over-UDS client is sufficient.
#
# MEASURED (Codex 0.136.0, 2026-06-05): idle TUI (plain `codex` auto-attached to a
#   default-path app-server, or `codex --remote unix://PATH`) woke with zero typing;
#   the message body was injected and the model replied. thread/status/changed
#   notifications give completion observation (D7) on the same socket.
#
# SETUP (make Codex sessions addressable — see codex-local-appserver.sh):
#   codex app-server --listen unix://$HOME/.codex/app-server-control/app-server-control.sock &
#   codex            # plain launch auto-attaches (no -c overrides!)
#
# THREAD ID: from the newest rollout's session_meta id, e.g.
#   id=$(head -1 "$(ls -t ~/.codex/sessions/**/rollout-*.jsonl | head -1)" \
#        | python3 -c 'import json,sys;print(json.load(sys.stdin)["payload"]["id"])')
#
# USAGE: raw-codex-ws-turn-start.py <socket_path> <thread_id> <message...>
import socket, os, base64, struct, json, sys, time

if len(sys.argv) < 4:
    sys.stderr.write(
        "usage: raw-codex-ws-turn-start.py <socket_path> <thread_id> <message...>\n"
    )
    sys.exit(2)

SOCK = sys.argv[1]
THREAD = sys.argv[2]
MSG = " ".join(sys.argv[3:])

if not os.path.exists(SOCK):
    sys.stderr.write(
        f"no app-server socket at {SOCK}\n"
        "Start one: codex app-server --listen unix://<owned-0700-dir>/as.sock\n"
        "(A plain standalone TUI runs EMBEDDED and exposes no socket — not addressable.)\n"
    )
    sys.exit(1)

s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(SOCK)

# --- WebSocket handshake over the UDS (no auth required on the unix socket) ---
key = base64.b64encode(os.urandom(16)).decode()
s.sendall(
    (
        "GET / HTTP/1.1\r\n"
        "Host: localhost\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    ).encode()
)
buf = b""
while b"\r\n\r\n" not in buf:
    chunk = s.recv(4096)
    if not chunk:
        break
    buf += chunk
status = buf.split(b"\r\n", 1)[0].decode(errors="replace")
if "101" not in status:
    sys.stderr.write(f"websocket handshake failed: {status}\n")
    sys.exit(1)


def send_text(obj):
    data = json.dumps(obj, separators=(",", ":")).encode()
    n = len(data)
    hdr = bytearray([0x81])  # FIN + text opcode
    if n < 126:
        hdr.append(0x80 | n)
    elif n < 65536:
        hdr.append(0x80 | 126)
        hdr += struct.pack(">H", n)
    else:
        hdr.append(0x80 | 127)
        hdr += struct.pack(">Q", n)
    mask = os.urandom(4)            # client->server frames MUST be masked
    hdr += mask
    s.sendall(bytes(hdr) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


def recv_until(deadline):
    s.settimeout(0.5)
    result = {"started": False, "status_seen": []}
    while time.monotonic() < deadline:
        try:
            b0 = s.recv(2)
        except socket.timeout:
            continue
        if len(b0) < 2:
            continue
        op = b0[0] & 0x0F
        ln = b0[1] & 0x7F
        if ln == 126:
            ln = struct.unpack(">H", s.recv(2))[0]
        elif ln == 127:
            ln = struct.unpack(">Q", s.recv(8))[0]
        payload = b""
        while len(payload) < ln:
            c = s.recv(ln - len(payload))
            if not c:
                break
            payload += c
        if op == 0x8:  # close
            return result
        try:
            d = json.loads(payload)
        except Exception:
            continue
        if d.get("id") == 2 and "result" in d:
            turn = d["result"].get("turn", {})
            result["started"] = True
            result["turnId"] = turn.get("id")
        if d.get("method") == "thread/status/changed":
            st = d.get("params", {}).get("status", {}).get("type")
            if st:
                result["status_seen"].append(st)
                # idle after active = the injected turn completed
                if st == "idle" and "active" in result["status_seen"]:
                    return result
    return result


send_text({
    "id": 1, "method": "initialize",
    "params": {
        "clientInfo": {"name": "raw-async-delivery", "title": "raw-async-delivery", "version": "0"},
        "capabilities": {"experimentalApi": True, "requestAttestation": False},
    },
})
time.sleep(0.4)
send_text({"method": "initialized"})
time.sleep(0.2)
send_text({
    "id": 2, "method": "turn/start",
    "params": {
        "threadId": THREAD,
        "clientUserMessageId": None,
        "input": [{"type": "text", "text": MSG, "textElements": []}],
    },
})

res = recv_until(time.monotonic() + 30)
s.close()
print(json.dumps({
    "ok": res.get("started", False),
    "threadId": THREAD,
    "turnId": res.get("turnId"),
    "status_seen": res.get("status_seen", []),
}, ensure_ascii=False))
sys.exit(0 if res.get("started") else 1)
