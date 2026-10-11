import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { promisify } from 'node:util';
import { checkProvenance, verifySource } from '../src/extract.js';
import { sameNames } from '../src/integration.js';
import { readJson, sha256, toolRoot, writeJson } from '../src/io.js';
import {
  generate,
  generatedFiles,
  loadMarketplace,
  mcpSchema,
  record,
  runtimeMcp,
} from '../src/marketplace.js';
import { Schemas } from '../src/schemas.js';

/**
 * Copy a private test marketplace without reading the published catalog or plugins.
 *
 * @param t - Test context that removes the fixture after the test completes.
 * @param populated - Keep the sample plugin when true; create an empty marketplace otherwise.
 * @returns The temporary marketplace directory.
 */
async function fixture(t: TestContext, populated = true): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'marketplace-unit-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await cp(path.join(toolRoot, 'test/fixtures/marketplace'), root, {
    recursive: true,
  });
  if (!populated) {
    await rm(path.join(root, 'plugins'), { recursive: true });
    await change(path.join(root, 'marketplace.config.json'), (value) => {
      value.plugins = [];
    });
  }
  return root;
}

/**
 * Edit an authored JSON object to exercise a validation failure or supported component.
 *
 * @param file - Fixture JSON file to read and overwrite.
 * @param edit - Callback that changes the parsed object in place.
 * @returns Resolves after the edited object has been written.
 */
async function change(
  file: string,
  edit: (value: Record<string, unknown>) => void,
): Promise<void> {
  const value = await readJson(file);
  assert.ok(record(value));
  edit(value);
  await writeJson(file, value);
}

await test('checked-in schemas and upstream files match their provenance', async () => {
  await checkProvenance();
});

await test('source hash verification refuses changed input', () => {
  const content = Buffer.from('pinned source');
  verifySource(content, sha256(content), 'test.rs');
  assert.throws(
    () => verifySource(content, '0'.repeat(64), 'test.rs'),
    /SHA-256 differs/u,
  );
});

await test('a complete marketplace generates valid deterministic Codex files', async (t) => {
  const root = await fixture(t);
  const marketplace = await loadMarketplace(root);
  assert.deepEqual(
    marketplace.plugins.map((plugin) => plugin.entry.name),
    ['sample'],
  );
  await generate(marketplace, false);
  await generate(marketplace, true);
  const files = generatedFiles(marketplace);
  assert.equal(files.size, 2);
});

await test('empty marketplaces work with or without a plugins directory', async (t) => {
  const root = await fixture(t, false);
  for (const hasDirectory of [false, true]) {
    if (hasDirectory) {
      await mkdir(path.join(root, 'plugins'));
    }
    const marketplace = await loadMarketplace(root);
    assert.deepEqual(marketplace.plugins, []);
    assert.equal(generatedFiles(marketplace).size, 1);
    await generate(marketplace, false);
    await generate(marketplace, true);
    assert.deepEqual(
      await readJson(path.join(root, '.agents/plugins/marketplace.json')),
      {
        name: 'test-plugins',
        interface: { displayName: 'Unit test plugins' },
        plugins: [],
      },
    );
  }
});

await test('removing the last plugin produces a valid empty marketplace', async (t) => {
  const root = await fixture(t);
  await generate(await loadMarketplace(root), false);
  await rm(path.join(root, 'plugins'), { recursive: true });
  await change(path.join(root, 'marketplace.config.json'), (value) => {
    value.plugins = [];
  });
  const marketplace = await loadMarketplace(root);
  await assert.rejects(generate(marketplace, true), /stale/u);
  await generate(marketplace, false);
  await generate(marketplace, true);
  const manifest = await readJson(path.join(root, '.agents/plugins/marketplace.json'));
  assert.ok(record(manifest));
  assert.deepEqual(manifest.plugins, []);
});

