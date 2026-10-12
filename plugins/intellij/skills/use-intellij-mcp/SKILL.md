---
name: use-intellij-mcp
description: Compose IntelliJ and JetBrains IDE MCP tools into development workflows in the verified current checkout. Use before invoking IDE MCP tools for analysis, editing, refactoring, execution, debugging, or data investigation, including router calls. Do not use for ordinary work that does not involve the IDE or for connection setup.
---

# Use IntelliJ MCP

Use the IDE's semantic analysis and configured execution environment where they
improve the task. This skill supports ordinary autonomous work as well as focused
editing; it does not impose an incremental collaboration style.

## Verify the project before IDE operations

1. Identify the chat's intended workspace and resolve its canonical filesystem
   path. For a Git project, establish the checkout root, for example with
   `git -C <workspace> rev-parse --show-toplevel`. Identify the selected MCP server
   and its configured IDE project binding from accessible connection metadata or
   effective configuration. A project header such as `IJ_MCP_SERVER_PROJECT_PATH`
   can supply that binding. Distinguish saved settings from the loaded connection;
   tool availability or the server name alone does not establish its target.
2. Compare canonical paths and checkout roots. Accept equivalent paths and
   subdirectories of the same checkout. Reject unrelated repositories and sibling
   worktrees: a shared remote, branch, or Git common directory is insufficient.
   Without Git, require matching canonical project roots. Refuse a known mismatch
   before making any MCP call; do not override it with another `projectPath`.
3. Corroborate a matching binding with a harmless live call explicitly scoped to
   the verified IDE project. Prefer a project-relative read of an existing,
   non-secret file whose contents can be compared with the local checkout, or
   returned project identity when available. Combine that evidence with the
   binding and explicit routing; filenames, echoed arguments, relative roots, or
   identical content shared by different checkouts are not identity proof alone.
   An absolute-path read may bypass project routing and is insufficient. Do not
   write a marker or run application code to establish scope. If routing remains
   unverified, pause before ordinary operations.

When MCP is unavailable, mismatched, or unverified, explain the observed problem
and pause dependent work until the developer repairs the connection or explicitly
chooses local tools. Do not silently fall back, reconfigure the server, or switch
the task to its other checkout. Use the bundled
[registration skill](../register-intellij-mcp/SKILL.md) for requested setup or
repair. If local tools are explicitly chosen, keep edits in the intended checkout
and state which IDE capabilities and unsaved document contents are unavailable.

Apply verification to reads, edits, editor navigation, builds, terminal commands,
router calls, database operations, and debugger actions. Pass the verified IDE
`projectPath` whenever the actual schema supports it, including on `execute_tool`.
For a tool without an explicit project argument, require a verified connection
or resource binding; do not rely on whichever project the IDE happens to select.

Establish the intended absolute file from the conversational target and chat
workspace before constructing MCP paths. Resolve ambiguity between paths relative
to the workspace or checkout root from local evidence or ask for the target.
Then express relative MCP arguments against the verified IDE root; do not
reinterpret the user's path against a different root. Check that writes,
including new-file parents, stay in the authorized checkout after resolving
symlinks and traversal. Honor the tool's project-root restrictions rather than
stripping path components to make a target fit. Library-source reads are
appropriate when the dependency belongs to the verified project; an unrelated
project is not a substitute target.

Keep verification in conversation context for this connection and workspace.
Reverify after reconnecting or changing workspace, project binding, or relevant
configuration. Reuse run, debugger, query, and result handles only within the
verified context in which they were obtained. Check execution working directories
and database environments against the requested task as well as the IDE project.

These instructions guide the agent; they do not enforce permissions inside the
MCP server or authorize additional external actions.

## Choose and compose capabilities

Use the connected server's descriptions and schemas for arguments and supported
behavior. Infer languages, frameworks, modules, and execution environments from
the actual project and installed IDE capabilities. Do not assume a JVM project,
a particular build system, or support for every listed tool or language.

Read only the reference relevant to the task:

- [Code and project workflows](references/code-tools.md): understand code, assess
  impact, implement behavior, refactor, diagnose static failures, reproduce
  defects, run tests or applications, investigate dependencies, and develop
  custom inspections.
- [Debugger workflows](references/debugger-tools.md): investigate runtime behavior
  with the appropriate session, suspension state, stack, values, and targeted
  execution control.
- [Database workflows](references/database-tools.md): connect application behavior
  with the intended data source, schema, and bounded query evidence.

The workflows are composable examples, not required pipelines. Select steps that
produce useful evidence and prefer semantic operations when the question is
semantic. After project verification, ordinary project tools can complement the
IDE when a particular capability is missing; an absent optional tool does not
mean the entire connection is unavailable.

Prefer directly exposed tools. For router-only capabilities, use `execute_tool`
with a known target and supported command syntax; keep its project routing
consistent with the underlying operation. Do not invent hidden tools, arguments,
or language support, or discover mutating syntax by trial execution.

Refresh relevant source and runtime state before acting, preserve developer
changes, and inspect the resulting diff or state. Report what the evidence
establishes, what remains incomplete, and any process or session still running.
