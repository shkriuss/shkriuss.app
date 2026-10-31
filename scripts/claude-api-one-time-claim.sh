#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "Claude one-time claim refused: $1" >&2
  exit 1
}

# Require explicit workflow authorization.
[[ "${CLAUDE_CONNECTIVITY_APPROVED:-}" == "true" ]] ||
  fail "Not approved."

# Only the first attempt from the protected main branch.
[[ "${GITHUB_REPOSITORY:-}" == "shkriuss/shkriuss.app" ]] ||
  fail "Unexpected repository."

[[ "${GITHUB_REF:-}" == "refs/heads/main" ]] ||
  fail "Not running on main."

[[ "${GITHUB_RUN_ATTEMPT:-}" == "1" ]] ||
  fail "Workflow rerun not permitted."

[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] ||
  fail "Invalid commit SHA."

[[ -n "${GH_TOKEN:-}" ]] ||
  fail "GitHub token unavailable."

# An existing tag makes every later claim fail.
if ! gh api -X POST \
  "repos/${GITHUB_REPOSITORY}/git/refs" \
  -f "ref=refs/tags/claude-api-connectivity-once" \
  -f "sha=${GITHUB_SHA}" \
  >/dev/null; then
  fail "Tag already claimed or GitHub rejected creation."
fi

echo "One-time claim recorded. No Claude API request made."
