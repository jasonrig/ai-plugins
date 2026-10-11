"""Exercise project config edits with independent files and the real Codex parser."""

import copy
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import tomllib
import unittest
from unittest.mock import patch

import tomlkit


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "register_mcp.py"
SPEC = importlib.util.spec_from_file_location("intellij_config_editor", SCRIPT)
EDITOR = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = EDITOR
SPEC.loader.exec_module(EDITOR)

EXISTING = '''# Keep user settings and comments.
model = "example-model" # model choice
enabled_features = [ "one", "two" ]

[mcp_servers.docs] # another server
url = 'https://example.com/mcp'
enabled = false

[mcp_servers.intellij] # IDE connection
url = "http://127.0.0.1:12345/stream" # endpoint
enabled = false # retain the user's choice
tool_timeout_sec = 45
http_headers = { IJ_MCP_SERVER_PROJECT_PATH = "/old/project", "X-Other" = "keep" } # headers

[plugins."example@marketplace"]
enabled = true
'''


class RegistrationTests(unittest.TestCase):
    """Check that edits are scoped, repeatable, recoverable, and parseable."""

    def setUp(self) -> None:
        """Create separate Codex, IDE, and user-config locations for each test."""
        self.temporary = tempfile.TemporaryDirectory(prefix="intellij-editor-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.project = self.root / "Codex project"
        self.ide = self.root / 'IDE "quoted" project'
        self.home = self.root / "user" / ".codex"
        for directory in (self.project, self.ide, self.home):
            directory.mkdir(parents=True)
        self.config = self.project / ".codex" / "config.toml"
        self.global_config = self.home / "config.toml"
        self.global_config.write_text('# User config must remain untouched.\n', encoding="utf-8")
        self.environment = patch.dict(os.environ, {"CODEX_HOME": str(self.home)})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def apply(self, **changes):
        """Run the editor with explicit project, port, and IDE path parameters."""
        arguments = {
            "project_root": str(self.project),
            "port": 64342,
            "ide_project_path": str(self.ide),
        }
        arguments.update(changes)
        return EDITOR.register(**arguments)

    def seed(self, source: str = EXISTING) -> None:
        """Write a fixture config using a known file mode."""
        self.config.parent.mkdir(exist_ok=True)
        self.config.write_text(source, encoding="utf-8")
        self.config.chmod(0o640)

    def test_creates_only_target_project_config(self) -> None:
        """Project location and the IDE header can be different directories."""
        global_before = self.global_config.read_bytes()
        config, result, backup = self.apply(port=55550, server_name="jetbrains")
        self.assertEqual((config, result, backup), (self.config, "created", None))
        server = tomllib.loads(self.config.read_text())["mcp_servers"]["jetbrains"]
        self.assertEqual(server["url"], "http://127.0.0.1:55550/stream")
        self.assertEqual(server["http_headers"][EDITOR.PROJECT_HEADER], str(self.ide))
        self.assertFalse((self.ide / ".codex").exists())
        self.assertEqual(self.global_config.read_bytes(), global_before)
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE(self.config.stat().st_mode), 0o600)

    def test_preserves_settings_comments_layout_and_backup(self) -> None:
        """Only the endpoint and project header change in an existing file."""
        self.seed()
        before = tomllib.loads(EXISTING)
        expected = copy.deepcopy(before)
        expected["mcp_servers"]["intellij"]["url"] = "http://127.0.0.1:64342/stream"
        expected["mcp_servers"]["intellij"]["http_headers"][EDITOR.PROJECT_HEADER] = str(self.ide)
        _, result, backup = self.apply()
        updated = self.config.read_text()
        self.assertEqual(tomllib.loads(updated), expected)
        for line in EXISTING.splitlines():
            if "/old/project" not in line and "12345" not in line:
                self.assertIn(line, updated)
        self.assertIn("# endpoint", updated)
        self.assertIn("# headers", updated)
        self.assertEqual(result, "updated")
        self.assertEqual(backup.read_text(), EXISTING)
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE(self.config.stat().st_mode), 0o640)
            self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)

    def test_repeated_registration_does_not_rewrite(self) -> None:
        """A repeated run creates neither a replacement nor another backup."""
        self.seed()
        self.apply()
        before = EDITOR.snapshot(self.config)
        self.assertEqual(self.apply()[1:], ("unchanged", None))
        self.assertEqual(EDITOR.snapshot(self.config), before)
        self.assertEqual(len(list(self.config.parent.glob("*.bak"))), 1)

    def test_dry_run_has_no_filesystem_side_effects(self) -> None:
        """A preview neither creates .codex nor replaces an existing config."""
        _, difference, backup = self.apply(dry_run=True)
        self.assertIn("+url =", difference)
        self.assertIsNone(backup)
        self.assertFalse(self.config.parent.exists())
        self.seed()
        before = EDITOR.snapshot(self.config)
        self.apply(dry_run=True)
        self.assertEqual(EDITOR.snapshot(self.config), before)
        self.assertEqual(list(self.config.parent.glob("*.bak")), [])

    def test_rejects_malformed_or_conflicting_configuration(self) -> None:
        """Bad input remains byte-for-byte unchanged, with no recovery files."""
        sources = [
            "[mcp_servers\n",
            "[mcp_servers.intellij]\nurl = 'a'\nurl = 'b'\n",
            "mcp_servers = false\n",
            "[mcp_servers]\nintellij = false\n",
            "[mcp_servers.intellij]\ncommand = 'node'\nargs = []\n",
            "[mcp_servers.intellij]\nhttp_headers = { X = 1 }\n",
            "[mcp_servers.intellij]\nenv_http_headers = { ij_mcp_server_project_path = 'PROJECT' }\n",
            "[mcp_servers.intellij]\nhttp_headers_helper = './headers.sh'\n",
            "[mcp_servers.intellij.http_headers]\nIJ_MCP_SERVER_PROJECT_PATH = 'one'\nij_mcp_server_project_path = 'two'\n",
        ]
        for source in sources:
            with self.subTest(source=source):
                self.seed(source)
                before = EDITOR.snapshot(self.config)
                with self.assertRaises((ValueError, tomlkit.exceptions.TOMLKitError)):
                    self.apply()
                self.assertEqual(EDITOR.snapshot(self.config), before)
                self.assertEqual(list(self.config.parent.glob("*.bak")), [])

    def test_existing_header_case_and_nested_tables(self) -> None:
        """An existing case variant is updated without a second HTTP header."""
        self.seed("[mcp_servers.intellij.http_headers]\nij_mcp_server_project_path = '/old' # path\nX = 'keep'\n")
        self.apply()
        server = tomllib.loads(self.config.read_text())["mcp_servers"]["intellij"]
        self.assertEqual(server["http_headers"], {
            "ij_mcp_server_project_path": str(self.ide), "X": "keep",
        })
        self.assertIn("# path", self.config.read_text())

    def test_inline_and_dotted_server_tables(self) -> None:
        """Valid alternate TOML layouts retain unrelated values."""
        sources = [
            "mcp_servers = { intellij = { url = 'http://old', http_headers = { X = 'keep' } }, docs = { url = 'https://example.com' } }\n",
            "mcp_servers.intellij.url = 'http://old'\nmcp_servers.intellij.http_headers.X = 'keep'\nmcp_servers.docs.url = 'https://example.com'\n",
        ]
        for source in sources:
            with self.subTest(source=source):
                self.seed(source)
                self.apply()
                servers = tomllib.loads(self.config.read_text())["mcp_servers"]
                self.assertEqual(servers["docs"], {"url": "https://example.com"})
                self.assertEqual(servers["intellij"]["http_headers"]["X"], "keep")

    def test_rejects_invalid_parameters_before_creating_files(self) -> None:
        """Invalid paths, ports, and names cannot redirect or corrupt edits."""
        changes = [
            {"port": 0}, {"port": 65536}, {"server_name": "bad.name"},
            {"project_root": "relative"}, {"ide_project_path": "relative"},
            {"ide_project_path": str(self.root / "missing")},
            {"project_root": str(self.home.parent)},
        ]
        global_before = self.global_config.read_bytes()
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.apply(**change)
        self.assertFalse(self.config.parent.exists())
        self.assertEqual(self.global_config.read_bytes(), global_before)

    @unittest.skipIf(os.name == "nt", "link creation needs elevated Windows privileges")
    def test_rejects_symlinks_and_hard_links(self) -> None:
        """Linked paths cannot modify a configuration outside the target project."""
        original = self.global_config.read_bytes()
        self.config.parent.symlink_to(self.home, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.apply()
        self.config.parent.unlink()
        self.config.parent.mkdir()
        self.config.symlink_to(self.global_config)
        with self.assertRaises(ValueError):
            self.apply()
        self.config.unlink()
        os.link(self.global_config, self.config)
        with self.assertRaises(ValueError):
            self.apply()
        self.assertEqual(self.global_config.read_bytes(), original)

    def test_failure_before_atomic_replace_keeps_original(self) -> None:
        """An OS replacement failure retains both the original and its backup."""
        self.seed()
        with patch.object(EDITOR.os, "replace", side_effect=OSError("simulated failure")):
            with self.assertRaises(OSError):
                self.apply()
        self.assertEqual(self.config.read_text(), EXISTING)
        self.assertEqual(list(self.config.parent.glob(".config.toml.*")), [])
        backups = list(self.config.parent.glob("*.bak"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), EXISTING)

    def test_detects_edits_before_replacement(self) -> None:
        """A changed file is retained rather than replaced by an older snapshot."""
        self.seed()
        original = EDITOR.snapshot(self.config)
        self.config.write_text("# Another editor's changes.\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "changed during editing"):
            EDITOR.write_atomic(self.config, original, b"# Outdated proposed content.\n")
        self.assertEqual(self.config.read_text(), "# Another editor's changes.\n")
        self.assertEqual(list(self.config.parent.glob("*.bak")), [])

    def test_cli_reports_errors_and_dry_run(self) -> None:
        """The public command accepts parameters and exits clearly on failure."""
        arguments = [
            sys.executable, str(SCRIPT), "--project-root", str(self.project),
            "--port", "64342", "--ide-project-path", str(self.ide),
        ]
        preview = subprocess.run(arguments + ["--dry-run"], capture_output=True, text=True, check=True)
        self.assertIn("+url =", preview.stdout)
        self.assertFalse(self.config.exists())
        self.seed("invalid = [\n")
        failure = subprocess.run(arguments, capture_output=True, text=True)
        self.assertEqual(failure.returncode, 1)
        self.assertIn("Error:", failure.stderr)
        self.assertNotIn("Traceback", failure.stderr)
        self.assertEqual(self.config.read_text(), "invalid = [\n")

    @unittest.skipUnless(os.environ.get("CODEX_TEST_BINARY"), "Run through npm run test:python for real Codex validation")
    def test_codex_resolves_separate_project_registrations(self) -> None:
        """Codex reads the helper's per-project URL and escaped header values."""
        projects = [self.project, self.root / "other project"]
        projects[1].mkdir()
        user_config = tomlkit.document()
        for project in projects:
            user_config.setdefault("projects", {})[str(project)] = {"trust_level": "trusted"}
        self.global_config.write_text(tomlkit.dumps(user_config), encoding="utf-8")
        global_before = self.global_config.read_bytes()
        for index, project in enumerate(projects):
            subprocess.run([
                sys.executable, str(SCRIPT), "--project-root", str(project),
                "--port", str(55550 + index), "--ide-project-path", str(self.ide),
                "--server-name", "jetbrains",
            ], check=True, capture_output=True, text=True)
            result = subprocess.run(
                [os.environ["CODEX_TEST_BINARY"], "mcp", "get", "jetbrains", "--json"],
                cwd=project,
                env={"PATH": os.environ["PATH"], "CODEX_HOME": str(self.home)},
                check=True, capture_output=True, text=True, timeout=30,
            )
            transport = json.loads(result.stdout)["transport"]
            self.assertEqual(transport["type"], "streamable_http")
            self.assertEqual(transport["url"], f"http://127.0.0.1:{55550 + index}/stream")
            self.assertEqual(transport["http_headers"][EDITOR.PROJECT_HEADER], str(self.ide))
        self.assertEqual(self.global_config.read_bytes(), global_before)


if __name__ == "__main__":
    unittest.main()