for (const populated of [false, true]) {
  await test(
    populated
      ? 'the new-plugin command creates a complete package and updates the catalog'
      : 'the new-plugin command creates the first plugin without a plugins directory',
    async (t) => {
      const root = await fixture(t, populated);
      const exec = promisify(execFile);
      await exec(
        process.execPath,
        [
          '--import',
          import.meta.resolve('tsx'),
          path.join(toolRoot, 'src/cli.ts'),
          'new',
          'new-skill',
        ],
        { cwd: root, timeout: 30_000 },
      );
      const marketplace = await loadMarketplace(root);
      assert.deepEqual(
        marketplace.plugins.map((plugin) => plugin.entry.name),
        populated ? ['sample', 'new-skill'] : ['new-skill'],
      );
      assert.equal(
        marketplace.plugins.find((plugin) => plugin.entry.name === 'new-skill')
          ?.skills[0]?.name,
        'new-skill',
      );
      await generate(marketplace, true);
      await assert.rejects(
        exec(
          process.execPath,
          [
            '--import',
            import.meta.resolve('tsx'),
            path.join(toolRoot, 'src/cli.ts'),
            'new',
            'new-skill',
          ],
          { cwd: root, timeout: 30_000 },
        ),
        /Plugin already exists/u,
      );
    },
  );
}

await test('unlisted plugin directories fail the inventory check', async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'plugins/forgotten'));
  await assert.rejects(loadMarketplace(root), /Unlisted plugin directory/u);
});

await test('an empty catalog still rejects unlisted plugin directories', async (t) => {
  const root = await fixture(t, false);
  await mkdir(path.join(root, 'plugins/forgotten'), { recursive: true });
  await assert.rejects(loadMarketplace(root), /Unlisted plugin directory/u);
});

await test('declared plugins must exist', async (t) => {
  const root = await fixture(t);
  await rm(path.join(root, 'plugins/sample'), { recursive: true });
  await assert.rejects(loadMarketplace(root), /ENOENT/u);
});

await test('a missing plugins directory cannot hide declared plugins', async (t) => {
  const root = await fixture(t);
  await rm(path.join(root, 'plugins'), { recursive: true });
  await assert.rejects(loadMarketplace(root), /ENOENT/u);
});

await test('duplicate catalog entries are rejected', async (t) => {
  const root = await fixture(t);
  await change(path.join(root, 'marketplace.config.json'), (value) => {
    assert.ok(Array.isArray(value.plugins));
    value.plugins.push(value.plugins[0]);
  });
  await assert.rejects(loadMarketplace(root), /Duplicate plugin/u);
});

await test('catalog paths cannot escape the repository', async (t) => {
  const root = await fixture(t);
  await change(path.join(root, 'marketplace.config.json'), (value) => {
    value.plugins = [
      {
        name: 'sample',
        path: '../sample',
        category: 'Testing',
        authentication: 'ON_USE',
      },
    ];
  });
  await assert.rejects(loadMarketplace(root), /schema validation failed/u);
});

await test('each plugin needs its own manifest and matching identity', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'plugins/sample/plugin.json');
  await change(file, (value) => {
    value.name = 'renamed';
  });
  await assert.rejects(loadMarketplace(root), /name must match/u);
  await rm(file);
  await assert.rejects(loadMarketplace(root), /ENOENT/u);
});

await test('portable manifests reject typos and missing release metadata', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'plugins/sample/plugin.json');
  await change(file, (value) => {
    value.versoin = '1.0.0';
  });
  await assert.rejects(loadMarketplace(root), /schema validation failed/u);
  await change(file, (value) => {
    delete value.versoin;
    value.version = 'next';
  });
  await assert.rejects(loadMarketplace(root), /semantic version/u);
  await change(file, (value) => {
    value.version = '1.0.0';
    delete value.description;
  });
  await assert.rejects(loadMarketplace(root), /description must be/u);
});

await test('JSON duplicate keys do not silently hide declarations', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'duplicate.json');
  await writeFile(file, '{"name":"first","name":"hidden"}');
  await assert.rejects(readJson(file), /unique/u);
});

