---
name: focus-intellij-code
description: Make small, user-directed code edits with IntelliJ MCP context when the user requests focused editing or the conversation establishes a pattern of working through narrow changes together. Do not use for ordinary autonomous implementation or MCP connection setup.
---

# Focus IntelliJ Code

Keep a shared code focus with the developer and make one coherent, reviewable
change at a time. Focus guides the work; necessary supporting edits may extend
beyond the target.

## Establish the working style

Use this skill when explicitly requested or when the conversation clearly
establishes the developer's preference for working through narrow changes
together. A single small task or an open IntelliJ window is insufficient evidence.
Briefly acknowledge adoption when inferred. Keep the preference in this chat;
do not write settings or persistent tracking. Honor later instructions to broaden
the task or change the rhythm.

## Resolve the focus

Before IDE calls or dependent editing, read and follow the
[project verification workflow](../use-intellij-mcp/SKILL.md#verify-the-project-before-ide-operations).
Use its verified IDE project path and keep this skill's collaboration rhythm.

Use the connected server's actual tool schemas and responses as authoritative.
Call `get_all_open_file_paths` for relevant editing turns when IDE context helps
resolve the target. Use `activeFilePath` when returned; `openFiles` alone does not
establish which tab is active. The built-in workflow does not retrieve the caret
or selected text. Do not invent selection coordinates or use deprecated
selection tools.

Resolve the requested file, symbol, block, or range from the conversation,
using the active file as context. An explicit conversational target takes
precedence over the active tab. Identify the focus briefly when first established
or changed, without requiring confirmation when the intent is clear.

Interpret tab changes alongside the topic:

- Follow an obvious new development target naturally.
- Retain the agreed target when the conversation continues the same work,
  even if the active tab changes.
- Ask one concise targeting question when the tab and conversation leave
  multiple plausible targets. An ambiguous "this" does not authorize editing
  the whole active file.

If MCP is unavailable, mismatched, or unverified, explain the observed limitation
and pause dependent work until connection repair or an explicit choice to use
local tools. With local tools explicitly chosen, establish the intended file,
symbol, or range and identify unavailable IDE capabilities or unsaved contents.
Connection setup or repair belongs to `$register-intellij-mcp` when requested;
do not configure a connection as part of an editing request.

## Make a coherent increment

Read enough surrounding code and dependencies to understand the requested
outcome. Prefer IDE code reading and symbol information when useful, and inspect
other files without unnecessarily opening them or moving the developer's active
editor. Use semantic `rename_refactoring` for symbol renames when available.
Use a targeted patch for ordinary edits, following the exposed tool's schema.

Refresh the relevant code before applying changes. Preserve intervening developer
edits and resolve conflicting content instead of overwriting it from a stale
snapshot. If using filesystem tools, account for differences between the IDE
document and the checkout before editing.

Make one change with an understandable purpose. "Small" imposes no fixed file
or line limit. Include necessary imports, references, and focused tests in the
same increment so the result remains coherent. Briefly explain supporting edits
before applying them; routine supporting work needs no separate approval.

Discuss substantial expansion before editing when the work materially increases
the review burden, changes the agreed behavior, or introduces another objective.
Describe the concrete additional work and why it is needed, then let the developer
choose the scope. Do not apply a partial change that leaves required references
broken while awaiting that decision. Avoid incidental cleanup and broad
formatting.

Validate the increment with relevant project checks and IDE diagnostics such as
`get_file_problems` or `lint_files` when available. Review the resulting diff for
unexpected changes beyond the focus; preserve unrelated developer work.

Finish with a compact explanation of the focused change, supporting edits, and
validation results or limitations. Stop at that review point and leave the next
increment for the developer to steer. If a larger task remains, state what remains
without presenting the whole task as complete.
