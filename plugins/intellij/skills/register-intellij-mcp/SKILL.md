---
name: register-intellij-mcp
description: Register or repair IntelliJ IDEA's MCP connection for a project in the Codex App. Use when the user asks to connect Codex to IntelliJ or fix that connection.
---

# Register IntelliJ MCP

Assume the user works in the Codex App unless they specify another client.
Configure IntelliJ IDEA's MCP connection for the target local project. This plugin
supplies setup guidance; it does not bundle an MCP server or automatically apply
connection settings when installed. The App reads Codex configuration, including
project-scoped `.codex/config.toml`; a separate CLI installation is not required
for this workflow.

## Choose the project and endpoint

- Use the local project selected for the user's Codex App chat, normally the
  current workspace. Resolve its absolute path. Separately identify the project
  open in IntelliJ; this supplies `IJ_MCP_SERVER_PROJECT_PATH`. For a worktree,
  confirm which checkout IntelliJ has open. The two paths may differ, but must
  identify the intended checkouts. Do not use the installed plugin's directory
  as either project path.
- Read the project's `.codex/config.toml` before editing. Reuse an existing
  IntelliJ MCP entry when present; otherwise use the server name `intellij`.
- Prefer the user's copied **HTTP Stream Config** from IntelliJ's
  **Settings | Tools | MCP Server**. Get the port and project-path header from
  that configuration. The example port below is a template, not a guaranteed
  port for every IDE. If those values are unknown, guide the user to copy them.
- Use Streamable HTTP with `/stream`. Codex supports this transport; do not use
  the legacy SSE `/sse` endpoint. Convert JSON `headers` to TOML `http_headers`;
  Codex infers the HTTP transport from `url`, so omit JSON's `type` field.

## Register the connection

Before saving, read [version control guidance](references/version-control.md).
Check whether the target config is tracked and explain the appropriate exclusions
for local values and backups. Ignore rules cannot hide individual TOML values or
changes to a tracked file. Preserve the project's shared configuration policy.

When the user requests registration or repair, create or update the target
project's `.codex/config.toml`. For an explanation-only request, show the proposed
configuration without writing it. Use the bundled
[TOML Kit editor](scripts/register_mcp.py) to preserve unrelated settings,
comments, and layout. Do not edit TOML with string replacement or rewrite the
whole file from a dictionary. Do not write to `~/.codex/config.toml` or edit the
installed plugin's files.

Resolve `SKILL_DIR` to the directory containing this installed `SKILL.md`. The
helper needs Python 3.11 or newer and the dependencies in
[scripts/requirements.txt](scripts/requirements.txt). If `uv` is available, run:

```sh
uv run --no-project --python '>=3.11' \
  --with-requirements "$SKILL_DIR/scripts/requirements.txt" \
  python -B "$SKILL_DIR/scripts/register_mcp.py" \
  --project-root "/absolute/path/to/codex/project" \
  --port 64342 \
  --ide-project-path "/absolute/path/to/intellij/project" \
  --dry-run
```

Replace both illustrative paths and the port with the confirmed values. Use
`--server-name <existing-name>` when reusing an entry whose name is not `intellij`.
The project root selects where to save the config; the IDE project path selects
the header value. Both must be absolute paths to existing directories. The
helper builds `http://127.0.0.1:<port>/stream`. If the copied endpoint uses another
host, scheme, or path, stop and resolve that difference instead of changing it
silently.

If `uv` is unavailable, create a temporary virtual environment with Python 3.11
or newer, install the bundled requirements with its `python -m pip install
--require-hashes -r <requirements-path>`, and use that environment's Python to
run the same helper. Keep the environment outside the installed plugin. Perform
these steps for the user; the App workflow does not require a Codex CLI or user
terminal commands.

Review the dry-run diff, then run without `--dry-run` for an authorized setup or
repair. The helper creates a backup before replacing an existing file, writes
atomically, and leaves a repeated identical registration unchanged. It refuses
malformed TOML, linked config paths, and conflicting stdio or dynamic project
header settings. On failure, report the error and resolve its cause; do not bypass
the helper with manual edits or add a duplicate server.

For the same Codex and IntelliJ checkout, the resulting config has this form:

```toml
[mcp_servers.intellij]
url = "http://127.0.0.1:64342/stream"
# Replace this placeholder with the absolute path of the project open in IntelliJ.
http_headers = { IJ_MCP_SERVER_PROJECT_PATH = "/absolute/path/to/your/project" }
```

Header values are literal strings: do not use `${PWD}`, `~`, or another variable
placeholder. Do not save the illustrative path.

Codex loads project configuration only for trusted projects. If trust is missing,
explain that the user must trust the project through Codex; do not change trust
settings as part of MCP registration.

## Verify and troubleshoot

Read back the project's configuration and check the URL and
`IJ_MCP_SERVER_PROJECT_PATH` header. This checks the saved registration, not
connectivity.

Have the user restart the Codex App after saving, then open a new chat in the
same local project. Use the App's **Settings > MCP servers** to inspect available
server status and any reported errors. Confirm that IntelliJ tools are available
in the project chat and verify the connection with a read-only tool call,
supplying the target `projectPath` when the tool accepts it. Report whether the
saved registration and live connection were each verified. Do not require the
user to run terminal commands to complete this App workflow.

For a different port, a refused connection, an unavailable server, or another
connection issue, refer the user to
[JetBrains' MCP Server documentation](https://www.jetbrains.com/help/idea/mcp-server.html).
Check that IntelliJ's MCP server is enabled, the intended project is open, the URL
matches the IDE's current **HTTP Stream Config**, and the App has reloaded a
trusted project's configuration. If these checks do not resolve the issue, report the
observed error and ask for the IDE's current connection configuration. Do not
guess replacement ports or repeatedly retry the same failed connection.

See the official OpenAI documentation for
[App configuration and MCP](https://learn.chatgpt.com/docs/developer-settings#integrations-and-mcp)
and [MCP setup](https://learn.chatgpt.com/docs/extend/mcp) for the App's settings,
project configuration, and supported HTTP options.
