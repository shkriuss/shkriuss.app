#!/bin/bash
# Checks the sync server: the type check, the two builds, and every
# test in Miniflare. Run it from backend/, after the tools are installed
# with: bash ../.github/backend-tools/install.sh .
# CI runs the same in the job "Check" of .github/workflows/backend.yml.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
export WRANGLER_SEND_METRICS=false

echo "Type check"
./node_modules/.bin/tsc -p .

echo "Build the Worker, as it is deployed"
rm -rf build
./node_modules/.bin/wrangler deploy --dry-run --outdir "$PWD/build/worker" --config wrangler.jsonc > /dev/null

echo "Build the Worker the tests start"
./node_modules/.bin/wrangler deploy --dry-run --outdir "$PWD/build/test" --config test/wrangler.jsonc > /dev/null

echo "Tests"
node --test --test-reporter=spec 'test/*.test.mjs'
