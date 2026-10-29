"""Claude API connectivity test. Disabled until explicitly implemented."""

import os

if os.environ.get("CLAUDE_API_TEST_ENABLED") != "true":
    raise SystemExit("Claude API test disabled. No request made.")

raise SystemExit("Claude API test not implemented. No request made.")
