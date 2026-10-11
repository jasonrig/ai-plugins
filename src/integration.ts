import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { checkProvenance, sourceLock } from './extract.js';
import { exists, toolRoot, writeJson } from './io.js';
import {
  generate,
  loadMarketplace,
  mcpSchema,
  pluginSchema,
  record,
} from './marketplace.js';
import type { Marketplace } from './types.js';

/** Promise-based process runner for bounded Codex CLI commands. */
const exec = promisify(execFile);

/**
 * Assert that a Codex response value is a non-null object rather than an array.
 *
 * @param value - Response data to inspect.
 * @param label - Response field name included in assertion failures.
 * @returns The value narrowed to a string-keyed record.
 * @throws If the response value is not an object.
 */
function object(value: unknown, label: string): Record<string, unknown> {
  assert.ok(record(value), `${label} must be an object`);
  return value;
}

/**
 * Validate a Codex response field as an array of objects.
 *
 * @param value - Response field to inspect.
 * @param label - Field name included in assertion failures.
 * @returns Each array entry narrowed to a string-keyed record.
 * @throws If the field is not an array or an entry is not an object.
 */
function objects(value: unknown, label: string): Record<string, unknown>[] {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  return (value as unknown[]).map((item) => object(item, label));
}

/**
 * Validate a Codex response field as an array of strings.
 *
 * @param value - Response field to inspect.
 * @param label - Field name included in assertion failures.
 * @returns The validated array entries as strings.
 * @throws If the field is not an array or an entry is not a string.
 */
function strings(value: unknown, label: string): string[] {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  return (value as unknown[]).map((item) => {
    assert.equal(typeof item, 'string', `${label} must contain strings`);
    assert.ok(typeof item === 'string');
    return item;
  });
}

/**
 * Require exact name equality without depending on response order.
 * Duplicate names remain significant so they cannot hide an inventory mismatch.
 *
 * @param actual - Names received from Codex, still treated as untrusted data.
 * @param expected - Complete expected inventory of names.
 * @param label - Inventory name included in assertion failures.
 * @throws If an actual name is not a string or the sorted inventories differ.
 */
export function sameNames(actual: unknown[], expected: string[], label: string): void {
  const checked = actual.map((name) => {
    assert.ok(typeof name === 'string', `${label}: name must be a string`);
    return name;
  });
  assert.deepEqual(checked.toSorted(), expected.toSorted(), `${label}: names differ`);
}

