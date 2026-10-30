"""Test Claude HTTP request preparation without network access."""

from unittest.mock import patch

from claude_api_http import prepare_claude_request

body = (
    b'{"model":"claude-sonnet-5-5","max_tokens":1024,'
    b'"messages":[{"role":"user","content":"Reply with exactly CONNECTION_OK."}]}'
)

with patch(
    "socket.socket.connect",
    side_effect=AssertionError("Unexpected network request."),
):
    request = prepare_claude_request(body, "offline-test-key")

    assert request.full_url == "https://api.anthropic.com/v1/messages"
    assert request.get_method() == "POST"
    assert request.data == body
    assert request.get_header("Authorization") == "Bearer offline-test-key"
    assert request.get_header("Anthropic-version") == "2023-06-01"
    assert request.get_header("Content-type") == "application/json"

    for invalid_body in (b"", b"x" * 1001, "not bytes"):
        try:
            prepare_claude_request(invalid_body, "offline-test-key")
        except ValueError:
            pass
        else:
            raise AssertionError("Invalid request body was accepted.")

    for invalid_key in ("", "bad\nkey", "bad\rkey"):
        try:
            prepare_claude_request(body, invalid_key)
        except ValueError:
            pass
        else:
            raise AssertionError("Invalid API key was accepted.")

print("PASS: Claude HTTP request prepared safely offline.")
