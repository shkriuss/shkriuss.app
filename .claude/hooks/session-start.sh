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
