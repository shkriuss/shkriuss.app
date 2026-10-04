#!/usr/bin/env bash
# Prepares Claude Code cloud sessions so lint, type checks and tests can run.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Use the pnpm version pinned in package.json ("packageManager").
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable pnpm

# pnpm-workspace.yaml applies the supply-chain rules (release age, blocked install scripts).
pnpm install

# Playwright cannot download its browsers here. Point the end-to-end tests at the preinstalled
# Chromium; Firefox and WebKit run in CI.
chromium="$(ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -n "$chromium" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export E2E_CHROMIUM_EXECUTABLE=\"$chromium\"" >> "$CLAUDE_ENV_FILE"
fi
