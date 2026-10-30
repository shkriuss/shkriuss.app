"""Prepare a Claude Messages API request without sending it."""

from urllib.request import Request

CLAUDE_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"


def prepare_claude_request(request_bytes: bytes, api_key: str) -> Request:
    """Build the fixed HTTPS request. This function performs no network I/O."""
    if not isinstance(request_bytes, bytes) or not 0 < len(request_bytes) <= 1000:
        raise ValueError("Claude request must contain at most 1000 bytes.")

    if not api_key or "\r" in api_key or "\n" in api_key:
        raise ValueError("Invalid Claude API key.")

    return Request(
        CLAUDE_MESSAGES_URL,
        data=request_bytes,
        headers={
            "Authorization": f"Bearer {api_key}",
            "anthropic-version": ANTHROPIC_VERSION,
            "Content-Type": "application/json",
        },
        method="POST",
    )