await test('plugin packages reject symlinks', async (t) => {
  const root = await fixture(t);
  await symlink(
    path.join(root, 'marketplace.config.json'),
    path.join(root, 'plugins/sample/link.json'),
  );
  await assert.rejects(loadMarketplace(root), /Symlinks are not supported/u);
});

await test('skills require valid names, descriptions, and declared locations', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'plugins/sample/skills/sample/SKILL.md');
  await writeFile(
    file,
    '---\nname: wrong\ndescription: Wrong name.\n---\n\nInstructions.\n',
  );
  await assert.rejects(loadMarketplace(root), /name must match its directory/u);
  await writeFile(
    file,
    '---\nname: sample\nname: duplicate\ndescription: Duplicate.\n---\n\nInstructions.\n',
  );
  await assert.rejects(loadMarketplace(root), /invalid YAML/u);
});

await test('generated catalog edits fail instead of changing inventory', async (t) => {
  const root = await fixture(t);
  const marketplace = await loadMarketplace(root);
  await generate(marketplace, false);
  const file = path.join(root, '.agents/plugins/marketplace.json');
  await change(file, (value) => {
    value.plugins = [];
  });
  await assert.rejects(generate(marketplace, true), /stale/u);
  await generate(marketplace, false);
  await rm(path.join(root, 'plugins/sample/.codex-plugin/plugin.json'));
  await assert.rejects(generate(marketplace, true), /missing or stale/u);
});

await test('source-derived schemas exclude permissive manifest fallbacks', async () => {
  const schemas = new Schemas();
  const marketplace = {
    name: 'test',
    plugins: [
      { name: 'sample', source: { source: 'local', path: './plugins/sample' } },
    ],
  };
  await schemas.check('generated/codex-marketplace.schema.json', marketplace, 'valid');
  for (const source of [
    42,
    { source: 'unknown' },
    { source: 'local', path: false },
    { source: 'local', path: './plugins/sample', typo: true },
  ]) {
    await assert.rejects(
      schemas.check(
        'generated/codex-marketplace.schema.json',
        {
          name: 'test',
          plugins: [{ name: 'sample', source }],
        },
        'bad source',
      ),
      /schema validation failed/u,
    );
  }
  for (const malformed of [
    { skills: 12 },
    { mcpServers: [] },
    { hooks: true },
    { interface: { defaultPrompt: [false] } },
    { unknown: 'ignored' },
  ]) {
    await assert.rejects(
      schemas.check(
        'generated/codex-plugin.schema.json',
        { name: 'sample', ...malformed },
        'bad manifest',
      ),
      /schema validation failed/u,
    );
  }
  await assert.rejects(
    schemas.check(
      'generated/codex-marketplace.schema.json',
      {
        name: 'test',
        plugins: [
          {
            name: 'sample',
            source: './plugins/sample',
            description: 'fallback metadata',
          },
        ],
      },
      'catalog fallback',
    ),
    /schema validation failed/u,
  );
});

await test('OpenAI extension typos, unsupported components, and missing assets fail', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'plugins/sample/plugin.json');
  await change(file, (value) => {
    value.extensions = { 'com.openai': { interface: { dispalyName: 'Typo' } } };
  });
  await assert.rejects(loadMarketplace(root), /schema validation failed/u);
  await change(file, (value) => {
    value.extensions = { 'com.openai': { apps: './apps.json' } };
  });
  await assert.rejects(
    loadMarketplace(root),
    /com.openai supports interface and hooks/u,
  );
  await change(file, (value) => {
    value.extensions = { 'com.openai': { interface: { logo: './missing.svg' } } };
  });
  await assert.rejects(loadMarketplace(root), /ENOENT/u);
});

