"""Edit one project's IntelliJ MCP connection without rewriting unrelated TOML."""

from __future__ import annotations

import argparse
import copy
import difflib
import os
import re
import stat
import sys
import tempfile
from collections.abc import MutableMapping
from dataclasses import dataclass
from pathlib import Path

import tomlkit
from tomlkit.exceptions import TOMLKitError


PROJECT_HEADER = "IJ_MCP_SERVER_PROJECT_PATH"
STDIO_FIELDS = {"command", "args", "env", "env_vars", "cwd", "experimental_environment"}


@dataclass(frozen=True)
class Snapshot:
    """Original bytes and file identity used to detect edits before replacement."""

    content: bytes | None
    identity: tuple[int, int, int, int, int] | None
    mode: int = 0o600


def existing_directory(value: str) -> Path:
    """Require an absolute, existing directory without expanding placeholders."""
    directory = Path(value)
    if not directory.is_absolute() or not directory.is_dir():
        raise ValueError(f"Expected an absolute path to an existing directory: {value}")
    return directory


def check_directory(directory: Path) -> None:
    """Reject a symlink or non-directory at the project's .codex location."""
    if directory.is_symlink() or (directory.exists() and not directory.is_dir()):
        raise ValueError(f"Expected a real directory, not a symlink: {directory}")


def snapshot(config: Path) -> Snapshot:
    """Read a regular config with one link, or represent an absent file."""
    check_directory(config.parent)
    try:
        metadata = config.lstat()
    except FileNotFoundError:
        return Snapshot(None, None)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise ValueError(f"Refusing a symlink, hard link, or non-file: {config}")
    content = config.read_bytes()
    identity = (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_mode,
    )
    return Snapshot(content, identity, stat.S_IMODE(metadata.st_mode))


def ensure_table(parent: MutableMapping, name: str) -> MutableMapping:
    """Reuse a TOML table, creating it only when the key is absent."""
    if name not in parent:
        parent[name] = tomlkit.table()
    result = parent[name]
    if not isinstance(result, MutableMapping):
        raise ValueError(f"Expected a TOML table at {name}; existing value was not changed")
    return result


def render(source: str, server_name: str, port: int, ide_project_path: str) -> str:
    """Change only a server's URL and project header, retaining TOML trivia."""
    document = tomlkit.parse(source)
    if tomlkit.dumps(document) != source:
        raise ValueError("TOML Kit cannot preserve this document's layout; no edits applied")
    expected = copy.deepcopy(document.unwrap())
    servers = ensure_table(document, "mcp_servers")
    server = ensure_table(servers, server_name)
    conflicts = STDIO_FIELDS.intersection(server)
    if conflicts or "http_headers_helper" in server:
        raise ValueError(
            f"{server_name} has stdio or dynamic-header settings; no edits applied"
        )
    env_headers = server.get("env_http_headers", {})
    if not isinstance(env_headers, MutableMapping) or any(
        name.casefold() == PROJECT_HEADER.casefold() for name in env_headers
    ):
        raise ValueError("Project header conflicts with env_http_headers; no edits applied")
    headers = ensure_table(server, "http_headers")
    if any(not isinstance(value, str) for value in headers.values()):
        raise ValueError("HTTP header values must be strings; no edits applied")
    matches = [name for name in headers if name.casefold() == PROJECT_HEADER.casefold()]
    if len(matches) > 1:
        raise ValueError("Duplicate case-insensitive project headers; no edits applied")
    header_name = matches[0] if matches else PROJECT_HEADER
    url = f"http://127.0.0.1:{port}/stream"
    server["url"] = url
    headers[header_name] = ide_project_path
    expected_server = expected.setdefault("mcp_servers", {}).setdefault(server_name, {})
    expected_server["url"] = url
    expected_server.setdefault("http_headers", {})[header_name] = ide_project_path
    output = tomlkit.dumps(document)
    if tomlkit.parse(output).unwrap() != expected:
        raise ValueError("TOML round-trip changed unrelated values; no edits applied")
    return output


def write_atomic(config: Path, original: Snapshot, output: bytes) -> Path | None:
    """Back up an existing config and replace it atomically with preserved mode."""
    check_directory(config.parent)
    config.parent.mkdir(mode=0o700, exist_ok=True)
    temporary: Path | None = None
    backup: Path | None = None
    try:
        descriptor, filename = tempfile.mkstemp(prefix=".config.toml.", dir=config.parent)
        temporary = Path(filename)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(output)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, original.mode)
        if snapshot(config) != original:
            raise ValueError("Configuration changed during editing; rerun after reviewing it")
        if original.content is not None:
            descriptor, filename = tempfile.mkstemp(
                prefix="config.toml.", suffix=".bak", dir=config.parent
            )
            backup = Path(filename)
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(original.content)
                stream.flush()
                os.fsync(stream.fileno())
        if snapshot(config) != original:
            raise ValueError("Configuration changed before replacement; no edits applied")
        os.replace(temporary, config)
        return backup
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def register(
    project_root: str,
    port: int,
    ide_project_path: str,
    server_name: str = "intellij",
    dry_run: bool = False,
) -> tuple[Path, str, Path | None]:
    """Validate parameters and apply or preview one project-scoped registration."""
    project = existing_directory(project_root).resolve()
    ide_project = existing_directory(ide_project_path)
    if not 1 <= port <= 65535:
        raise ValueError("Port must be between 1 and 65535")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", server_name):
        raise ValueError("Server name must contain only letters, digits, underscores, or hyphens")
    config = project / ".codex" / "config.toml"
    homes = [Path.home() / ".codex"]
    if os.environ.get("CODEX_HOME"):
        homes.append(Path(os.environ["CODEX_HOME"]))
    if any(config.resolve() == (home / "config.toml").resolve() for home in homes):
        raise ValueError("Refusing to edit user-level Codex configuration")
    original = snapshot(config)
    source = (original.content or b"").decode("utf-8")
    output = render(source, server_name, port, str(ide_project))
    if output == source:
        return config, "unchanged", None
    if dry_run:
        difference = "".join(
            difflib.unified_diff(
                source.splitlines(keepends=True),
                output.splitlines(keepends=True),
                fromfile=str(config),
                tofile=f"{config} (proposed)",
                n=0,
            )
        )
        return config, difference, None
    backup = write_atomic(config, original, output.encode("utf-8"))
    return config, "created" if original.content is None else "updated", backup


def main() -> int:
    """Run the parameterized editor and report a useful error without a traceback."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", required=True, help="Absolute Codex project directory")
    parser.add_argument("--port", required=True, type=int, help="IntelliJ HTTP Stream port")
    parser.add_argument(
        "--ide-project-path", required=True, help="Absolute IJ_MCP_SERVER_PROJECT_PATH value"
    )
    parser.add_argument("--server-name", default="intellij", help="Existing or new MCP server name")
    parser.add_argument("--dry-run", action="store_true", help="Print a diff without writing files")
    arguments = parser.parse_args()
    try:
        config, result, backup = register(**vars(arguments))
    except (OSError, ValueError, TOMLKitError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    if arguments.dry_run and result != "unchanged":
        print(result, end="")
    else:
        print(f"{result.capitalize()}: {config}")
    if backup is not None:
        print(f"Backup: {backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
