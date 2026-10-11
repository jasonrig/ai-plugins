# Keep local IntelliJ settings out of Git

OpenAI documents `.codex/config.toml` as a project configuration file. The
exclusions below are this plugin's recommendation for the local IntelliJ port
and absolute project path. They are not an OpenAI requirement to ignore all
project configuration. See [OpenAI's project configuration guidance](https://learn.chatgpt.com/docs/config-file/config-advanced#project-config-files-codexconfigtoml).

## Check the target project's Git state

Before applying registration, run these checks from the target project:

```sh
git ls-files -- .codex/config.toml
git check-ignore -v -- .codex/config.toml
```

The first command lists the file if it is tracked, including a newly staged
file. The second reports the matching ignore rule for an untracked file; no
match returns exit code 1. A negated rule beginning with `!` means the file is
included. A tracked file is not shown by `check-ignore` by default. See
[Git's check-ignore documentation](https://git-scm.com/docs/git-check-ignore).
If the project is outside a Git repository, these checks do not apply.

## Choose the exclusion policy

For an untracked local config, recommend these entries in `.gitignore` at the
target project directory:

```gitignore
# Local Codex settings and registration backups.
/.codex/config.toml
/.codex/config.toml.*.bak
```

The helper's backups contain the previous config and need the same treatment.
Use `.gitignore` when the team should share this policy. For a personal exclusion,
use the repository's `info/exclude` file instead. Locate it with
`git rev-parse --git-path info/exclude`; this also handles worktrees where `.git`
is a file. Exclude patterns there are relative to the repository root: prefix
them with the project's relative directory if the project is a subdirectory.
See [Git's ignore rules](https://git-scm.com/docs/gitignore) and
[GitHub's local exclusion guidance](https://docs.github.com/en/get-started/git-basics/ignoring-files#excluding-local-files-without-creating-a-gitignore-file).

Use specific patterns. A blanket `.codex/` exclusion would also hide shared
configuration, instructions, and other project resources. OpenAI explicitly
supports checking the App's local environment configuration into Git; see
[OpenAI's local environment documentation](https://learn.chatgpt.com/docs/environments/local-environment).

## Handle a config that is already tracked

Git cannot ignore individual TOML values, and ignore rules do not affect tracked
files. Adding either exclusion above does not hide local edits to a tracked
config. Explain this before writing machine-specific values; do not report that
the file is protected merely because an ignore pattern matches.

If the team wants local config files, recommend keeping portable defaults in a
tracked template, such as `.codex/config.toml.example`, and the actual config
untracked. The template must omit personal paths and credentials. Codex does not
load that example filename automatically; copy it to `config.toml` when setting
up a checkout. Git recommends this sample-file approach for local configuration;
it does not recommend `assume-unchanged` or `skip-worktree` as a way to hide local
edits. See [Git's configuration-file guidance](https://git-scm.com/docs/git-update-index#_notes).

Changing tracking policy requires an explicit request. Do not untrack or stage
files, remove shared defaults, or change Git history as part of MCP registration.
If the config remains tracked, report that its IntelliJ changes are visible in
Git and must be excluded from commits by the user. When asked to add exclusions,
preserve existing rules, add only missing entries, and verify the config and any
actual backup paths with `git check-ignore`. Report their tracked and ignored
status after setup.

For another checkout or worktree, verify the registration again: its absolute
path must identify the project that is open in IntelliJ. An ignored config is
not supplied by a normal Git checkout.
