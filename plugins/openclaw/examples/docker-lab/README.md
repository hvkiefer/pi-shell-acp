# OpenClaw Docker lab for pi-shell-acp

Minimal reproducible lab for the prerelease OpenClaw plugin path:

```text
OpenClaw 2026.5.12 gateway → plugins/openclaw → child pi → ACP backend → Telegram/direct delivery
```

This was extracted from the local Oracle-repro cache used to debug the 2026-05-15 Telegram delivery issue. The checked-in files are sanitized: no tokens, sessions, sqlite databases, or generated OpenClaw state.

## Quick start

```bash
cd plugins/openclaw/examples/docker-lab
cp .env.example .env
# edit config/openclaw.json:
# - REPLACE_WITH_TELEGRAM_BOT_TOKEN
# - REPLACE_WITH_TELEGRAM_USER_ID

docker compose up -d --build
docker logs -f openclaw-pishell-lab
```

The gateway is exposed on `127.0.0.1:18889` and listens inside the container on `18789`.

## Repo-under-test mount

By default the compose file assumes it is run in-place from this directory and mounts the checkout at:

```text
/home/node/repos/gh/pi-shell-acp
/home/junghan/repos/gh/pi-shell-acp
```

If you copy this lab elsewhere, set:

```bash
export PI_SHELL_ACP_REPO=/absolute/path/to/pi-shell-acp
```

## Auth boundary

This lab uses the advanced β path by default: host auth and pi overlay are bind-mounted into the container:

```text
~/.pi/agent → /home/node/.pi/agent
~/.claude   → /home/node/.claude
~/.codex    → /home/node/.codex
~/.gemini   → /home/node/.gemini
```

That is appropriate for a trusted single-user repro lab. Public/default installs should prefer named volumes and perform backend login inside the container.

pi-shell-acp does not provide, copy, proxy, or decrypt backend credentials. The official backend CLIs read whatever auth state is visible inside the process/container.

## Useful checks

```bash
# Status through Telegram:
/status

# Container logs:
docker logs --tail=200 openclaw-pishell-lab

# Confirm the plugin sees the local checkout:
docker exec -it openclaw-pishell-lab sh -lc 'ls -la /home/node/repos/gh/pi-shell-acp/plugins/openclaw && pi --version'
```

Expected status shape after a successful Telegram/direct smoke:

```text
🦞 OpenClaw 2026.5.12
🧠 Model: pi-shell-acp/claude-opus-4-7
⚙️ Execution: direct · Runtime: OpenClaw Pi Default
```
