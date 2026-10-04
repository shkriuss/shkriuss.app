#!/usr/bin/env bash
# PostToolUse hook: formats the file Claude just wrote or edited with the repository's Prettier.
# It never blocks: files Prettier ignores or does not understand are left untouched.
set -euo pipefail

file="$(node -e '
  let input = "";
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    try {
      process.stdout.write(JSON.parse(input)?.tool_input?.file_path ?? "");
    } catch {}
  });
')"

case "$file" in
  "$CLAUDE_PROJECT_DIR"/*) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0

prettier="$CLAUDE_PROJECT_DIR/node_modules/.bin/prettier"
[ -x "$prettier" ] || exit 0

cd "$CLAUDE_PROJECT_DIR"
"$prettier" --write --ignore-unknown --log-level warn "$file" >/dev/null 2>&1 || true
