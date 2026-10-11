# Project setup and typing integrations

## Inspect before changing configuration

Read repository guidance, dependency declarations and locks, Python version
constraints, source imports, test configuration, and existing CI or hooks. Run
the existing checks to establish a baseline. Record the commands and scope.

Discuss the adoption scope with the user. Default to new and changed code in an
existing project. Run mypy on complete affected modules and their dependencies;
a check of changed lines cannot establish type correctness. Attribute diagnostics
to the agreed scope and report the remaining failures. Avoid blanket ignores,
excluding changed modules, or weakening a clean module to accommodate old code.

For a new project, use the user's chosen Python target and uv:

```sh
uv init --package
uv add --dev mypy ruff pytest
```

Verify latest stable releases against the package registry before accepting the
resolved dependencies. Check the installed versions and lock. Commit `uv.lock`
and the dependency declarations. Use `uv sync --locked` to reproduce them.
Do not select version numbers from memory or edit resolved versions or hashes.
All package installations and dependency changes in a uv-managed project must
use uv commands. Use `uv add` for runtime packages, `uv add --dev` for development
tools and stubs, and `uv remove` for removals. Change declared requirements with
`uv add`. Use `uv lock --upgrade-package <package>` for a targeted update or
`uv lock --upgrade` for all updates within the declared requirements, followed
by locked synchronization. An update within existing constraints does not prove
that the latest release was selected. Do not edit `pyproject.toml` dependency
tables or `uv.lock` directly. Editing `[tool.*]`
configuration is separate from changing package declarations. A successful
`uv pip install` alone does not add a dependency to the project's declarations.
Respect real application constraints; explain an incompatibility rather than
silently selecting older tools. For an existing non-uv project, use its manager's
development group, environment commands, and reproducible lock mechanism.

## Discover special typing requirements

Perform this check for the project's actual dependencies and imports, including
libraries used through a framework. Do not rely on a fixed package list.

1. Identify each relevant distribution, installed version, and import namespace.
   Inspect existing plugin entries and missing-import diagnostics. Distribution
   and import names can differ.
2. Read current documentation from the library or typing-integration maintainer
   for that version. Check whether typing is bundled, supplied by a stub package,
   handled by mypy itself, or provided by a separate plugin. Check decorators,
   generated models, custom fields, and dynamic APIs that ordinary annotations
   may not describe.
3. Verify Python, runtime library, mypy, and integration compatibility. Check
   optional extras and required plugin settings. Detect deprecated integrations
   and conflicting stubs. Do not add a plugin merely because an older guide did.
4. Add required stubs and checker plugins through the project's package manager.
   Run mypy in the same environment as the dependencies and plugins. Keep a
   dependency in the runtime group if its documented use also runs in production.
   Preserve existing plugin entries; do not replace the whole list.
5. In an isolated workspace, check a small representative valid example and a
   deliberate type error through the effective configuration. Use
   `--no-incremental` or separate caches for these probes. Require useful type
   diagnostics, not only a successful import or a zero exit status.
6. Report the installed support, verification, and any remaining limits. If
   maintained typing support is unavailable, prefer a small accurate stub or a
   typed boundary with runtime validation. Explain narrowly scoped exceptions;
   never globally enable `ignore_missing_imports` or skip imports to hide `Any`.

A library may need no extra package: mypy understands standard dataclasses.
A plugin may be bundled with its runtime library: Pydantic provides
`pydantic.mypy`, and its constructor options need review to avoid permissive
`Any` parameters. These illustrate the discovery process, not a supported
package catalogue. Consult the relevant maintainer again for other libraries.

## Apply the effective configuration

The [template](../assets/pyproject-quality.toml) contains quality settings, not
a complete project manifest. Merge the needed tables; do not overwrite an
existing `pyproject.toml` or append duplicate tables. Retain project metadata,
dependencies, plugins, and unrelated settings. Use a TOML editor that preserves
comments if applying edits programmatically.

Mypy searches for `mypy.ini`, `.mypy.ini`, `pyproject.toml`, and `setup.cfg` in
that order; it does not merge these files. Update the active file or use an
explicit `--config-file`. Inspect module overrides that can cancel strict
settings. Translate the template to INI when that is the project's active format.

Ruff uses the closest applicable configuration and does not implicitly merge
parent settings. Inspect nested configurations and explicit `extend` settings.
Set its Python target from the project's minimum version; align mypy's Python
version and supported runtimes. Keep an established consistent formatting and
docstring convention during incremental adoption unless a migration is agreed.
Apply pytest settings only to pytest projects. In unittest projects, retain the
assertion API and omit pytest migration rules such as `PT009` rather than
converting tests just to satisfy the preset. Explain each narrow adaptation.
Install the new package in its environment; avoid `sys.path` changes that conceal
packaging errors.

## Sources

- [uv projects](https://docs.astral.sh/uv/guides/projects/),
  [development dependencies](https://docs.astral.sh/uv/concepts/projects/dependencies/),
  and [locked environments](https://docs.astral.sh/uv/concepts/projects/sync/)
- [Mypy package typing](https://mypy.readthedocs.io/en/stable/installed_packages.html),
  [plugins](https://mypy.readthedocs.io/en/stable/extending_mypy.html), and
  [configuration](https://mypy.readthedocs.io/en/stable/config_file.html)
- [Built-in dataclass support](https://mypy.readthedocs.io/en/stable/additional_features.html)
- [Pydantic typing integration](https://docs.pydantic.dev/latest/integrations/mypy/)
- [Ruff configuration](https://docs.astral.sh/ruff/configuration/)