await test('MCP generation translates headers and validates Codex runtime configuration', async (t) => {
  const root = await fixture(t);
  await writeJson(path.join(root, 'plugins/sample/mcp.config.json'), {
    $schema: mcpSchema,
    mcpServers: {
      local: { type: 'stdio', command: 'node', args: ['--version'] },
      remote: {
        type: 'streamable-http',
        url: 'https://example.invalid/mcp',
        headers: { 'X-Example': 'test' },
      },
    },
  });
  const marketplace = await loadMarketplace(root);
  await generate(marketplace, false);
  await generate(marketplace, true);
  assert.deepEqual(await readJson(path.join(root, 'plugins/sample/mcp.json')), {
    mcpServers: {
      local: { command: 'node', args: ['--version'], cwd: './' },
      remote: {
        url: 'https://example.invalid/mcp',
        http_headers: { 'X-Example': 'test' },
      },
    },
  });
  assert.deepEqual(runtimeMcp({ $schema: mcpSchema, mcpServers: {} }), {
    mcpServers: {},
  });
});

await test('MCP files reject missing executables, unsupported transports, and malformed URLs', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'plugins/sample/mcp.config.json');
  for (const [server, message] of [
    [{ type: 'stdio', command: './missing' }, /ENOENT/u],
    [{ type: 'stdio', command: '/bin/sh' }, /must be relative/u],
    [{ type: 'stdio', command: 'node', args: ['./missing.mjs'] }, /ENOENT/u],
    [{ type: 'sse', url: 'https://example.invalid/mcp' }, /legacy SSE/u],
    [{ type: 'streamable-http', url: 'file:///secret' }, /HTTP or HTTPS/u],
    [
      { type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/server.js'] },
      /runtime expansion/u,
    ],
  ] as const) {
    await writeJson(file, { $schema: mcpSchema, mcpServers: { example: server } });
    await assert.rejects(loadMarketplace(root), message);
  }
});

await test('MCP relative file references use the declared plugin working directory', async (t) => {
  const root = await fixture(t);
  const plugin = path.join(root, 'plugins/sample');
  await mkdir(path.join(plugin, 'servers'));
  await writeFile(path.join(plugin, 'servers/example.mjs'), 'process.exit(0);\n');
  const file = path.join(plugin, 'mcp.config.json');
  await writeJson(file, {
    $schema: mcpSchema,
    mcpServers: {
      example: {
        type: 'stdio',
        command: 'node',
        cwd: './servers',
        args: ['./example.mjs'],
      },
    },
  });
  await loadMarketplace(root);
  await writeJson(file, {
    $schema: mcpSchema,
    mcpServers: {
      example: {
        type: 'stdio',
        command: 'node',
        cwd: './',
        args: ['./servers/example.mjs'],
      },
    },
  });
  await loadMarketplace(root);
});

await test('hook references must exist and hook events must be valid', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'plugins/sample/plugin.json');
  await change(file, (value) => {
    value.extensions = { 'com.openai': { hooks: './hooks.json' } };
  });
  await assert.rejects(loadMarketplace(root), /ENOENT/u);
  const hookFile = path.join(root, 'plugins/sample/hooks.json');
  await writeJson(hookFile, { hooks: { MisspelledEvent: [] } });
  await assert.rejects(loadMarketplace(root), /schema validation failed/u);
  await writeJson(hookFile, {
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hook' }] }] },
  });
  assert.equal((await loadMarketplace(root)).plugins[0]?.hooks.length, 1);
});

await test('integration comparisons reject omissions, extras, and duplicates', () => {
  sameNames(['beta', 'alpha'], ['alpha', 'beta'], 'valid');
  for (const actual of [[], ['alpha', 'beta'], ['alpha', 'alpha']]) {
    assert.throws(() => sameNames(actual, ['alpha'], 'inventory'), /names differ/u);
  }
});

await test('stale MCP output is detected and generation removes it', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'plugins/sample/mcp.json');
  await writeFile(file, '{}\n');
  const marketplace = await loadMarketplace(root);
  await generate(marketplace, false);
  await assert.rejects(readFile(file), /ENOENT/u);
});