/** A JSON-RPC request waiting for a Codex reply, with its timeout and completion callbacks. */
interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Manages an isolated Codex app-server process and its bounded JSON-RPC requests. */
class AppServer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, Pending>();
  private sequence = 0;
  private stderr = '';

  /**
   * Start Codex app-server and connect its replies to pending requests.
   *
   * @param binary - Codex executable under test.
   * @param cwd - Isolated working directory for the child process.
   * @param env - Sanitized environment with a temporary Codex home.
   */
  constructor(binary: string, cwd: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(binary, ['app-server'], { cwd, env, stdio: 'pipe' });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (data: string) => {
      this.stderr += data;
    });
    this.child.on('error', (error) => this.fail(error));
    this.child.on('exit', () =>
      this.fail(new Error(`Codex app-server exited: ${this.stderr}`)),
    );
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', (line) => {
      try {
        const response: unknown = JSON.parse(line);
        if (!record(response) || typeof response.id !== 'number') {
          return;
        }
        const request = this.pending.get(response.id);
        if (request === undefined) {
          return;
        }
        clearTimeout(request.timer);
        this.pending.delete(response.id);
        if ('error' in response) {
          request.reject(new Error(JSON.stringify(response.error)));
        } else if ('result' in response) {
          request.resolve(response.result);
        } else {
          request.reject(new Error(`Invalid JSON-RPC reply: ${line}`));
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Reject all pending requests when the process fails or emits an invalid reply.
   *
   * @param error - Failure passed to each outstanding request.
   */
  private fail(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  /**
   * Send one JSON-RPC request and wait up to 30 seconds for its reply.
   *
   * @param method - Codex app-server method name.
   * @param params - JSON-compatible request parameters.
   * @returns Unvalidated result data from the matching reply.
   * @throws If Codex reports an error, exits, or fails to reply before the timeout.
   */
  async call(method: string, params: unknown): Promise<unknown> {
    this.sequence += 1;
    const id = this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out: ${this.stderr}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  /**
   * Complete the app-server handshake with experimental plugin APIs enabled.
   *
   * @returns Resolves after initialization succeeds and its notification is sent.
   * @throws If Codex rejects initialization or the request fails.
   */
  async initialize(): Promise<void> {
    await this.call('initialize', {
      clientInfo: { name: 'marketplace-ci', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    this.child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
  }

  /**
   * Close app-server input and force termination if it does not exit within five seconds.
   *
   * @returns Resolves once the child process has exited, including an earlier exit.
   */
  async close(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return;
    }
    const finished = new Promise<void>((resolve) => {
      this.child.once('exit', () => resolve());
    });
    this.child.stdin.end();
    const timer = setTimeout(() => {
      this.child.kill('SIGKILL');
    }, 5000);
    try {
      await finished;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Build a test environment that inherits platform settings without account credentials.
 *
 * @param home - Temporary directory assigned to `CODEX_HOME`.
 * @returns The environment passed to Codex subprocesses.
 */
function isolatedEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { CODEX_HOME: home };
  for (const key of ['PATH', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'TZ']) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * Run a Codex CLI command with a 30-second deadline and bounded output.
 *
 * @param binary - Codex executable under test.
 * @param args - Command arguments passed directly without a shell.
 * @param cwd - Isolated working directory for the child process.
 * @param env - Sanitized environment with a temporary Codex home.
 * @returns Standard output from the completed command.
 * @throws If the command fails, times out, or exceeds the output limit.
 */
async function cli(
  binary: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const result = await exec(binary, args, {
    cwd,
    env,
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.stdout;
}

/**
 * Run a Codex CLI command and require its standard output to be a JSON object.
 *
 * @param binary - Codex executable under test.
 * @param args - Command arguments that request JSON output.
 * @param cwd - Isolated working directory for the child process.
 * @param env - Sanitized environment with a temporary Codex home.
 * @returns Parsed CLI output narrowed to a string-keyed record.
 * @throws If the command fails or its output is not a JSON object.
 */
async function cliJson(
  binary: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await cli(binary, args, cwd, env));
  return object(value, 'CLI result');
}

/**
 * Exercise discovery, installation, component reads, and removal with the real Codex CLI.
 *
 * @param binary - Codex executable under test.
 * @param marketplace - Validated snapshot or fixture to register with Codex.
 * @param scratch - Directory for the isolated Codex home and working directory.
 * @returns Resolves when CLI and app-server results match every expected plugin and component.
 * @throws If a command fails or Codex omits, duplicates, or misreads a declared component.
 */
async function checkMarketplace(
  binary: string,
  marketplace: Marketplace,
  scratch: string,
): Promise<void> {
  const home = path.join(scratch, 'home');
  const work = path.join(scratch, 'work');
  await mkdir(home, { recursive: true });
  await mkdir(work, { recursive: true });
  const env = isolatedEnv(home);
  const name = marketplace.catalog.name;
  const registration = await cliJson(
    binary,
    ['plugin', 'marketplace', 'add', marketplace.root, '--json'],
    work,
    env,
  );
  assert.equal(registration.marketplaceName, name, 'CLI must register the marketplace');
  const registered = await cliJson(
    binary,
    ['plugin', 'marketplace', 'list', '--json'],
    work,
    env,
  );
  sameNames(
    objects(registered.marketplaces, 'registered marketplaces').map(
      (entry) => entry.name,
    ),
    [name],
    'CLI marketplace registrations',
  );
  const listed = await cliJson(
    binary,
    ['plugin', 'list', '--available', '--json', '--marketplace', name],
    work,
    env,
  );
  const expected = marketplace.plugins.map((plugin) => plugin.entry.name);
  sameNames(
    objects(listed.available, 'available plugins').map((plugin) => plugin.name),
    expected,
    'CLI catalog',
  );
  for (const plugin of marketplace.plugins) {
    await cliJson(
      binary,
      ['plugin', 'add', `${plugin.entry.name}@${name}`, '--json'],
      work,
      env,
    );
  }
  const installed = await cliJson(
    binary,
    ['plugin', 'list', '--json', '--marketplace', name],
    work,
    env,
  );
  const installedPlugins = objects(installed.installed, 'installed plugins');
  sameNames(
    installedPlugins.map((plugin) => plugin.name),
    expected,
    'CLI installs',
  );
  for (const plugin of marketplace.plugins) {
    const actual = installedPlugins.find(
      (candidate) => candidate.name === plugin.entry.name,
    );
    assert.equal(
      actual?.version,
      plugin.manifest.version,
      `${plugin.entry.name}: installed version`,
    );
    assert.equal(actual?.enabled, true, `${plugin.entry.name}: plugin must be enabled`);
  }
  const server = new AppServer(binary, work, env);
  try {
    await server.initialize();
    const catalog = object(
      await server.call('plugin/list', { cwds: [work], marketplaceKinds: ['local'] }),
      'plugin/list',
    );
    assert.deepEqual(
      catalog.marketplaceLoadErrors,
      [],
      'Codex must load the marketplace without errors',
    );
    const match = objects(catalog.marketplaces, 'marketplaces').find(
      (candidate) => candidate.name === name,
    );
    if (match === undefined) {
      // Codex 0.146.0 omits empty catalogs from app-server plugin/list.
      // CLI registration is checked above; populated catalogs must still appear here.
      assert.equal(
        expected.length,
        0,
        'Codex app-server must see a populated registered marketplace',
      );
    } else {
      sameNames(
        objects(match.plugins, 'marketplace plugins').map((plugin) => plugin.name),
        expected,
        'app-server catalog',
      );
      assert.equal(typeof match.path, 'string');
      for (const plugin of marketplace.plugins) {
        const detail = object(
          await server.call('plugin/read', {
            pluginName: plugin.entry.name,
            marketplacePath: match.path,
          }),
          'plugin/read',
        );
        const loaded = object(detail.plugin, 'plugin detail');
        const summary = object(loaded.summary, 'plugin summary');
        assert.equal(
          summary.localVersion,
          plugin.manifest.version,
          `${plugin.entry.name}: read version`,
        );
        assert.equal(
          loaded.description,
          plugin.manifest.description,
          `${plugin.entry.name}: description`,
        );
        sameNames(
          objects(loaded.skills, 'plugin skills').map((skill) => skill.name),
          plugin.skills.map((skill) => `${plugin.entry.name}:${skill.name}`),
          `${plugin.entry.name}: skills`,
        );
        sameNames(
          strings(loaded.mcpServers, 'MCP names'),
          Object.keys(plugin.mcp?.mcpServers ?? {}),
          `${plugin.entry.name}: MCP servers`,
        );
        const expectedEvents = plugin.hooks
          .flatMap((hooks) => Object.entries(object(hooks.hooks, 'hook events')))
          .flatMap(([event, groups]) =>
            objects(groups, 'hook groups').flatMap((group) =>
              objects(group.hooks, 'hook commands').map(
                () => event.slice(0, 1).toLowerCase() + event.slice(1),
              ),
            ),
          );
        sameNames(
          objects(loaded.hooks, 'plugin hooks').map((hook) => hook.eventName),
          expectedEvents,
          `${plugin.entry.name}: hooks`,
        );
      }
    }
    const result = object(
      await server.call('skills/list', { cwds: [work], forceReload: true }),
      'skills/list',
    );
    const entries = objects(result.data, 'skills/list data');
    const entry = entries.find((candidate) => candidate.cwd === work);
    assert.ok(entry, 'skills/list must include the test workspace');
    assert.deepEqual(entry.errors, [], 'Installed skills must parse without errors');
    const skills = objects(entry.skills, 'installed skills');
    const pluginSkills = skills.filter((skill) => {
      const skillName = skill.name;
      return (
        typeof skillName === 'string' &&
        expected.some((prefix) => skillName.startsWith(`${prefix}:`))
      );
    });
    sameNames(
      pluginSkills.map((skill) => skill.name),
      marketplace.plugins.flatMap((plugin) =>
        plugin.skills.map((skill) => `${plugin.entry.name}:${skill.name}`),
      ),
      'installed skill discovery',
    );
  } finally {
    await server.close();
  }
  for (const plugin of marketplace.plugins) {
    await cli(binary, ['plugin', 'remove', `${plugin.entry.name}@${name}`], work, env);
  }
  const removed = await cliJson(
    binary,
    ['plugin', 'list', '--json', '--marketplace', name],
    work,
    env,
  );
  sameNames(
    objects(removed.installed, 'remaining plugins').map((plugin) => plugin.name),
    [],
    'CLI removals',
  );
  console.log(
    expected.length === 0
      ? `Codex registered and validated the empty ${name} marketplace.`
      : `Codex loaded, installed, read, discovered, and removed ${expected.length} plugins from ${name}.`,
  );
}

/**
 * Create a generated test marketplace covering skills, both MCP transports, and multiple hooks.
 *
 * @param root - Temporary directory in which to create the fixture.
 * @returns Resolves after authored files and their generated Codex documents are written.
 */
async function componentFixture(root: string): Promise<void> {
  const plugin = path.join(root, 'plugins/components');
  await mkdir(path.join(plugin, 'skills/example'), { recursive: true });
  await writeJson(path.join(root, 'marketplace.config.json'), {
    name: 'ci-components',
    interface: { displayName: 'CI components' },
    plugins: [
      {
        name: 'components',
        path: 'plugins/components',
        category: 'Testing',
        authentication: 'ON_USE',
      },
    ],
  });
  await writeJson(path.join(plugin, 'plugin.json'), {
    $schema: pluginSchema,
    name: 'components',
    version: '1.2.3',
    description: 'CI component coverage.',
    extensions: {
      'com.openai': {
        hooks: {
          hooks: {
            SessionStart: [
              {
                hooks: [
                  { type: 'command', command: 'echo component-fixture' },
                  { type: 'command', command: 'echo second-command' },
                ],
              },
              {
                matcher: 'startup',
                hooks: [{ type: 'command', command: 'echo second-group' }],
              },
            ],
            Stop: [{ hooks: [{ type: 'command', command: 'echo stop-fixture' }] }],
          },
        },
      },
    },
  });
  await writeFile(
    path.join(plugin, 'skills/example/SKILL.md'),
    '---\nname: example\ndescription: Use for the integration test example.\n---\n\nExplain this test fixture.\n',
  );
  await writeJson(path.join(plugin, 'mcp.config.json'), {
    $schema: mcpSchema,
    mcpServers: {
      stdio: { type: 'stdio', command: 'node', args: ['-e', 'process.exit(0)'] },
      remote: {
        type: 'streamable-http',
        url: 'https://example.invalid/mcp',
        headers: { 'X-Test': 'fixture' },
      },
    },
  });
  await generate(await loadMarketplace(root), false);
}

/**
 * Prove that inventory comparison detects a plugin Codex silently omits.
 *
 * @param binary - Codex executable under test.
 * @param root - Temporary directory for a catalog with an unsupported source type.
 * @returns Resolves when the omitted plugin produces the expected inventory failure.
 * @throws If the control no longer triggers the expected failure or a CLI command fails.
 */
async function negativeControl(binary: string, root: string): Promise<void> {
  const repo = path.join(root, 'repository');
  const home = path.join(root, 'home');
  const work = path.join(root, 'work');
  await mkdir(work, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeJson(path.join(repo, '.agents/plugins/marketplace.json'), {
    name: 'ci-negative',
    plugins: [
      {
        name: 'ghost',
        source: { source: 'unsupported-ci-control', path: './plugins/ghost' },
      },
    ],
  });
  const env = isolatedEnv(home);
  await cli(binary, ['plugin', 'marketplace', 'add', repo], work, env);
  const result = await cliJson(
    binary,
    ['plugin', 'list', '--available', '--json', '--marketplace', 'ci-negative'],
    work,
    env,
  );
  const names = objects(result.available, 'negative catalog').map(
    (plugin) => plugin.name,
  );
  assert.throws(() => sameNames(names, ['ghost'], 'negative control'), /names differ/u);
  console.log('Negative control detected a plugin that Codex silently omitted.');
}

/**
 * Test a repository snapshot, empty and component fixtures, and an omission control.
 * The CLI must match the source pin unless the latest-version canary is enabled.
 *
 * @returns Resolves after every integration check passes and temporary files are removed.
 * @throws If provenance, generated files, the CLI version, or any integration check fails.
 */
async function main(): Promise<void> {
  await checkProvenance();
  const marketplace = await loadMarketplace(process.cwd());
  await generate(marketplace, true);
  const binary =
    process.env.CODEX_BIN ?? path.join(toolRoot, 'node_modules/.bin/codex');
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'marketplace-codex-'));
  try {
    const version = (
      await cli(
        binary,
        ['--version'],
        scratch,
        isolatedEnv(path.join(scratch, 'version-home')),
      )
    ).trim();
    const lock = await sourceLock();
    if (process.env.CODEX_CANARY !== '1') {
      assert.equal(
        version,
        `codex-cli ${lock.version}`,
        'CLI version must match the schema source pin',
      );
    }
    console.log(`Testing ${version}.`);
    const snapshot = path.join(scratch, 'repository');
    await mkdir(snapshot);
    for (const file of ['marketplace.config.json', '.agents']) {
      await cp(path.join(marketplace.root, file), path.join(snapshot, file), {
        recursive: true,
      });
    }
    const pluginRoot = path.join(marketplace.root, 'plugins');
    if (await exists(pluginRoot)) {
      await cp(pluginRoot, path.join(snapshot, 'plugins'), { recursive: true });
    }
    await checkMarketplace(
      binary,
      await loadMarketplace(snapshot),
      path.join(scratch, 'marketplace-test'),
    );
    const empty = path.join(scratch, 'empty');
    await writeJson(path.join(empty, 'marketplace.config.json'), {
      name: 'ci-empty',
      interface: { displayName: 'CI empty marketplace' },
      plugins: [],
    });
    const emptyMarketplace = await loadMarketplace(empty);
    await generate(emptyMarketplace, false);
    await checkMarketplace(binary, emptyMarketplace, path.join(scratch, 'empty-test'));
    const fixture = path.join(scratch, 'components');
    await componentFixture(fixture);
    await checkMarketplace(
      binary,
      await loadMarketplace(fixture),
      path.join(scratch, 'component-test'),
    );
    await negativeControl(binary, path.join(scratch, 'negative'));
    // The original working copy and user Codex configuration are never passed to Codex.
    assert.equal(
      await readFile(path.join(snapshot, 'marketplace.config.json'), 'utf8'),
      await readFile(path.join(marketplace.root, 'marketplace.config.json'), 'utf8'),
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (path.resolve(process.argv[1] ?? '') === path.join(toolRoot, 'src/integration.ts')) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
