"""Check manual Claude workflow safety settings offline."""

from pathlib import Path

workflow = (
    Path(__file__).resolve().parent.parent
    / ".github/workflows/audit-fix.yml"
).read_text(encoding="utf-8")

concurrency_guard = (
    "\nconcurrency:\n"
    "  group: claude-audit-manual\n"
    "  cancel-in-progress: false\n"
    "\njobs:\n"
)

if concurrency_guard not in workflow:
    raise SystemExit("FAIL: Claude workflow concurrency guard missing.")

api_block = (
    "      - name: Block API tests until enabled\n"
    "        if: ${{ inputs.api_test }}\n"
    "        shell: bash\n"
    "        run: |\n"
    '          echo "::error::Claude API tests are not enabled yet."\n'
    "          exit 1\n"
)

if api_block not in workflow:
    raise SystemExit("FAIL: Claude API safety block missing.")

print("PASS: Claude workflow safety settings are intact.")
