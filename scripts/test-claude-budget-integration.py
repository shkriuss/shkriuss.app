"""Test the offline Claude budget integration."""

import os
import runpy
from pathlib import Path
from unittest.mock import patch

from claude_request_budget import OneRequestBudget

script = Path(__file__).with_name("claude-api-gated.py")

settings = {
    "CLAUDE_API_TEST_ENABLED": "true",
    "CLAUDE_MAX_REQUESTS": "1",
    "CLAUDE_MAX_INPUT_TOKENS": "4000",
    "CLAUDE_MAX_OUTPUT_TOKENS": "1024",
    "CLAUDE_MODEL": "claude-sonnet-5-5",
    "CLAUDE_TEST_PROMPT": "Reply with exactly CONNECTION_OK.",
}

with (
    patch.dict(os.environ, settings, clear=True),
    patch.object(OneRequestBudget, "claim", autospec=True) as claim,
    patch(
        "socket.socket.connect",
        side_effect=RuntimeError("FAIL: Network attempted."),
    ),
):
    try:
        runpy.run_path(str(script), run_name="__main__")
    except SystemExit as error:
        if str(error) != "Claude API test not implemented. No request made.":
            raise SystemExit("FAIL: Unexpected safety stop.") from error
    else:
        raise SystemExit("FAIL: Final safety stop missing.")

    if claim.call_count != 1:
        raise SystemExit("FAIL: Expected exactly one budget claim.")

print("PASS: Budget claimed once; API remains blocked.")
