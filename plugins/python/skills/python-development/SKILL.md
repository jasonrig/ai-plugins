---
name: python-development
description: Develop or refactor Python code with strict mypy and Ruff checks, useful public docstrings, and focused behavior tests. Use for Python implementation, bug fixes, project quality setup, or test design.
---

# Python development

Write Python changes that a human can read, maintain, and verify. Keep each
change focused on the requested behavior. Add abstractions only when current
requirements justify them.

## Establish the project requirements

Before implementation, inspect repository instructions, the dependency manager,
supported Python versions, effective tool configuration, and existing tests.

- New projects must use uv. Install mypy, Ruff, and pytest as development
  dependencies with `uv add --dev mypy ruff pytest`. All package additions,
  removals, and updates in a uv project must use uv commands. Never edit
  `pyproject.toml` dependency declarations or `uv.lock` by hand. Verify current
  releases; never guess versions. Direct tool-configuration edits are permitted.
- Keep an existing project's manager, layout, and test framework. Provide the
  closest equivalent checks without requiring a uv migration.
- Review dependencies and imports for **any library or framework that needs
  special typing treatment**. Consult its current maintainer guidance for the
  installed version. Verify native types, required stubs or plugins, plugin
  settings, and compatibility. Do not assume that a familiar integration is
  still needed or supported.
- Discuss adoption with the user. Normally enforce these requirements on new and
  changed code first. Identify existing failures separately and avoid unrelated
  cleanup. Do not call a partly checked project clean.

Read [tooling](references/tooling.md) for setup, typing integration discovery,
and adoption. Apply the [quality template](assets/pyproject-quality.toml) by
merging relevant settings into the project's effective configuration. Preserve
unrelated configuration and existing integrations.

## Implement and verify behavior

Use a small test-first change for new behavior or a bug fix. Confirm that the
test fails for the intended reason, implement the behavior, then improve the
code and tests while they pass. Use characterization tests before changing
uncertain existing behavior. Documentation-only edits do not need invented tests.

Read [testing](references/testing.md) when choosing test scope, cases, fixtures,
or test doubles. Prefer observable behavior, independent expected results, and
clear Arrange–Act–Assert structure. Avoid tests that duplicate implementation,
assert private call sequences, or exist only to increase a coverage figure.

Use strict typing and supported Ruff rules. Prefer precise types; do not use
`Any`, broad `object` annotations, casts, ignores, or catch-all exceptions to
hide an unresolved contract. Explain any narrow exception that a library or
standard interface actually requires.

Read [types and documentation](references/types-and-docstrings.md) before adding
or changing public interfaces. Require public docstrings to the extent supported
by Ruff. Review field documentation, wording, accuracy, and justified uses of
`object`; automated checks cannot enforce all of these requirements.

## Keep the quality gains

Run formatting checks, Ruff, mypy, and relevant tests through the project
environment. Report the checked scope, results, remaining failures, and any
typing limitations. Review the diff for unnecessary layers, fallback paths,
dependencies, and boilerplate.

Once the project is clean, discuss CI and/or pre-commit enforcement with the
user. Read [quality gates](references/quality-gates.md) for ready examples that
use locked dependencies. Extend existing automation after that discussion.
