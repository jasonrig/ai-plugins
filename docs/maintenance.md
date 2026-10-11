# Marketplace maintenance

Use this guide when you change the validation tools, regenerate schemas, or update
the supported Codex version. For creating and using plugins, see the
[README](../README.md).

## How schema validation works

There is no published marketplace JSON Schema used as a reference here. We derive
one from the input types in the pinned Codex source:

1. Read four source files from a fixed Git commit. Check each file's SHA-256 hash.
2. Parse Rust syntax with `syn`. Select `RawMarketplaceManifest`,
   `RawPluginManifest`, and `HooksFile`, then follow their type dependencies.
3. Keep Serde field names, tags, defaults, and optional fields. Add Schemars derives.
4. Generate JSON Schema Draft 2020-12. Save the schemas and their provenance.
5. Use Ajv to validate marketplace, compatibility, extension, and hook data.

The extractor compiles a small standalone crate. It does not build the Codex CLI
or edit the upstream source. It fails if a required type or expected fallback
changes, or a type dependency is missing. Its Cargo dependencies are locked.

Codex's input parser accepts some bad input so it can ignore it and issue a warning.
A direct schema export would preserve those permissive fallbacks. The extractor
therefore applies three explicit rules for this repository:

- Exclude `Unsupported(JsonValue)` and `Invalid(JsonValue)` variants **from the
  schema only**. Do not change Serde parsing.
- Reject unknown fields in extracted structs and enums.
- Exclude catalog fallback metadata. Put package metadata in `plugin.json`.

These are **source-derived schemas with stricter repository rules**, not official
OpenAI schemas or a complete description of every input the CLI will tolerate.
Unit tests check that these rules reject input that would otherwise be ignored.
CLI tests provide the separate check that valid repository output works in Codex.

The portable plugin and MCP input schemas are vendored from Agent Plugins 1.0.0.
Generated native MCP settings also pass Codex's published configuration schema at
the same source commit. Published files retain their original bytes. Their hashes
and URLs are in `schemas/upstream.lock.json`. Validation never fetches a schema
named by an authored `$schema` field.

## Regenerate or reuse the extractor

Install Rust **1.95.0**, including Cargo. Then run:

```sh
npm run schema:extract
npm run schema:check
```

`extract` updates checked-in schemas. `check` regenerates into a temporary directory
and compares every output byte. It fails on changed or unexpected files.

Both commands can use a local Codex checkout:

```sh
npm run schema:check -- --source-dir /path/to/codex
```

The selected files must match the lock file, even with a local checkout. The tool
first copies and verifies them, then builds from that verified copy. The default
downloads only the four files and caches them in `.cache/codex/<commit>/`.

A Git submodule is optional. It is useful if you want to browse the full upstream
source or maintain patches. It is not required here because it would add a full
source checkout to each clone. If you add one, pass its directory to `--source-dir`.
The lock file remains the authority for the exact extraction inputs.

To update Codex:

1. Choose a release and resolve its tag to a full commit SHA.
2. Update `@openai/codex`, the npm lock file, and `schemas/codex-source.lock.json`.
   Record hashes of the source files at that commit.
3. Refresh the vendored Codex configuration schema and its upstream lock entry.
4. Run `npm run schema:extract`. Review the schema diff and any extractor changes.
5. Run the code checks, `npm run schema:check`, and `npm run test:codex`.
6. Update the source-directory commit in the CI workflow and the version in the
   project README.

The weekly latest-version test reports compatibility changes. It does not change
the source pin or automatically approve a new schema.

## TypeScript documentation rules

Use TSDoc-style `/** ... */` comments for module constants, named functions,
classes, public methods and fields, interfaces, and type aliases. Each comment
must start with a nonempty purpose description. Functions must document their
parameters with `@param` and their results with `@returns` when they return a value.
Describe important side effects and failure conditions where they affect callers.

