import sys


class IntegrationHealth:
    """Per-integration bail-out tracker.

    Once an integration hits a timeout or rate-limit, `mark_throttled` flips
    `should_bail` so the outer loop can stop after the current entry instead
    of burning through every remaining entry's retry/backoff cycle.
    """

    def __init__(self, name: str):
        self.name = name
        self.should_bail = False

    def mark_throttled(self, reason: str) -> None:
        if self.should_bail:
            return
        print(
            f"    {self.name}: {reason} — skipping remaining entries after this one",
            file=sys.stderr,
        )
        self.should_bail = True
