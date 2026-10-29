
"""Offline one-attempt budget for a future Claude API request."""


class OneRequestBudget:
    """Permit one claimed request attempt per instance."""

    def __init__(self):
        self._claimed = False

    def claim(self):
        if self._claimed:
            raise RuntimeError(
                "Claude request limit reached. No second attempt allowed."
            )

        self._claimed = True
