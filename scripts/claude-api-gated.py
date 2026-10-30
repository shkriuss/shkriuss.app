"""Claude API connectivity test. Disabled until explicitly implemented."""

import json
import os

from claude_request_budget import OneRequestBudget

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

if (
    set(request_body) != {"model", "max_tokens", "messages"}
    or request_body["messages"] != [
        {"role": "user", "content": "Reply with exactly CONNECTION_OK."}
    ]
):
    raise SystemExit("Unexpected Claude request content. No request made.")

if request_body["model"] != "claude-sonnet-5-5" or request_body["max_tokens"] != 1024:
    raise SystemExit("Unexpected Claude model or output limit. No request made.")

request_bytes = json.dumps(
    request_body, separators=(",", ":"), ensure_ascii=True
).encode("utf-8")

if len(request_bytes) > 1000:
    raise SystemExit("Claude request exceeds 1000 bytes. No request made.")

request_budget = OneRequestBudget()
request_budget.claim()

raise SystemExit("Claude API test not implemented. No request made.")
