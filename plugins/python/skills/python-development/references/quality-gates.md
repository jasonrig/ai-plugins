# Keep the checks in daily use

## Agree on enforcement

Run the agreed checks during development. State the paths, interpreter,
environment, results, and remaining failures. A passing changed-module check
does not establish that the whole project is clean.

When the project is clean, discuss CI and/or pre-commit enforcement with the
user. Prepare a concrete change for the existing provider and repository layout.
Keep that discussion separate from ordinary implementation: using this skill
does not automatically authorize adding workflows, installing Git hooks, or
changing branch protection.

Use one effective configuration and the project's locked tool versions locally,
in hooks, and in CI. Include required typing plugins, runtime packages, and stubs
in the checker environment. Do not use an isolated mypy hook that cannot see them.
Keep the supported Python versions aligned with the application. Add a runtime
matrix when the project supports multiple versions and behavior can differ.

## Check commands

For a new uv project with code in `src/` and tests in `tests/`:

```sh
uv sync --locked
uv run --locked ruff format --check .
uv run --locked ruff check .
uv run --locked mypy src tests
uv run --locked pytest
```

Replace the paths with the project's actual checked modules. Include other
maintained Python entrypoints when relevant. If mypy has configured `files`,
omit CLI paths and use those same files in each environment. Use equivalent
locked-environment commands for the existing dependency manager and framework.

Check formatting and lint without modifying files in CI. For local fixes, review
`ruff check --fix` and `ruff format` changes; do not enable unsafe fixes by default.
Run fast relevant tests while editing, then the affected broader suite. Do not
add full integration tests to every commit hook just because CI runs them.

## CI steps

After the existing workflow checks out the project and prepares its supported
Python interpreter and uv, these GitHub Actions steps are ready to adapt:

```yaml
- name: Install the locked project environment
  run: uv sync --locked
- name: Check formatting
  run: uv run --locked ruff format --check .
- name: Check Python code
  run: uv run --locked ruff check .
- name: Check types
  run: uv run --locked mypy src tests
- name: Test behavior
  run: uv run --locked pytest
```

Use the provider already in the repository. When adding GitHub Actions setup
actions, verify current official releases and pin their full commit hashes; do
not copy guessed versions. Keep permissions minimal and separate intentional
service tests that need credentials or infrastructure. Preserve existing test
and coverage policies rather than imposing a generic percentage.

## Optional pre-commit hooks

If agreed, use `uv add --dev pre-commit` to add it to the project's development
dependency group; use the existing manager for a non-uv project.
Use local hooks so tool versions and typing integrations come from its lock:

```yaml
repos:
  - repo: local
    hooks:
      - id: python-ruff
        name: Check Python code
        language: system
        entry: uv run --locked ruff check
        types: [python]
      - id: python-format
        name: Check Python formatting
        language: system
        entry: uv run --locked ruff format --check
        types: [python]
      - id: python-mypy
        name: Check Python types
        language: system
        entry: uv run --locked mypy src tests
        types: [python]
        pass_filenames: false
```

The mypy hook checks the configured module graph instead of only the staged
filenames. Adapt its paths and manager command with the CI commands. CI still
checks the full intended scope; hooks are convenient local feedback, not the
only gate. Preview with `uv run --locked pre-commit run --all-files`, then install
hooks with `uv run --locked pre-commit install` after the user agrees.

## Update tools without losing enforcement

Update dependencies through the manager and verify current registry releases.
Review upstream rule, plugin, and compatibility changes. Rerun configuration
probes and the project's checks before accepting the lock update. The docstring
preview rules are explicitly selected; do not enable every preview rule to fix
one missing capability. Use narrowly explained exceptions rather than a growing
global ignore list.

## Sources

- [uv CI guidance](https://docs.astral.sh/uv/guides/integration/github/)
  and [locked synchronization](https://docs.astral.sh/uv/concepts/projects/sync/)
- [pre-commit local hooks](https://pre-commit.com/#repository-local-hooks)
  and [hook configuration](https://pre-commit.com/#pre-commit-configyaml---hooks)
- [Mypy import and environment behavior](https://mypy.readthedocs.io/en/stable/running_mypy.html)
- [Ruff safe and unsafe fixes](https://docs.astral.sh/ruff/linter/#fix-safety)
