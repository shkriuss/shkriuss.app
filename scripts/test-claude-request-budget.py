"""Offline test for the one-request budget."""

from claude_request_budget import OneRequestBudget

budget = OneRequestBudget()

budget.claim()

try:
    budget.claim()
except RuntimeError as error:
    if str(error) != (
        "Claude request limit reached. No second attempt allowed."
    ):
        raise SystemExit("FAIL: Unexpected request-limit error.") from error
else:
    raise SystemExit("FAIL: Second request attempt was allowed.")

print("PASS: First claim allowed; second claim rejected.")
