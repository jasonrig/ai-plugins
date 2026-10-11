# Codex plugin marketplace

This repository holds a catalog of Codex plugins and the files that each plugin
provides: skills, MCP server settings, command hooks, and display metadata.
`marketplace.config.json` selects the plugins available through the marketplace.
Each package lives in `plugins/<name>/`.

The repository also contains tools to create plugin packages, generate the
manifests Codex reads, and check that the catalog matches the packages on disk.
GitHub CI validates the files against schemas and tests discovery, installation,
and removal with the Codex CLI. The checks use Codex **0.162.1**.

## Create a plugin

Use Node.js **24.15 or newer**. From the repository directory, run:

```sh
npm ci
npm run plugin:new -- my-plugin
```

The command creates the package, adds its catalog entry, and generates its Codex
manifest. Edit these files:

| File                                          | What to put in it                                     |
| --------------------------------------------- | ----------------------------------------------------- |
| `plugins/my-plugin/plugin.config.json`        | Plugin description, version, and optional metadata    |
| `plugins/my-plugin/skills/my-plugin/SKILL.md` | When to use the skill and the steps Codex must follow |
| `marketplace.config.json`                     | Category and authentication policy                    |

Replace the starter skill instructions with the task you want Codex to perform.
For another skill in the same plugin, add `skills/<skill-name>/SKILL.md`. Each
skill starts with a name and description:

```markdown
---
name: my-plugin
description: Use when the user asks for the specific task this skill handles.
---

Write the task instructions here.
```

Use lowercase letters, numbers, and single hyphens for names, up to 64 characters.
The plugin name must match its directory and catalog entry. The skill name must
match its own directory. Use a version such as `0.1.0`, and increase it when you
release a change.

## Check and publish changes

After you change a package or the catalog, run:

```sh
npm run generate
npm run format
npm run check
npm run test:codex
```

Review and commit the authored files and generated files, then push to GitHub.
`generate` updates `.agents/plugins/marketplace.json`, each package's
`.codex-plugin/plugin.json`, and the MCP files when needed. Run the command to
update these outputs whenever their inputs change.

`check` validates schemas, package names, versions, component paths, and the
catalog inventory. It also checks TypeScript, documentation, formatting, unit
tests, and generated files. A package that is missing from the catalog fails the
check. A catalog entry whose package is missing also fails.

`test:codex` checks the repository through the real CLI in a temporary Codex home.
It also uses separate test packages to check skills, MCP settings, and hooks.
These tests need no account login or API key. Test each skill's behavior, MCP
connection, and hook command separately before you rely on it.

## Curate the catalog

Edit `marketplace.config.json` to change the marketplace identity, plugin category,
or policy. Every directory under `plugins/` must have exactly one catalog entry.
Keep unfinished packages outside that directory until you want to include them.

To remove a plugin from the marketplace, delete its package directory and catalog
entry, then regenerate and check the files. To rename a plugin, update its
directory, `plugin.config.json`, and catalog entry together.

## Use the marketplace in Codex

These commands assume that Codex is installed and available as `codex`. Register
the GitHub repository:

```sh
codex plugin marketplace add https://github.com/jasonrig/ai-plugins.git
```

Git must have access to the repository. For local development, register your
checkout instead:

```sh
codex plugin marketplace add "$PWD"
```

List the available plugins and install one by its catalog name:

```sh
codex plugin list --available --marketplace personal-plugins
codex plugin add my-plugin@personal-plugins
```

Replace `my-plugin` with the plugin you want. If you rename the marketplace, use
its new name instead of `personal-plugins`. To remove an installed copy, run:

```sh
codex plugin remove my-plugin@personal-plugins
```

## Add MCP servers and hooks

Add MCP server definitions to `plugins/<name>/mcp.config.json`. For example:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "example": {
      "type": "stdio",
      "command": "node",
      "args": ["./servers/example.mjs"]
    }
  }
}
```

Include `servers/example.mjs` in the package. Commands run from the plugin root
unless you set `cwd`. Remote servers use `streamable-http` with a URL and optional
headers. Read secrets from the process environment. Variable substitutions in
settings and legacy SSE are not supported.

For command hooks, set `extensions.com.openai.hooks` in `plugin.config.json` to a relative
hook file path, such as `./hooks.json`, or an inline hook object. Set
`extensions.com.openai.interface` for display metadata. Include any icons, logos,
or screenshots that it references.

See [OpenAI's plugin guide](https://developers.openai.com/plugins/build/plugins)
for component examples. This repository supports local packages with the
components above. Apps, external package sources, and custom skill directories
are not supported.

## Maintain the validation tools

GitHub CI runs schema and inventory checks, regenerates schemas from pinned Codex
source, and runs CLI integration tests on each push and pull request. A weekly
test also checks the latest Codex release.

See [Marketplace maintenance](docs/maintenance.md) for dependency updates, schema
extraction, Codex upgrades, and changes to the validator.
