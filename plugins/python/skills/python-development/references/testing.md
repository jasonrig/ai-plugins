# Develop behavior with focused tests

## Work in small test-first changes

Start with observable requirements and a short list of useful cases. Choose one
case, write the test, and run it. Confirm that it fails because the behavior is
missing or incorrect. An import error, broken fixture, or unavailable service
does not establish the intended failing behavior.

Implement the smallest complete behavior that passes. Then improve names,
structure, and duplication in both production and test code while tests stay
green. Repeat for the next case. Do not stop at a series of patches without
refactoring, or add infrastructure for imagined future features. Run the focused
test while developing and the relevant broader suite before finishing.

For a bug, write a failing regression test from the reported case before fixing
it. For an uncertain legacy refactor, first capture behavior that must remain.
Confirm whether surprising behavior is a requirement or a bug; a characterization
test must not turn an accidental defect into an unquestioned specification.
For a pure documentation or formatting change, use the corresponding checks
instead of inventing behavior tests.

## Choose the level and amount of testing

Use the smallest practical test that gives credible confidence in the behavior.
Isolation is useful when it improves speed and determinism; it is not a reason
to mock every collaborator or test every private helper separately.

| Need                                                                     | Useful test                                                          |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| A calculation, decision, or validation rule                              | A focused test of its public behavior                                |
| Database queries, serialization, files, subprocesses, or an SDK boundary | An integration test using the real relevant boundary where practical |
| An important user workflow                                               | A small number of end-to-end tests                                   |
| Many inputs with a meaningful invariant                                  | Examples plus targeted property-based tests                          |
| An agreed performance, concurrency, or failure-recovery requirement      | A dedicated test that measures that requirement                      |

Check typical inputs, useful boundaries, invalid inputs, expected failures,
state changes, and previously reported defects. Use equivalence classes to
choose representative cases. Add combinations when their interaction is risky,
not as a blind cross-product of every input. Verify externally visible effects
and failures, not incidental internal ordering or implementation text.

There is no universal test count or unit/integration ratio. Each additional
test should cover a distinct risk or give confidence that another level cannot.
Avoid repeating the same exhaustive cases at every level. Too much testing
shows up as duplicated assurances, brittle snapshots, trivial forwarding tests,
large mock arrangements, slow feedback, or tests that fail after harmless
refactors. Remove or consolidate tests with those costs when their confidence
is preserved.

Coverage shows which code executed, not whether the test checked correct results.
Inspect meaningful uncovered branches and honor an existing coverage policy.
Do not impose 100% coverage or add tests only to meet a number. Property-based
tests can explore input spaces and shrink failures; introduce Hypothesis only
when useful invariants justify the dependency. Mutation testing can assess
assertion strength in critical logic, but is an optional focused tool, not a
mandatory project-wide gate.

## Make each test easy to read

Use Arrange–Act–Assert: establish the relevant state, perform one behavior,
and check the result. Separate phases with blank lines; add comments only when
they help. A scenario may need several related assertions. Split unrelated
behaviors into different tests.

Compute expected results independently of the production algorithm. Do not call
the implementation to produce its own expected value. Use names and failure
messages that explain the case. Keep important inputs and expected results in
the test body. A little readable duplication is better than a helper maze,
opaque fixture, or test function full of conditions and loops.

```python
import pytest

from example.counts import total_items


@pytest.mark.parametrize(
    ("batches", "items_per_batch", "expected"),
    [(0, 3, 0), (2, 3, 6)],
    ids=["no-batches", "two-batches"],
)
def test_total_items(batches: int, items_per_batch: int, expected: int) -> None:
    """Check empty and populated collections of equal batches.

    Args:
        batches: Number of batches in the case.
        items_per_batch: Number of items in each batch.
        expected: Independently specified total for the case.
    """
    actual = total_items(batches, items_per_batch)

    assert actual == expected


def test_negative_batch_count_is_rejected() -> None:
    """Reject an invalid count before calculating a total."""
    with pytest.raises(ValueError, match="Counts must be zero or greater"):
        total_items(-1, 3)
```

`example.counts` represents the project's public module. Keep pytest parameter
names, fixture types, and docstrings consistent. Use the existing test framework
in an established project rather than rewriting it to match this example.

## Python fixtures and external boundaries

- Use `tmp_path` for files and directories; avoid fixed machine paths or a user's
  real files. Check contents and relevant failure behavior.
