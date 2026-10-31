"""Single-attempt Claude transport. Not invoked by CI or the gated script."""

from http.client import HTTPSConnection
from urllib.request import Request

from claude_api_http import (
    ANTHROPIC_VERSION,
    CLAUDE_MESSAGES_URL,
    EXPECTED_REQUEST_BYTES,
)
from claude_request_budget import OneRequestBudget


def send_once(
    request: Request,
    budget: OneRequestBudget,
    *,
    approved: bool = False,
) -> bytes:
    """Make one explicitly approved request, without retries."""
    if approved is not True:
        raise PermissionError("Claude API send not approved. No request made.")

    if (
        request.full_url != CLAUDE_MESSAGES_URL
        or request.get_method() != "POST"
        or request.data != EXPECTED_REQUEST_BYTES
    ):
        raise ValueError("Unexpected Claude request. No request made.")

    authorization = request.get_header("Authorization")
    if (
        not authorization
        or not authorization.startswith("Bearer ")
        or authorization == "Bearer offline-test-key"
    ):
        raise ValueError("Missing real Claude API credential. No request made.")

    if (
        request.get_header("Anthropic-version") != ANTHROPIC_VERSION
        or request.get_header("Content-type") != "application/json"
    ):
        raise ValueError("Unexpected Claude headers. No request made.")

    budget.claim()

    connection = HTTPSConnection("api.anthropic.com", timeout=10)
    try:
        connection.request(
            "POST",
            "/v1/messages",
            body=request.data,
            headers={
                "Authorization": authorization,
                "anthropic-version": ANTHROPIC_VERSION,
                "content-type": "application/json",
            },
        )
        response = connection.getresponse()
        result = response.read(8192)

        if response.status != 200:
            raise RuntimeError(
                f"Claude API returned HTTP {response.status}."
            )

        return result
    finally:
        connection.close()
