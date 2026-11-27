#!/bin/bash
# Installs the sync server's tools, exactly as package-lock.json in this
# folder pins them, into the folder given as the only argument: Wrangler
# (which brings Miniflare), TypeScript and the types of the Workers
# runtime. Copies package.json and package-lock.json there first.
# Used by the jobs of .github/workflows/backend.yml, and by hand with
# backend/ as the folder (docs/development/backend.md).
# Why: docs/adr/0043-backend-tools-tests-and-deploy.md.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: install.sh FOLDER" >&2
  exit 2
fi
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target="$1"
lock="$here/package-lock.json"
lock_name=.github/backend-tools/package-lock.json

# 1. Each tool is pinned to one exact version.
for tool in wrangler typescript @cloudflare/workers-types; do
  pinned="$(jq -r --arg t "$tool" '.dependencies[$t] // ""' "$here/package.json")"
  if ! [[ "$pinned" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "::error file=.github/backend-tools/package.json::Pin $tool to one exact version."
    exit 1
  fi
done
others="$(jq -r '.dependencies | keys - ["wrangler", "typescript", "@cloudflare/workers-types"] | length' "$here/package.json")"
if [ "$others" != 0 ]; then
  echo "::error file=.github/backend-tools/package.json::Only wrangler, typescript and @cloudflare/workers-types belong here. Another tool needs a decision record first."
  exit 1
fi

# 2. Every package in the lockfile comes from the npm registry and has a
#    SHA-512 checksum. So nothing comes from Git, a file or another server.
unpinned="$(jq -r '
  [.packages | to_entries[] | select(.key != "")
   | select((.value.resolved // "" | startswith("https://registry.npmjs.org/") | not)
            or (.value.integrity // "" | test("^sha512-[A-Za-z0-9+/]+={0,2}$") | not))]
  | length' "$lock")"
if [ "$unpinned" != 0 ]; then
  echo "::error file=$lock_name::$unpinned packages do not come from https://registry.npmjs.org/ with a SHA-512 checksum."
  exit 1
fi

# 3. npm ci installs exactly the lockfile. It checks every package against
#    its checksum, and fails if package.json and the lockfile disagree.
#    --ignore-scripts: no package may run code while it is installed.
#    --engine-strict: fail if this Node.js is too old for a package.
mkdir -p "$target"
cp "$here/package.json" "$lock" "$target/"
cd "$target"
echo "Node.js $(node --version), npm $(npm --version)"
npm ci --ignore-scripts --engine-strict --no-audit --no-fund --registry=https://registry.npmjs.org/

# 4. The installed tools are the pinned ones, and they start.
for tool in wrangler typescript @cloudflare/workers-types; do
  pinned="$(jq -r --arg t "$tool" '.dependencies[$t]' package.json)"
  installed="$(jq -r '.version' "node_modules/$tool/package.json")"
  if [ "$installed" != "$pinned" ]; then
    echo "::error file=$lock_name::Installed $tool $installed, but package.json pins $pinned."
    exit 1
  fi
done
WRANGLER_SEND_METRICS=false ./node_modules/.bin/wrangler --version > /dev/null
./node_modules/.bin/tsc --version > /dev/null
echo "The backend's tools are installed in $target."
