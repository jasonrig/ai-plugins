# Repository guidance

## Purpose and scope

This repository contains a Codex plugin marketplace and its validation tools.
Keep support focused on Codex. Read [README.md](README.md) for the authoring
workflow and [docs/maintenance.md](docs/maintenance.md) for schema extraction,
dependency updates, and CI details.

## Dependencies

- Install, remove, and update dependencies through their package manager. Use npm
  for this TypeScript project and Cargo for `tools/codex-schema`.
- Never guess, recall from memory, or manually choose dependency version numbers.
  Let the package manager resolve the latest stable release and write the version
  requirements and lock file. Do not hand-edit dependency versions or lock files.
- Verify current releases against the registry when adding or updating packages.
  For npm, use `npm view <package> version` and `npm outdated`. Install with
  `npm install --save-exact <package>@latest`, adding `--save-dev` for development
  dependencies. Preserve npm aliases when updating aliased packages.
- Use Cargo to add dependencies and upgrade their requirements, then refresh
  `Cargo.lock` with `cargo update`. Verify releases against crates.io. An update
  within an existing version requirement does not prove that the requirement
  targets the latest release.
- Use `npm ci` to reproduce the lock file. Successful installation, compilation,
  and tests prove neither that versions are current nor that the latest release
  was selected. Check freshness separately.
- Resolve incompatibilities with the latest release. Do not silently select an
  older version to preserve a runtime minimum that you chose. Keep runtime
  requirements and CI aligned with verified package requirements.
- Respect upstream constraints on transitive dependencies. Do not bypass peer or
  engine checks with `--force`, `--legacy-peer-deps`, or disabled strict settings.
  Report any constraint that prevents using the latest release.
- Inspect relevant Dependabot PRs before reporting that dependencies are current.
  Check their changes and CI results; do not assume that automated updates pass.
- For GitHub Actions, retrieve the latest stable release from the action's
  official repository and resolve its tag to a full commit SHA. Pin that verified
  SHA and record the release in the adjacent comment. Never invent either value.

## Manifests and schemas

- Author the catalog in `marketplace.config.json`, package metadata in
  `plugins/<name>/plugin.config.json`, and MCP settings in `mcp.config.json`.
  A root package `plugin.json` overrides the native Codex manifest and is rejected
  by this repository's checks.
- Use `npm run generate` to update Codex manifests and runtime MCP settings.
  Commit generated files with their inputs. Do not edit generated output by hand.
- Require every published plugin directory to have exactly one catalog entry,
  and every catalog entry to point to an existing package. Preserve checks for
  duplicate names, missing files, and invalid component paths.
- Update the Codex CLI and its source pin together. Resolve the verified release
  tag to its commit, verify source hashes, refresh upstream schema files, and
  regenerate the derived schemas before accepting the upgrade.
- Run `npm run schema:extract` after any extractor or Cargo dependency change.
  Provenance includes the Cargo manifest and lock file. Review the generated diff
  and verify it with `npm run schema:check`.
- Keep vendored schemas byte-for-byte identical to their verified upstream files.
  Preserve source checksums and license notices. Do not weaken validation to make
  an upstream change pass without understanding the change.

## Code, tests, and documentation

- Keep TypeScript strict. Use TSDoc-style purpose comments for functions,
  constants, classes, public members, interfaces, and type aliases. Document
  parameters, return values, and material failure conditions.
- Enforce documentation with supported linter rules. Do not write custom rules
  when an existing supported rule provides the required check.
- Use independent test fixtures. Tests must remain meaningful when published
  plugins are added, renamed, or removed, including the last plugin.
- Keep real Codex integration tests strict: compare complete plugin and component
  inventories, installation, and removal. Exit code zero alone is insufficient.
  Use an isolated Codex home without account credentials or model requests.
- Write the README for practical use: explain the repository's purpose, files,
  and authoring workflow in clear, concise English. Keep implementation details
  in the maintenance guide. Installation instructions assume `codex` is already
  installed; do not substitute `npx` commands.

## Verification and completion

- For code, package, plugin, or catalog changes, run `npm run check` and
  `npm run test:codex`.
- For schema source or extractor changes, also run `npm run schema:check` and
  the Rust formatting, Clippy, and test commands in the maintenance guide.
- For documentation-only changes, run `npm run format:check`.
- Before reporting completion, state what changed, which checks passed, and any
  material limits. If a change is pushed, verify the relevant GitHub CI results.
  Do not describe a local check as a completed remote check.
