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
npm run test:python
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

`test:python` runs the Python tests included with published skills. It
needs Python **3.11 or newer** and [uv](https://docs.astral.sh/uv/getting-started/installation/).
It installs each suite's locked dependencies in an isolated environment.

## Curate the catalog

Edit `marketplace.config.json` to change the marketplace identity, plugin category,
or policy. Every directory under `plugins/` must have exactly one catalog entry.
Keep unfinished packages outside that directory until you want to include them.

To remove a plugin from the marketplace, delete its package directory and catalog
entry, then regenerate and check the files. To rename a plugin, update its
directory, `plugin.config.json`, and catalog entry together.

## Use the marketplace in Codex

In the Codex App, open this repository as a local project and restart the App.
Open the Plugins Directory, select **Personal plugins**, and install the plugin
you want. The App reads the generated `.agents/plugins/marketplace.json` in this
repository. See [OpenAI's marketplace guide](https://developers.openai.com/plugins/build/plugins#build-your-own-curated-plugin-list)
for the App workflow.

For CLI users, the following commands assume that Codex is installed and available
as `codex`. Register the GitHub repository:

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

## IntelliJ plugin

The `intellij` plugin provides a skill to register IntelliJ IDEA's MCP server in
the current project's `.codex/config.toml`. Install **IntelliJ** from **Personal
plugins** in the Codex App's Plugins Directory.

After installation, open a chat in the project you want to connect and ask:
"Use the IntelliJ plugin to register its MCP server for this project." The skill
uses the IDE's Streamable HTTP URL and the project's absolute path. Restart the
App after setup, then open a new chat in the same project to verify the connection.
Each project has its own settings. Installing the plugin does not configure the
connection, and the setup skill does not require the CLI.

The skill uses a Python helper with TOML Kit to preserve existing settings,
comments, and layout. It previews the edit, keeps a backup when updating an
existing file, and replaces the file atomically. The Codex project directory,
IntelliJ project path, port, and server name are separate parameters. The helper
does not edit user-level Codex settings.

For the actual port, server setup, or connection problems, see
[JetBrains' MCP Server documentation](https://www.jetbrains.com/help/idea/mcp-server.html).

### Keep local connection settings out of commits

The IntelliJ port and absolute project path depend on your machine and checkout.
For an untracked local config, add these rules to `.gitignore` in the target
project directory:

```gitignore
/.codex/config.toml
/.codex/config.toml.*.bak
```

Codex still reads the ignored file in a trusted project. Use the repository's
`info/exclude` file for a personal rule that you do not want
to share. Keep the patterns specific so other `.codex/` files can still be
committed. **If the config is already tracked, ignore rules have no effect.**
Git also cannot ignore just its IntelliJ fields. Agree on a local config and
tracked template policy before changing what the repository tracks. See
[GitHub's ignore guidance](https://docs.github.com/en/get-started/git-basics/ignoring-files)
and the skill's [version control guidance](plugins/intellij/skills/register-intellij-mcp/references/version-control.md)
for checks and options. These rules are our recommendation for this local
connection; [OpenAI's project configuration documentation](https://learn.chatgpt.com/docs/config-file/config-advanced#project-config-files-codexconfigtoml)
explains how project settings are loaded.

## Python plugin

The `python` plugin provides the **Python Development** skill for implementing
and maintaining Python code. It uses strict mypy and Ruff checks, useful public
docstrings, and tests focused on observable behavior. It checks the project's
actual libraries for any required typing integrations.

Install **Python** from **Personal plugins** in the Codex App's Plugins Directory.
In a project chat, ask: "Use $python-development to implement this change with
strict typing and focused tests." For a quality setup, ask: "Use
$python-development to review this project's checks and propose an adoption
scope."

New projects use uv with mypy, Ruff, and pytest as development dependencies.
Existing projects keep their manager and test framework. The skill discusses
adoption, normally starting with new and changed code. Once the project is clean,
it can help add CI or pre-commit checks after you agree on the approach.

See the [skill](plugins/python/skills/python-development/SKILL.md) and its
[tested configuration template](plugins/python/skills/python-development/assets/pyproject-quality.toml)
for the requirements and supported checks. Installing the plugin does not edit
project files or install project dependencies.

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
