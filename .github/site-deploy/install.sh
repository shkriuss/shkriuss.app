#!/bin/bash
# Installs the hub site's deploy tool, Wrangler, exactly as package-lock.json
# in this folder pins it, into the folder given as the only argument. Also
# copies the Worker's configuration, wrangler.jsonc, there.
# Used by the jobs "Deploy tool" and "Deploy" in .github/workflows/site.yml.
# Why: docs/adr/0023-hub-site-hosting-and-deploy.md.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: install.sh FOLDER" >&2
  exit 2
fi
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target="$1"
lock="$here/package-lock.json"
lock_name=.github/site-deploy/package-lock.json

# 1. Wrangler is pinned to one exact version.
expected="$(jq -r '.dependencies.wrangler // ""' "$here/package.json")"
if ! [[ "$expected" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error file=.github/site-deploy/package.json::Pin wrangler to one exact version, such as 4.156.2."
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
cp "$here/package.json" "$lock" "$here/wrangler.jsonc" "$target/"
cd "$target"
echo "Node.js $(node --version), npm $(npm --version)"
npm ci --ignore-scripts --engine-strict --no-audit --no-fund --registry=https://registry.npmjs.org/

# 4. The installed Wrangler is the pinned one, and it starts.
installed="$(jq -r '.version' node_modules/wrangler/package.json)"
if [ "$installed" != "$expected" ]; then
  echo "::error file=$lock_name::Installed wrangler $installed, but package.json pins $expected."
  exit 1
fi
WRANGLER_SEND_METRICS=false ./node_modules/.bin/wrangler --version > /dev/null
echo "Wrangler $installed is installed in $target."
