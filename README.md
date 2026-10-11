# Personal Codex plugin marketplace

Create, curate, and install your own Codex plugins from this repository. The
marketplace starts empty. Keep the GitHub repository private to control who can
access your marketplace.

This marketplace is tested with Codex **0.146.0**.
Plugins can contain skills, MCP servers, command hooks, and display metadata.

## Set up

Clone this repository and open a terminal in its directory. Install Node.js 24 or
newer, then run:

```sh
npm ci
npm run check
npm run test:codex
```

The checks confirm that your plugin files are valid and Codex can list and install
them. They use a temporary Codex home and need no account login or API key. You do
not need Rust for everyday plugin work.

Tests use private fixtures, so the checks remain useful when your marketplace is
empty or you add, rename, or remove your own plugins.

## Install a plugin

These commands assume that Codex is already installed and available as `codex` in
your terminal. [Create a plugin](#create-a-plugin) before installing one. The
examples below use `my-plugin`. Add the marketplace from GitHub:

```sh
codex plugin marketplace add https://github.com/jasonrig/ai-plugins.git
```

For a private repository, Git must already have access through your usual GitHub
credentials.

To use your local checkout instead, run this from the repository directory:

```sh
codex plugin marketplace add "$PWD"
```

List the available plugins, then install one:

```sh
codex plugin list --available --marketplace personal-plugins
codex plugin add my-plugin@personal-plugins
```

Use the name from `marketplace.config.json` if you rename the marketplace. Replace
`my-plugin` with the name of the plugin you want to install.

To uninstall a plugin:

```sh
codex plugin remove my-plugin@personal-plugins
```

## Create a plugin

Run:

```sh
npm run plugin:new -- my-plugin
```

This creates a plugin with a starter skill, adds it to the catalog, and prepares
its Codex files. Edit:

- `plugins/my-plugin/plugin.json`: set a useful description and version.
- `plugins/my-plugin/skills/my-plugin/SKILL.md`: describe when Codex should use the
  skill and give its instructions.

Each skill starts with this form:

```markdown
---
name: my-plugin
description: Use when the user asks for the specific task this skill handles.
---

Write the task instructions here.
```

Make the instructions specific enough for Codex to follow. Replace the starter
text before you publish the plugin. For another skill in the same plugin, add
`skills/<skill-name>/SKILL.md`.

Use lowercase letters, numbers, and single hyphens for names, up to 64 characters.
The plugin name must match its directory and catalog entry. Each skill name must
match its own directory. Use a version such as `0.1.0`, and increase it when you
release a change.

## Check and publish changes

After you add, edit, or remove a plugin, run:

```sh
npm run generate
npm run format
npm run check
npm run test:codex
```

Review and commit both the files you edited and the generated files. Push your
changes to GitHub to run CI. CI checks your work; it does not fix files for you.

The Codex test checks installation and component discovery. Test each skill's
behavior, MCP server connection, and hook command separately before you rely on it.

## Curate the marketplace

Edit `marketplace.config.json` to set the marketplace name and display name, or to
change a plugin's category and authentication policy. The plugin creation command
adds catalog entries for you.

Every directory under `plugins/` must have exactly one catalog entry. Every entry
must point to an existing plugin. Keep work in progress outside `plugins/`, such
as in `drafts/`, until you are ready to include it.

To remove a plugin from the marketplace, delete its directory and catalog entry,
then run the checks above. To remove only your installed copy, use the uninstall
command instead.

An empty marketplace is valid. Set `plugins` to `[]` in the catalog after removing
the last plugin. The `plugins/` directory can be absent; the creation command makes
it when you add your first plugin.

## Files you edit

| File                                     | Purpose                                                          |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `marketplace.config.json`                | Marketplace identity and list of published plugins               |
| `plugins/<name>/plugin.json`             | Plugin name, version, description, and optional display metadata |
| `plugins/<name>/skills/<skill>/SKILL.md` | Skill description and instructions                               |
| `plugins/<name>/mcp.config.json`         | Optional MCP server settings                                     |
| A hook file referenced by `plugin.json`  | Optional command hooks                                           |

`npm run generate` prepares `.agents/plugins/marketplace.json`, each plugin's
`.codex-plugin/plugin.json`, and its `mcp.json` when needed. Update these files by
running the command whenever you change their inputs.

## Add MCP servers or hooks

For an MCP server, add `plugins/<name>/mcp.config.json`. For example:

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

Include `servers/example.mjs` in the plugin. Commands run from the plugin root
unless you set `cwd`. Remote servers can use `streamable-http` with a URL and
optional headers. Use relative paths for package files and process environment
variables for secrets. Variable substitutions in settings and legacy SSE are not
supported.

For a command hook, set `extensions.com.openai.hooks` in `plugin.json` to a relative
hook file path, such as `./hooks.json`, or supply an inline hook object. You can also
set `extensions.com.openai.interface` for display metadata. Include any referenced
icons, logos, or screenshots in the plugin.

See [OpenAI's plugin guide](https://developers.openai.com/plugins/build/plugins)
for component examples. This project supports the components listed above;
external plugin sources, apps, and custom skill directories are not yet supported.

## Fix a failed check

| Message or problem                             | What to do                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Generated file is missing or stale             | Run `npm run generate` and commit its output.                                                  |
| Formatting check fails                         | Run `npm run format`.                                                                          |
| Unlisted plugin directory                      | Add its catalog entry, or move unfinished work outside `plugins/`.                             |
| Missing package, skill, or asset               | Restore the file or correct its path.                                                          |
| Plugin or skill name does not match            | Use the same name in its declaration and directory.                                            |
| Schema validation fails                        | Check the named field for spelling, type, or unsupported settings.                             |
| Missing JSDoc comment or description           | Add a purpose description and document function parameters and results.                        |
| Codex reports different plugins or components  | Check the catalog and referenced files, then rerun generation and the Codex test.              |
| Schema provenance or source regeneration fails | Follow the [maintenance guide](docs/maintenance.md) before changing the source pin or schemas. |

GitHub CI runs code checks, schema regeneration, and real Codex integration on each
push and pull request. Set these three jobs as required branch checks if you want
to block merges when a check fails. A separate weekly check tests the latest Codex
release.

For schema extraction, source pins, Codex upgrades, and validator development, see
[Marketplace maintenance](docs/maintenance.md).
