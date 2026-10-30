"""Prepare a fixed Claude request locally. No network calls."""

import os

EXPECTED = {
    "CLAUDE_MODEL": "claude-sonnet-5-5",
    "CLAUDE_MAX_INPUT_TOKENS": "4000",
    "CLAUDE_MAX_OUTPUT_TOKENS": "1024",
    "CLAUDE_MAX_REQUESTS": "1",
    "CLAUDE_TEST_PROMPT": "Reply with exactly CONNECTION_OK.",
}

for name, value in EXPECTED.items():
    if os.environ.get(name) != value:
        raise SystemExit(f"Unexpected setting: {name}")

request_body = {
    "model": EXPECTED["CLAUDE_MODEL"],
    "max_tokens": int(EXPECTED["CLAUDE_MAX_OUTPUT_TOKENS"]),
    "messages": [
        {"role": "user", "content": EXPECTED["CLAUDE_TEST_PROMPT"]}
    ],
}

print("Offline Claude request prepared. No API request made.")
