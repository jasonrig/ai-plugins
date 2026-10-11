"""Verify the shipped Python quality policy against real tools and examples."""

# Keep the assertion API of this repository's existing unittest runner.
# ruff: noqa: PT009

from __future__ import annotations

import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

from typing_extensions import override


class QualityPolicyTests(unittest.TestCase):
    """Check accepted code and diagnostics using an isolated project per test."""

    @override
    def setUp(self) -> None:
        """Copy the shipped configuration into a temporary project."""
        self._temporary = tempfile.TemporaryDirectory(prefix="python-quality-")
        self.addCleanup(self._temporary.cleanup)
        self._root = Path(self._temporary.name)
        self._preset = (
            Path(__file__).resolve().parents[1] / "assets" / "pyproject-quality.toml"
        ).read_text(encoding="utf-8")
        (self._root / "pyproject.toml").write_text(self._preset, encoding="utf-8")

    def _run(self, tool: str, *arguments: str) -> subprocess.CompletedProcess[str]:
        """Run an installed tool with captured diagnostics.

        Args:
            tool: Module name of the tool in this test environment.
            *arguments: Command arguments for the tool.

        Returns:
            The exit status and output from the tool.
        """
        # The module and arguments come from these tests, never external input.
        return subprocess.run(  # noqa: S603
            [sys.executable, "-m", tool, *arguments],
            cwd=self._root,
            capture_output=True,
            text=True,
            check=False,
        )

    def _write(self, source: str, name: str = "sample.py") -> Path:
        """Save a source example in the isolated project.

        Args:
            source: Python text with optional indentation from the test body.
            name: Relative filename, including a test directory when needed.

        Returns:
            The saved source path.
        """
        target = self._root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(textwrap.dedent(source).lstrip(), encoding="utf-8")
        return target

    def _mypy(self, source: str) -> subprocess.CompletedProcess[str]:
        """Check source without reusing cached results between examples.

        Args:
            source: Python text to type check.

        Returns:
            The mypy exit status and diagnostics.
        """
        target = self._write(source)
        return self._run("mypy", "--no-incremental", str(target))

    def _ruff(
        self, source: str, name: str = "sample.py"
    ) -> subprocess.CompletedProcess[str]:
        """Check an example against the shipped Ruff policy.

        Args:
            source: Python text to check.
            name: Relative filename for applying the normal or test policy.

        Returns:
            The Ruff exit status and diagnostics.
        """
        target = self._write(source, name)
        return self._run("ruff", "check", "--output-format=concise", str(target))

    def test_documented_typed_code_passes_all_checks(self) -> None:
        """Accept a documented function with typed input and a stated failure."""
        target = self._write('''
            """Calculate counts for a collection of batches."""


            def total_items(batches: int, items_per_batch: int) -> int:
                """Return the item count for batches of equal size.

                Args:
                    batches: Number of batches. Must be zero or greater.
                    items_per_batch: Number of items in each batch.

                Returns:
                    The number of items across all batches.

                Raises:
                    ValueError: If either count is negative.
                """
                if batches < 0 or items_per_batch < 0:
                    message = "Counts must be zero or greater"
                    raise ValueError(message)
                return batches * items_per_batch
        ''')
        for tool, arguments in (
            ("mypy", ("--no-incremental", str(target))),
            ("ruff", ("check", str(target))),
            ("ruff", ("format", "--check", str(target))),
        ):
            with self.subTest(tool=tool, arguments=arguments):
                result = self._run(tool, *arguments)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_any_and_untyped_code_are_rejected(self) -> None:
        """Reject explicit, inferred, imported, decorated, and generic Any."""
        self._write("def read():\n    return 1\n", "untyped_vendor.py")
        examples = (
            (
                "from typing import Any\n"
                "def read(value: Any) -> int:\n    return value\n",
                "[explicit-any]",
            ),
            (
                "import json\n"
                "def read(text: str) -> int:\n    return json.loads(text)\n",
                "[no-any-return]",
            ),
            ("def read(values: list) -> int:\n    return len(values)\n", "[type-arg]"),
            ("def read(value):\n    return value\n", "[no-untyped-def]"),
            (
                "from untyped_vendor import read\nvalue: int = read()\n",
                "[no-untyped-call]",
            ),
            (
                "from typing import Any, Callable\n"
                "def decorate(fn: Callable[[int], int]) -> Any:\n    return fn\n"
                "@decorate\ndef read(value: int) -> int:\n    return value\n",
                "[misc]",
            ),
        )
        for source, diagnostic in examples:
            with self.subTest(diagnostic=diagnostic):
                result = self._mypy(source)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn(diagnostic, result.stdout)

    def test_additional_type_checks_are_active(self) -> None:
        """Catch incomplete matches, missing overrides, and uncoded ignores."""
        examples = (
            (
                "from typing import Literal\n"
                'def choose(value: Literal["a", "b"]) -> int:\n'
                '    match value:\n        case "a":\n            return 1\n',
                "[exhaustive-match]",
            ),
            (
                "class Base:\n    def read(self) -> int:\n        return 1\n"
                "class Child(Base):\n    def read(self) -> int:\n        return 2\n",
                "[explicit-override]",
            ),
            ('value: int = "bad"  # type: ignore\n', "[ignore-without-code]"),
            (
                "import asyncio\nasync def read() -> int:\n    return 1\n"
                "def start() -> None:\n    asyncio.create_task(read())\n",
                "[unused-awaitable]",
            ),
            ("def read() -> int:\n    return 1\n    return 2\n", "[unreachable]"),
        )
        for source, diagnostic in examples:
            with self.subTest(diagnostic=diagnostic):
                result = self._mypy(source)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn(diagnostic, result.stdout)

    def test_builtin_dataclass_typing_needs_no_extra_plugin(self) -> None:
        """Accept a typed dataclass and reject an invalid constructor argument."""
        source = (
            "from dataclasses import dataclass\n"
            "@dataclass\nclass Batch:\n    count: int\n"
        )
        accepted = self._mypy(source + "batch = Batch(count=1)\n")
        rejected = self._mypy(source + 'batch = Batch(count="bad")\n')
        self.assertEqual(accepted.returncode, 0, accepted.stdout + accepted.stderr)
        self.assertEqual(rejected.returncode, 1, rejected.stdout + rejected.stderr)
        self.assertIn("[arg-type]", rejected.stdout)

    def test_pydantic_plugin_enforces_constructor_types(self) -> None:
        """Verify one plugin integration, including its extra strictness options."""
        configuration = self._preset.replace(
            "[tool.mypy]\n", '[tool.mypy]\nplugins = ["pydantic.mypy"]\n', 1
        )
        configuration += """
[tool.pydantic-mypy]
init_typed = true
init_forbid_extra = true
warn_required_dynamic_aliases = true
"""
        (self._root / "pyproject.toml").write_text(configuration, encoding="utf-8")
        source = (
            "from pydantic import BaseModel\nclass Batch(BaseModel):\n    count: int\n"
        )
        accepted = self._mypy(source + "batch = Batch(count=1)\n")
        self.assertEqual(accepted.returncode, 0, accepted.stdout + accepted.stderr)
        for expression, diagnostic in (
            ('Batch(count="bad")', "[arg-type]"),
            ("Batch(count=1, unexpected=True)", "[call-arg]"),
        ):
            with self.subTest(expression=expression):
                rejected = self._mypy(source + f"batch = {expression}\n")
                self.assertEqual(
                    rejected.returncode, 1, rejected.stdout + rejected.stderr
                )
                self.assertIn(diagnostic, rejected.stdout)

    def test_external_stubs_provide_real_type_information(self) -> None:
        """Verify one stub integration without making any network request."""
        source = (
            "import requests\n"
            'response = requests.get("https://example.invalid", timeout=1)\n'
        )
        accepted = self._mypy(source + "status: int = response.status_code\n")
        rejected = self._mypy(source + "status: str = response.status_code\n")
        self.assertEqual(accepted.returncode, 0, accepted.stdout + accepted.stderr)
        self.assertEqual(rejected.returncode, 1, rejected.stdout + rejected.stderr)
        self.assertIn("[assignment]", rejected.stdout)

    def test_public_docstrings_are_required(self) -> None:
        """Require module, class, function, method, and property documentation."""
        result = self._ruff("""
            class Batch:
                def count(self) -> int:
                    return 1

                @property
                def size(self) -> int:
                    return 1


            def total() -> int:
                return 1
        """)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        for diagnostic in (
            "undocumented-public-module",
            "undocumented-public-class",
            "undocumented-public-method",
            "undocumented-public-function",
        ):
            self.assertIn(diagnostic, result.stdout)

    def test_docstring_sections_match_the_function(self) -> None:
        """Require parameter, return, yield, and explicit exception sections."""
        examples = (
            (
                '''
                """Read a count."""
                def read(count: int) -> int:
                    """Calculate the next count.

                    Args:
                        other: The count.
                    """
                    return count + 1
                ''',
                (
                    "undocumented-param",
                    "docstring-extraneous-parameter",
                ),
            ),
            (
                '''
                """Read a count."""
                def read(count: int) -> int:
                    """Calculate the next count.

                    Args:
                        count: The current count.
                    """
                    return count + 1
                ''',
                ("docstring-missing-returns",),
            ),
            (
                '''
                """Check counts."""
                def check(count: int) -> None:
                    """Check a count.

                    Args:
                        count: The count to check.
                    """
                    if count < 0:
                        message = "Negative count"
                        raise ValueError(message)
                ''',
                ("docstring-missing-exception",),
            ),
            (
                '''
                """Provide counts."""
                from collections.abc import Iterator
                def counts() -> Iterator[int]:
                    """Provide the next count."""
                    yield 1
                ''',
                ("docstring-missing-yields",),
            ),
            (
                '''
                """Provide a count."""
                def read() -> int:
                    """Return a count.

                    Returns:
                        The count.

                    Yields:
                        A count.

                    Raises:
                        ValueError: If the count is negative.
                    """
                    return 1
                ''',
                ("docstring-extraneous-yields", "docstring-extraneous-exception"),
            ),
            (
                '''
                """Check a count."""
                def check() -> None:
                    """Check the count.

                    Returns:
                        The count.
                    """
                    values: list[int] = []
                    values.append(1)
                ''',
                ("docstring-extraneous-returns",),
            ),
        )
        for source, diagnostics in examples:
            with self.subTest(diagnostics=diagnostics):
                result = self._ruff(source)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                for diagnostic in diagnostics:
                    self.assertIn(diagnostic, result.stdout)

    def test_test_exceptions_are_narrow(self) -> None:
        """Allow test assertions and expected literals while retaining doc rules."""
        source = '''
            """Check the batch count."""


            def test_count() -> None:
                """Keep the count unchanged when reading it."""
                count = 3

                actual = count

                assert actual == 3
        '''
        accepted = self._ruff(source, "tests/test_count.py")
        self.assertEqual(accepted.returncode, 0, accepted.stdout + accepted.stderr)
        rejected = self._ruff(source, "production.py")
        self.assertEqual(rejected.returncode, 1, rejected.stdout + rejected.stderr)
        self.assertIn("assert", rejected.stdout)
        missing_docs = self._ruff(
            "def test_count() -> None:\n    assert 1 == 1\n", "tests/test_missing.py"
        )
        self.assertEqual(
            missing_docs.returncode, 1, missing_docs.stdout + missing_docs.stderr
        )
        self.assertIn("undocumented-public-function", missing_docs.stdout)

    def test_object_and_field_documentation_need_review(self) -> None:
        """Confirm the limits that the skill assigns to human or agent review."""
        typed = self._mypy("def receive(value: object) -> object:\n    return value\n")
        self.assertEqual(typed.returncode, 0, typed.stdout + typed.stderr)
        documented = self._ruff('''
            """Hold a batch count."""


            class Batch:
                """Store the count for a batch."""

                count: int = 1
        ''')
        self.assertEqual(
            documented.returncode, 0, documented.stdout + documented.stderr
        )

    def test_pytest_configuration_runs_a_real_test(self) -> None:
        """Run pytest with the shipped discovery and strict configuration."""
        self._write(
            '''
            """Check counts using pytest."""


            def test_count() -> None:
                """Report the item count for two equal batches."""
                batches = 2
                items_per_batch = 3

                actual = batches * items_per_batch

                assert actual == 6
        ''',
            "tests/test_count.py",
        )
        result = self._run("pytest", "-q")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("1 passed", result.stdout)

    def test_pytest_rejects_unregistered_markers_and_unknown_settings(self) -> None:
        """Reject silent mistakes in pytest markers and configuration names."""
        self._write(
            """
            import pytest

            @pytest.mark.unregistered
            def test_count() -> None:
                assert 1 == 1
        """,
            "tests/test_count.py",
        )
        marker = self._run("pytest", "-q")
        self.assertEqual(marker.returncode, 2, marker.stdout + marker.stderr)
        self.assertIn("unregistered", marker.stdout)

        self._write(
            "def test_count() -> None:\n    assert 1 == 1\n", "tests/test_count.py"
        )
        (self._root / "pyproject.toml").write_text(
            self._preset + "\nunknown_setting = true\n", encoding="utf-8"
        )
        configuration = self._run("pytest", "-q")
        self.assertEqual(
            configuration.returncode, 4, configuration.stdout + configuration.stderr
        )
        self.assertIn("Unknown config option", configuration.stderr)

    def test_policy_test_code_satisfies_the_shipped_checks(self) -> None:
        """Keep these tests typed, documented, linted, and consistently formatted."""
        source = str(Path(__file__).resolve())
        configuration = str(self._root / "pyproject.toml")
        for tool, arguments in (
            ("mypy", ("--no-incremental", "--config-file", configuration, source)),
            ("ruff", ("check", "--config", configuration, source)),
            ("ruff", ("format", "--check", "--config", configuration, source)),
        ):
            with self.subTest(tool=tool, arguments=arguments):
                result = self._run(tool, *arguments)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
