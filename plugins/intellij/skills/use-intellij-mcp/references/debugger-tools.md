# Debugger workflows

Apply the project verification in `../SKILL.md` before IDE calls. Discover actual
debugger and language support from the connected IDE; do not assume that every
runtime supports the same operations. Use the tool schemas for actions, source
coordinates, frame identifiers, and limits.

## Investigate a runtime defect

Start with the failing reproduction and a concrete hypothesis. Discover existing
debugger sessions and identify the one belonging to the requested execution
target. If starting a session is needed, discover a suitable run configuration
or executable location using the code/project tools, verify its runtime and
working directory, and launch it with supported task-specific overrides.

Establish session state before inspecting frames or controlling execution. Wait
for a suspension or pause when needed, then inspect the relevant thread, stack,
frame, and bounded values. Use returned child paths and frame identifiers rather
than guessing them. After resuming, stepping, or restarting, refresh state before
reusing frame, variable, or session handles.

Use targeted breakpoints, stepping, or run-to-location operations to collect the
evidence the hypothesis requires. Continuing execution, evaluating expressions,
or changing variables may alter application state. Prefer direct value inspection
when it answers the question; use evaluation or runtime mutation only when its
effects are appropriate to the authorized task. A runtime variable change is
not a persisted source fix.

Translate the finding into a source change when requested, then repeat the
reproduction and relevant checks. Remove temporary breakpoints or other debugger
state introduced for the task when finished, while preserving existing developer
state. Manage sessions started for the task deliberately; do not stop another
session simply because it is open. Report unresolved failures and sessions or
processes still active.

## Tool selection

| Tool                            | Purpose and selection guidance                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `xdebug_get_debugger_status`    | Discover sessions and current state; identify the task's target before session-scoped operations.                           |
| `xdebug_start_debugger_session` | Launch a verified execution target under the debugger when reproduction requires a new session.                             |
| `xdebug_control_session`        | Wait, pause, step, resume, stop, or collect supported events; choose actions consistent with current state.                 |
| `xdebug_get_threads`            | Discover thread identities and select the one relevant to the failure.                                                      |
| `xdebug_get_stack`              | Inspect frames in the selected execution context; missing source locations do not justify invented coordinates.             |
| `xdebug_get_frame_values`       | Inspect a bounded snapshot of values in a current frame; refresh after execution advances.                                  |
| `xdebug_get_value_by_path`      | Explore returned value children using their exact paths, preserving frame and session context.                              |
| `xdebug_evaluate_expression`    | Evaluate an expression in a valid frame; code evaluation may cause application side effects.                                |
| `xdebug_set_variable`           | Mutate a runtime value for a task-authorized experiment; do not present it as a source-code fix.                            |
| `xdebug_list_breakpoints`       | Inspect existing breakpoint state before adding or modifying task-specific breakpoints.                                     |
| `xdebug_set_breakpoint`         | Add or update a verified location or breakpoint; preserve unrelated conditions and developer state.                         |
| `xdebug_remove_breakpoint`      | Remove an identified breakpoint within the task's scope, particularly temporary ones introduced by the agent.               |
| `xdebug_run_to_line`            | Advance execution to an identified source location; refresh state afterward and account for timeout or failure to reach it. |