- Use `monkeypatch.setenv` and `delenv` for environment-dependent behavior, and
  patch a name where the code under test looks it up. These changes are restored
  automatically. Control clocks and random sources with a typed injected value
  or a narrow patch. Avoid arbitrary sleeps and retrying flaky tests into success.
- Use small fixtures with a clear lifetime. Release resources with context
  managers or `yield` plus `finally`. Avoid autouse fixtures that hide important
  state and broad fixture sharing that makes tests depend on execution order.
- Prefer real pure collaborators and isolated real resources. For expensive or
  remote boundaries, use a maintained fake or a narrow mock. A local fake is not
  proof that a real database or service behaves the same; add a contract or
  integration check where that difference matters.
- Prefer typed test doubles implementing the needed protocol. If a mock is
  appropriate, use `autospec` or `spec_set` when supported and verify only
  interactions that are part of the behavior's contract. Do not bypass strict
  typing for all tests to accommodate an untyped mock.
- Test exceptions with their specific type and meaningful message or attributes.
  Use `caplog` or `capsys` for logging or output only when that output is part of
  the contract. Avoid broad exception assertions that also accept test mistakes.
- Install async test support only when needed. Use the framework's event-loop
  fixtures, await work, and check cancellation or cleanup when required. Keep
  ordinary tests independent of live accounts, uncontrolled networks, and
  wall-clock timing. Separate intentional service tests with registered markers.

For example, environment and file fixtures can stay explicit:

```python
from pathlib import Path

import pytest

from example.settings import load_settings


def test_config_is_read_from_the_selected_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Read the configured directory without changing the real environment.

    Args:
        tmp_path: Isolated directory for this test.
        monkeypatch: Fixture that restores environment changes after the test.
    """
    config = tmp_path / "settings.txt"
    config.write_text("attempts=2\n", encoding="utf-8")
    monkeypatch.setenv("APP_CONFIG_DIR", str(tmp_path))

    actual = load_settings()

    assert actual.attempts == 2
```

Here `example.settings.load_settings` represents the project's public loader
that reads `APP_CONFIG_DIR`. For a resource fixture, keep cleanup unconditional:

```python
from collections.abc import Iterator
import sqlite3

import pytest


@pytest.fixture
def database() -> Iterator[sqlite3.Connection]:
    """Provide an isolated SQLite database and close it after the test.

    Yields:
        An empty in-memory connection for the current test.
    """
    connection = sqlite3.connect(":memory:")
    try:
        yield connection
    finally:
        connection.close()
```

Use this fixture for SQLite behavior. It does not establish compatibility with
a different production database. Typed doubles can also stay small:

```python
from dataclasses import dataclass, field
from typing import Protocol


class Sender(Protocol):
    """Accept a notification for delivery."""

    def send(self, message: str) -> None:
        """Deliver a notification.

        Args:
            message: Text to deliver to the recipient.
        """
        ...


@dataclass
class RecordingSender:
    """Record delivered messages without contacting a service.

    Attributes:
        messages: Delivered text in delivery order.
    """

    messages: list[str] = field(default_factory=list)

    def send(self, message: str) -> None:
        """Record a delivered notification.

        Args:
            message: Text to deliver to the recipient.
        """
        self.messages.append(message)
```

Pass `RecordingSender` to application code that accepts `Sender`. Assert the
externally meaningful notifications, not unrelated internal calls. Keep a real
service integration test when delivery or service compatibility is a material
part of the contract.

## Sources

- [Martin Fowler: test-driven development](https://martinfowler.com/bliki/TestDrivenDevelopment.html)
  and [practical test pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)
- [Google: testing overview](https://abseil.io/resources/swe-book/html/ch11.html),
  [unit tests](https://abseil.io/resources/swe-book/html/ch12.html), and
  [test doubles](https://abseil.io/resources/swe-book/html/ch13.html)
- [pytest good practices](https://docs.pytest.org/en/stable/explanation/goodpractices.html),
  [parametrization](https://docs.pytest.org/en/stable/how-to/parametrize.html),
  [fixtures](https://docs.pytest.org/en/stable/how-to/fixtures.html),
  [temporary paths](https://docs.pytest.org/en/stable/how-to/tmp_path.html),
  [monkeypatch](https://docs.pytest.org/en/stable/how-to/monkeypatch.html), and
  [assertions](https://docs.pytest.org/en/stable/how-to/assert.html)
- [Python mock specifications](https://docs.python.org/3/library/unittest.mock.html#autospeccing)
- [Hypothesis introduction](https://hypothesis.readthedocs.io/en/latest/tutorial/introduction.html)