Oxlint uses the published `eslint-plugin-jsdoc` rules through its
[JS plugin support](https://oxc.rs/docs/guide/usage/linter/js-plugins.html).
The rules require comments and descriptions, check parameter names and tags, and
require descriptions for parameters and return values. Keep types in TypeScript
declarations rather than comment tags. Use `@typeParam` to describe generic type
parameters. These are standard plugin rules, with no custom rule implementation.

Named internal helpers and module constants follow the same policy. This covers
declarations exported in a separate statement without relying on the plugin's
export filter. Inline callbacks do not need separate comments. Empty blocks and
tag-only comments do not satisfy the requirement.

For example:

```typescript
/**
 * Read JSON without allowing duplicate keys to hide an authored entry.
 *
 * @param file - Path to the UTF-8 JSON file.
 * @returns Parsed data that the caller must validate before use.
 * @throws If the file cannot be read, its JSON is invalid, or keys are duplicated.
 */
export async function readJson(file: string): Promise<unknown> {
  // Implementation goes here.
}
```

Run `npm run lint` to check the code. CI runs the same configuration through
`npm run check`.

## Run all required CI checks locally

For normal plugin edits, use the checks in the [README](../README.md). To verify
changes to the validator or extractor, also run the Rust checks below after
`npm run schema:check` has prepared the source cache:

```sh
export CARGO_HOME="$PWD/.cache/cargo"
export CODEX_SCHEMA_SOURCE_DIR="$PWD/.cache/codex/e363b08c9175ac1cbe5893615dd2cb9ddf95043b"
cargo fmt --check --manifest-path tools/codex-schema/Cargo.toml
cargo clippy --locked --all-targets --manifest-path tools/codex-schema/Cargo.toml -- -D warnings
cargo test --locked --manifest-path tools/codex-schema/Cargo.toml
```

Use Rust 1.95.0 to match CI. Set `RUSTUP_TOOLCHAIN=1.95.0` if your default toolchain
uses a different version.

## What CI checks

| Check                      | Failure conditions                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Schema and semantic checks | Wrong types, unknown fields, unsupported components, bad names or versions, invalid skills, missing component paths              |
| Plugin inventory           | A package is unlisted; a declared package is absent; names or paths are duplicated; manifest identity differs                    |
| Generated files            | A catalog, compatibility manifest, or MCP output is missing, stale, or edited by hand                                            |
| Source regeneration        | Source hashes differ; extraction fails; regenerated schemas or provenance differ                                                 |
| Code quality               | TypeScript, strict Oxlint, Prettier, Rust format, Clippy, or unit tests fail                                                     |
| Real Codex                 | Catalog names differ; install or removal fails; metadata, skills, MCP names, or hook events differ; skill parsing reports errors |

Unit tests copy the private marketplace under `test/fixtures/marketplace` into
temporary directories. They do not depend on a plugin or catalog entry in the
published marketplace. They cover both empty and populated catalogs, including
creating the first plugin and removing the last one.

The real CLI test checks a snapshot of your current marketplace against its own
declared inventory. It also checks independent fixtures for an empty marketplace
and a plugin with skills, both MCP transports, and multiple command hooks. These
fixtures keep installation and component coverage active when your catalog is empty.
The CLI must report each registered marketplace. Codex 0.146.0 can omit empty
catalogs from app-server results; populated catalogs must appear with exact plugin
and component inventories.
An invalid source that Codex silently omits proves that the test catches an
omission despite exit code 0. No test uses account credentials or sends a model request.

The three jobs in `Validate marketplace` run on each push and pull request. GitHub
Actions have fixed commit pins and read-only repository permissions. Enable all
three jobs as required branch checks if you want GitHub to block merges on failure.
`Latest Codex compatibility` runs weekly and can also run manually.

## References

- [OpenAI: build plugins](https://developers.openai.com/plugins/build/plugins)
- [Agent Plugins: plugin schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
- [Agent Plugins: MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json)
- [Pinned Codex marketplace parser](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/core-plugins/src/marketplace.rs)
- [Pinned Codex manifest parser](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/core-plugins/src/manifest.rs)
- [Pinned Codex configuration schema](https://github.com/openai/codex/blob/e363b08c9175ac1cbe5893615dd2cb9ddf95043b/codex-rs/core/config.schema.json)

The Codex-derived schemas retain the source notices in
`schemas/upstream/CODEX-LICENSE` and `schemas/upstream/CODEX-NOTICE`.
