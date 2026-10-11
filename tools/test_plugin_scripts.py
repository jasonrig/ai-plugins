"""Run each published skill's Python tests with its own locked dependencies."""

import os
import shutil
import subprocess
from pathlib import Path


def main() -> None:
    """Discover optional skill test suites; an empty marketplace has none to run."""
    root = Path(__file__).resolve().parents[1]
    suites = sorted((root / "plugins").glob("*/skills/*/tests"))
    if not suites:
        print("No plugin Python test suites.")
        return
    runner = shutil.which("uv")
    if runner is None:
        raise SystemExit("Install uv to run plugin Python tests")
    environment = os.environ.copy()
    environment.setdefault("UV_CACHE_DIR", str(root / ".cache" / "uv"))
    environment["CODEX_TEST_BINARY"] = str(root / "node_modules" / ".bin" / "codex")
    for suite in suites:
        requirements = suite / "requirements.txt"
        if not requirements.is_file():
            requirements = suite.parent / "scripts" / "requirements.txt"
        if not requirements.is_file():
            raise SystemExit(f"Missing locked dependencies for test suite: {suite}")
        subprocess.run(
            [
                runner,
                "run",
                "--no-project",
                "--python",
                ">=3.11",
                "--with-requirements",
                str(requirements),
                "python",
                "-B",
                "-m",
                "unittest",
                "discover",
                "-s",
                str(suite),
                "-v",
            ],
            cwd=root,
            env=environment,
            check=True,
        )


if __name__ == "__main__":
    main()
