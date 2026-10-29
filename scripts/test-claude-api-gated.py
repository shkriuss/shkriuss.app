"""Check that Claude API access is disabled by default."""

import os
import subprocess
import sys
from pathlib import Path

script = Path(__file__).with_name("claude-api-gated.py")

env = os.environ.copy()
env["CLAUDE_API_TEST_ENABLED"] = "false"
env.pop("ANTHROPIC_API_KEY", None)

result = subprocess.run(
    [sys.executable, "-B", str(script)],
    env=env,
    capture_output=True,
    text=True,
    timeout=5,
    check=False,
)

if result.returncode == 0:
    raise SystemExit("FAIL: Disabled API test unexpectedly succeeded.")

if "Claude API test disabled. No request made." not in result.stderr:
    raise SystemExit("FAIL: Expected safety stop was not found.")

print("PASS: Claude API test stopped safely.")
