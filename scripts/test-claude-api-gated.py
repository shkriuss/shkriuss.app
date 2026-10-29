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

enabled_env = env.copy()
enabled_env.update({
    "CLAUDE_API_TEST_ENABLED": "true",
    "CLAUDE_MAX_REQUESTS": "1",
    "CLAUDE_MAX_INPUT_TOKENS": "4000",
    "CLAUDE_MAX_OUTPUT_TOKENS": "1024",
    "CLAUDE_MODEL": "claude-sonnet-5-5",
    "CLAUDE_TEST_PROMPT": "Reply with exactly CONNECTION_OK.",
})

enabled_result = subprocess.run(
    [sys.executable, "-B", str(script)],
    env=enabled_env,
    capture_output=True,
    text=True,
    timeout=5,
    check=False,
)

if enabled_result.returncode == 0 or (
    "Claude API test not implemented. No request made."
    not in enabled_result.stderr
):
    raise SystemExit("FAIL: Final Claude API safety stop did not run.")

print("PASS: Final Claude API safety stop remains active.")

unsafe_env = enabled_env.copy()
unsafe_env["CLAUDE_MAX_REQUESTS"] = "2"

unsafe_result = subprocess.run(
    [sys.executable, "-B", str(script)],
    env=unsafe_env,
    capture_output=True,
    text=True,
    timeout=5,
    check=False,
)

if unsafe_result.returncode == 0 or (
    "Unsafe Claude API setting: CLAUDE_MAX_REQUESTS. No request made."
    not in unsafe_result.stderr
):
    raise SystemExit("FAIL: Unsafe request-count setting was not blocked.")

print("PASS: Unsafe request-count setting was rejected.")

input_env = enabled_env.copy()
input_env["CLAUDE_MAX_INPUT_TOKENS"] = "8000"

input_result = subprocess.run(
    [sys.executable, "-B", str(script)],
    env=input_env,
    capture_output=True,
    text=True,
    timeout=5,
    check=False,
)

if input_result.returncode == 0 or (
    "Unsafe Claude API setting: CLAUDE_MAX_INPUT_TOKENS. No request made."
    not in input_result.stderr
):
    raise SystemExit("FAIL: Unsafe input-token setting was not blocked.")

print("PASS: Unsafe input-token setting was rejected.")

output_env = enabled_env.copy()
output_env["CLAUDE_MAX_OUTPUT_TOKENS"] = "2048"

output_result = subprocess.run(
    [sys.executable, "-B", str(script)],
    env=output_env,
    capture_output=True,
    text=True,
    timeout=5,
    check=False,
)

if output_result.returncode == 0 or (
    "Unsafe Claude API setting: CLAUDE_MAX_OUTPUT_TOKENS. No request made."
    not in output_result.stderr
):
    raise SystemExit("FAIL: Unsafe output-token setting was not blocked.")

print("PASS: Unsafe output-token setting was rejected.")

prompt_env = enabled_env.copy()
prompt_env["CLAUDE_TEST_PROMPT"] = "Reply with exactly NOT_OK."

prompt_result = subprocess.run(
    [sys.executable, "-B", str(script)],
    env=prompt_env,
    capture_output=True,
    text=True,
    timeout=5,
    check=False,
)

if prompt_result.returncode == 0 or (
    "Unsafe Claude API setting: CLAUDE_TEST_PROMPT. No request made."
    not in prompt_result.stderr
):
    raise SystemExit("FAIL: Unexpected Claude prompt was not blocked.")

print("PASS: Unexpected Claude prompt was rejected.")
