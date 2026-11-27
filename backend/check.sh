#!/bin/bash
# Checks the sync server: the type check, the two builds, and every
# test in Miniflare. It runs from its own folder, wherever it is started.
# From the repository root, install the tools once, then run it:
#   bash .github/backend-tools/install.sh backend
#   backend/check.sh
# CI runs the same in the job "Check the server" of
# .github/workflows/backend.yml.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export WRANGLER_SEND_METRICS=false

echo "Type check"
./node_modules/.bin/tsc -p .

echo "Build the Worker, as it is deployed"
rm -rf build
./node_modules/.bin/wrangler deploy --dry-run --outdir "$PWD/build/worker" \
  --config ../.github/backend-tools/wrangler.jsonc > /dev/null

echo "Build the Worker the tests start"
./node_modules/.bin/wrangler deploy --dry-run --outdir "$PWD/build/test" --config test/wrangler.jsonc > /dev/null

echo "Tests"
node --test --test-reporter=spec 'test/*.test.mjs'
