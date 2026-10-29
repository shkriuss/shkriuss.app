"""Claude API connectivity test. Disabled until explicitly implemented."""

import os

if os.environ.get("CLAUDE_API_TEST_ENABLED") != "true":
    raise SystemExit("Claude API test disabled. No request made.")

EXPECTED_LIMITS = {
    "CLAUDE_MAX_REQUESTS": "1",
    "CLAUDE_MAX_INPUT_TOKENS": "4000",
    "CLAUDE_MAX_OUTPUT_TOKENS": "1024",
    "CLAUDE_MODEL": "claude-sonnet-5-5",
    "CLAUDE_TEST_PROMPT": "Reply with exactly CONNECTION_OK.",
}

for name, expected in EXPECTED_LIMITS.items():
    if os.environ.get(name) != expected:
        raise SystemExit(f"Unsafe Claude API setting: {name}. No request made.")

request_body = {
    "model": EXPECTED_LIMITS["CLAUDE_MODEL"],
    "max_tokens": int(EXPECTED_LIMITS["CLAUDE_MAX_OUTPUT_TOKENS"]),
    "messages": [
        {
            "role": "user",
            "content": EXPECTED_LIMITS["CLAUDE_TEST_PROMPT"],
        }
    ],
}

raise SystemExit("Claude API test not implemented. No request made.")
