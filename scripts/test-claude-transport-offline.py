"""Test Claude transport with mocked HTTPS. No real requests."""

from unittest.mock import patch

from claude_api_http import (
    EXPECTED_REQUEST_BYTES,
    prepare_claude_request,
)
from claude_api_transport import send_once
from claude_request_budget import OneRequestBudget

request = prepare_claude_request(
    EXPECTED_REQUEST_BYTES, "unit-test-only-key"
)
fake_request = prepare_claude_request(
    EXPECTED_REQUEST_BYTES, "offline-test-key"
)
budget = OneRequestBudget()

with (
    patch(
        "socket.socket.connect",
        side_effect=AssertionError("Network attempted"),
    ),
    patch("claude_api_transport.HTTPSConnection") as connection_type,
):
    # Refuse requests without approval.
    try:
        send_once(request, budget)
    except PermissionError:
        pass
    else:
        raise AssertionError("Unapproved request was not blocked")

    # Refuse the known offline placeholder credential.
    try:
        send_once(fake_request, OneRequestBudget(), approved=True)
    except ValueError:
        pass
    else:
        raise AssertionError("Offline test key was accepted")

    connection_type.assert_not_called()

    # Simulate a successful response without opening a connection.
    response = connection_type.return_value.getresponse.return_value
    response.status = 200
    response.read.return_value = (
        b'{"content":[{"type":"text","text":"CONNECTION_OK"}]}'
    )

    result = send_once(request, budget, approved=True)
    assert result == response.read.return_value

    connection_type.assert_called_once_with(
        "api.anthropic.com", timeout=10
    )
    connection_type.return_value.request.assert_called_once_with(
        "POST",
        "/v1/messages",
        body=EXPECTED_REQUEST_BYTES,
        headers={
            "Authorization": "Bearer unit-test-only-key",
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
    )
    connection_type.return_value.close.assert_called_once()

    # The same budget must refuse a second attempt.
    try:
        send_once(request, budget, approved=True)
    except RuntimeError as error:
        assert "No second attempt allowed" in str(error)
    else:
        raise AssertionError("Second request attempt was allowed")

    connection_type.return_value.request.assert_called_once()

    # Simulate a connection failure after the attempt is claimed.
    connection_type.reset_mock()
    failed_budget = OneRequestBudget()
    connection_type.return_value.request.side_effect = OSError(
        "Simulated network failure"
    )

    try:
        send_once(request, failed_budget, approved=True)
    except OSError as error:
        assert str(error) == "Simulated network failure"
    else:
        raise AssertionError("Network failure was not reported")

    connection_type.return_value.request.assert_called_once()
    connection_type.return_value.close.assert_called_once()

    # Even after a failed connection, this budget cannot retry.
    try:
        send_once(request, failed_budget, approved=True)
    except RuntimeError as error:
        assert "No second attempt allowed" in str(error)
    else:
        raise AssertionError("Retry after failure was allowed")

    connection_type.return_value.request.assert_called_once()

print("PASS: Claude transport safely tested offline.")
