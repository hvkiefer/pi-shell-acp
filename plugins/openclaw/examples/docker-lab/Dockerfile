# Repro lab for the pi-shell-acp OpenClaw plugin prerelease.
# Mirrors the Oracle/local Docker path used to validate OpenClaw 2026.5.12
# + Telegram delivery + child pi execution.
FROM ghcr.io/openclaw/openclaw:2026.5.12

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    jq \
    python3-minimal \
    ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Child pi + backend ACP executables used by the prerelease plugin.
# Claude Code auth is read from the mounted ~/.claude directory; the package
# dependency for claude-agent-acp is resolved by pi-shell-acp itself.
RUN npm install -g \
      @earendil-works/pi-coding-agent \
      @zed-industries/codex-acp \
      @google/gemini-cli

USER node
