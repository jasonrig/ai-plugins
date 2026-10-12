# Code and project workflows

Apply the project verification in `../SKILL.md` before IDE calls. Use runtime tool
descriptions for invocation details. The following combinations are examples;
choose those supported by this project's IDE and language extensions.

## Understand code, assess impact, and investigate dependencies

Start with the relevant module or entry point rather than dumping the whole
project. Use module and dependency information when it helps establish project
structure. Resolve identifiers with semantic search, inspect their declarations
and bounded surrounding source, and follow incoming or outgoing calls when the
question concerns execution relationships. Use text or regex search for literals,
configuration, comments, or relationships the language index does not represent.

For a proposed contract change, establish callers, integration points, and the
checks that exercise them before deciding the edit scope. For an unfamiliar
dependency, resolve symbols against the project's actual libraries and inspect
accessible source or declarations. Do not infer the installed API from a library
name alone. The useful result is an explanation of the code path or impact,
supported by concrete declarations and call sites; truncated searches cannot
establish a complete inventory.

## Implement behavior and refactor safely

Combine semantic context with targeted source edits and relevant validation.
Read the latest IDE document before patching, especially when the developer is
editing concurrently. For a symbol rename, identify the declaration and use
semantic refactoring when supported, then inspect updated references. Do not
assume that other IDE refactorings are exposed through MCP.

For behavior changes or unsupported transformations, make a coherent patch with
necessary caller and test updates. Inspect affected files with diagnostics and
use the project's appropriate compilation or execution checks. Confirm that the
requested behavior changed and that unrelated code and developer edits did not.
Formatting a whole file can enlarge the diff; use it when it serves the requested
change, not as an incidental cleanup step.

## Diagnose static failures and reproduce defects

Use file inspections for localized problems and batch inspections for a known
set of affected files. Build when compiler or build-system evidence is needed;
inspection results and compilation results answer different questions. Follow
locations and semantic relationships to the underlying cause before patching.
Recheck the relevant failures, recognizing skipped files and partial results.

For a behavioral defect, discover a suitable test, executable location, or run
configuration and reproduce the symptom with the project's configured runtime.
Combine the failing result with source and call analysis. Use
[runtime debugging](debugger-tools.md) when runtime evidence is needed, or
[data investigation](database-tools.md) when the symptom depends on a data source.
After a fix, repeat the relevant reproduction and checks. A successful launch or
empty, incomplete problem list does not demonstrate that the defect is fixed.

## Run tests and applications

Discover existing run configurations or executable locations before invoking
them. Inspect the chosen target's working directory and runtime context; do not
invent a configuration name, test framework, interpreter, or build command.
Use supported temporary launch overrides only when needed for this task and
preserve persistent configuration. Discover override support from the selected
configuration before supplying overrides.

Prefer the narrow check that answers the question, expanding validation when
affected behavior warrants it. Collect completion status and meaningful test or
application output. An absent exit code or timeout may leave the process running;
report that state and use supported monitoring rather than launching duplicates.
Use project-native commands for checks the verified IDE connection cannot expose,
with the intended checkout as their working directory.

## Develop custom inspections

Use inspection-generation tools only when available and when their supported
language inputs cover the code being inspected. Discover the inspection API and
examples, inspect source structure where useful, and define positive and negative
examples for the intended rule. Validate the inspection against those examples,
then assess it on representative project code. Successful compilation alone
does not demonstrate correct findings or freedom from false positives.

Language restrictions of these particular tools do not restrict other workflows.
Do not infer inspection support from the IDE brand or convert the project to a
different language to use a tool.

## Tool selection

These entries cover the documented code/project tools, not a promise that the
connected server exposes all of them. Consult its schemas for supported inputs,
coordinate conventions, result limits, and router syntax.

| Tool                               | Purpose and selection guidance                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `get_project_modules`              | Map module structure when needed; module names and types alone do not verify a checkout.                                           |
| `get_project_dependencies`         | Identify project libraries to guide API investigation; use actual declarations to establish API details.                           |
| `search_symbol`                    | Resolve indexed declarations by identifier; use external-symbol search only when supported and relevant.                           |
| `get_symbol_info`                  | Inspect a symbol at a known source position; it does not discover the editor caret.                                                |
| `analyze_calls`                    | Trace incoming or outgoing callable relationships; prefer this for call impact and follow bounded tree results.                    |
| `search_file`                      | Find paths by glob when the file is unknown; use bounded searches and supported exclusions.                                        |
| `search_text`                      | Find literal text, configuration, or identifiers lacking useful semantic support.                                                  |
| `search_regex`                     | Find structural text patterns; validate matches before treating them as semantic references.                                       |
| `skill_search`                     | Dispatch project file, text, regex, or symbol searches by mode; this is not Codex skill discovery.                                 |
| `read_file`                        | Read bounded source or relevant dependency declarations; use supported ranges and respect numbered-line conventions.               |
| `get_all_open_file_paths`          | Obtain editor context, including the active path when returned; tab paths do not identify a caret or selection.                    |
| `list_directory_tree`              | Inspect a bounded directory structure; an echoed directory or relative tree alone cannot verify project identity.                  |
| `open_file_in_editor`              | Show a requested file to the developer; opening it changes editor context and is unnecessary for background reading.               |
| `create_new_file`                  | Create an intended project file; verify its parent path and the requested overwrite behavior first.                                |
| `apply_patch`                      | Apply contextual source changes; refresh affected documents and account for IDE synchronization or saving effects.                 |
| `rename_refactoring`               | Rename a verified symbol and its programmatic references; inspect scope and resulting changes rather than doing blind replacement. |
| `reformat_file`                    | Apply IDE formatting to a file; account for the entire formatting diff, not just the edited region.                                |
| `get_file_problems`                | Inspect one file for diagnostics; distinguish successful analysis from errors or incomplete work.                                  |
| `lint_files`                       | Inspect several files together; timed-out, unanalyzed, or truncated results do not constitute a clean check.                       |
| `build_project`                    | Obtain compilation/build evidence for the relevant project or files; builds execute project tooling and can have side effects.     |
| `get_run_configurations`           | Discover execution configurations or runnable code locations and their supported overrides before launching.                       |
| `execute_run_configuration`        | Launch the verified configuration or code location; examine output, completion, and any process that remains active.               |
| `execute_terminal_command`         | Run necessary commands in the intended checkout; establish the working directory and do not reuse an unverified terminal.          |
| `get_repositories`                 | Discover project VCS roots; relative roots alone cannot establish which physical checkout is in use.                               |
| `git_status`                       | Inspect scoped working-tree changes for a baseline or review; status does not establish functional correctness.                    |
| `execute_tool`                     | Route to a known supported IDE tool; preserve the project checks and scope of the underlying operation.                            |
| `generate_inspection_kts_api`      | Obtain a supported inspection API for the target language before writing a rule.                                                   |
| `generate_inspection_kts_examples` | Obtain relevant inspection examples; adapt their behavior to the requested rule.                                                   |
| `generate_psi_tree`                | Inspect source structure for supported inputs, particularly when developing an inspection.                                         |
| `validate_inspection_kts`          | Check an inspection against specification examples, including expected findings and non-findings.                                  |
| `run_inspection_kts`               | Exercise an inspection on representative source and distinguish compilation failure from reported findings.                        |
