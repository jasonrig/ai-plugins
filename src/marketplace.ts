import { lstat, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { valid as validVersion } from 'semver';
import { parseDocument } from 'yaml';
import {
  containedPath,
  exists,
  filesBelow,
  jsonText,
  readJson,
  writeJson,
} from './io.js';
import { Schemas } from './schemas.js';
import type {
  Catalog,
  Marketplace,
  McpManifest,
  Plugin,
  PluginManifest,
  Skill,
} from './types.js';

/** Portable plugin schema URI required in authored `plugin.config.json` files. */
export const pluginSchema =
  'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
/** Portable MCP schema URI required in authored `mcp.config.json` files. */
export const mcpSchema = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
/** Allowed plugin, skill, and MCP server names: lowercase words with single hyphens. */
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Narrow unknown JSON data to a non-null object that is not an array.
 *
 * @param value - Data whose properties the caller wants to inspect.
 * @returns Whether the value can be inspected as a string-keyed record.
 */
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Require authored text to be nonempty and free of surrounding whitespace.
 *
 * @param value - Field value to validate and narrow to a string.
 * @param label - Field or component name included in the error.
 * @throws If the value is not a trimmed, nonempty string.
 */
function text(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value !== value.trim()
  ) {
    throw new Error(`${label} must be a nonempty string with no surrounding spaces`);
  }
}

/**
 * Discover skills and check their layout, front matter, and instruction content.
 *
 * @param root - Plugin directory that contains the fixed `skills` directory.
 * @param files - File inventory already checked for symbolic links.
 * @returns Skills whose names match their directories and have valid descriptions.
 * @throws If a skill is misplaced, incomplete, or has invalid or duplicate metadata.
 */
async function skillFiles(root: string, files: string[]): Promise<Skill[]> {
  const skills: Skill[] = [];
  for (const file of files.filter(
    (candidate) => path.basename(candidate) === 'SKILL.md',
  )) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (!/^skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/u.test(relative)) {
      throw new Error(`${file}: put each skill in skills/<name>/SKILL.md`);
    }
    const content = await readFile(file, 'utf8');
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/u.exec(content);
    const frontmatter = match?.[1];
    if (frontmatter === undefined || match?.[2]?.trim().length === 0) {
      throw new Error(`${file}: include YAML front matter and skill instructions`);
    }
    const document = parseDocument(frontmatter, { uniqueKeys: true });
    if (document.errors.length > 0) {
      throw new Error(
        `${file}: invalid YAML: ${document.errors.map((e) => e.message).join('; ')}`,
      );
    }
    const metadata: unknown = document.toJS();
    if (!record(metadata)) {
      throw new Error(`${file}: front matter must be an object`);
    }
    text(metadata.name, `${file}: name`);
    text(metadata.description, `${file}: description`);
    if (
      !namePattern.test(metadata.name) ||
      metadata.name.length > 64 ||
      metadata.name !== path.basename(path.dirname(file)) ||
      metadata.description.length > 1024
    ) {
      throw new Error(
        `${file}: invalid skill name or description; name must match its directory`,
      );
    }
    skills.push({ name: metadata.name, file });
  }
  const skillRoot = path.join(root, 'skills');
  if (await exists(skillRoot)) {
    for (const entry of await readdir(skillRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !skills.some((skill) => skill.name === entry.name)) {
        throw new Error(
          `${skillRoot}/${entry.name}: each skill directory needs SKILL.md`,
        );
      }
    }
  }
  return skills;
}

/**
 * Resolve inline hook documents or plugin-relative JSON files and validate commands.
 *
 * @param root - Plugin directory that must contain referenced hook files.
 * @param value - Optional hook document, path, or array of these declarations.
 * @param schemas - Validator for the extracted Codex hook schema.
 * @returns Validated hook documents, or an empty list when hooks are absent.
 * @throws If a reference escapes the root or a document has invalid or empty hooks.
 */
async function hooksFor(
  root: string,
  value: unknown,
  schemas: Schemas,
): Promise<Record<string, unknown>[]> {
  if (value === undefined) {
    return [];
  }
  const inputs = Array.isArray(value) ? (value as unknown[]) : [value];
  const hooks: Record<string, unknown>[] = [];
  for (const input of inputs) {
    const data =
      typeof input === 'string'
        ? await readJson(await containedPath(root, input))
        : input;
    const parsed = await schemas.check<Record<string, unknown>>(
      'generated/codex-hooks.schema.json',
      data,
      `${root}: hooks`,
    );
    if (!record(parsed.hooks) || Object.keys(parsed.hooks).length === 0) {
      throw new Error(`${root}: hooks must declare at least one event`);
    }
    for (const [event, groups] of Object.entries(parsed.hooks)) {
      if (!Array.isArray(groups) || groups.length === 0) {
        throw new Error(`${root}: ${event} must contain a hook group`);
      }
      for (const group of groups as unknown[]) {
        if (!record(group) || !Array.isArray(group.hooks) || group.hooks.length === 0) {
          throw new Error(`${root}: ${event} must contain a hook command`);
        }
        for (const handler of group.hooks as unknown[]) {
          if (!record(handler) || handler.type !== 'command') {
            throw new Error(`${root}: this marketplace supports command hooks only`);
          }
          text(handler.command, `${root}: hook command`);
          if (typeof handler.timeout === 'number' && handler.timeout <= 0) {
            throw new Error(`${root}: hook timeout must be positive`);
          }
        }
      }
    }
    hooks.push(parsed);
  }
  return hooks;
}

/**
 * Check that interface icons and screenshots refer to files inside the plugin.
 *
 * @param root - Plugin directory that must contain each referenced asset.
 * @param extension - Validated `com.openai` metadata from the portable manifest.
 * @returns Resolves when all declared assets exist as regular files.
 * @throws If an asset path is invalid, escapes the plugin, or is not a file.
 */
async function checkAssets(
  root: string,
  extension: Record<string, unknown>,
): Promise<void> {
  const metadata = extension.interface;
  if (!record(metadata)) {
    return;
  }
  for (const key of ['composerIcon', 'logo', 'logoDark', 'screenshots']) {
    const value = metadata[key];
    const paths = Array.isArray(value)
      ? (value as unknown[])
      : value === undefined
        ? []
        : [value];
    for (const asset of paths) {
      text(asset, `${root}: interface.${key}`);
      const file = await containedPath(root, asset);
      if (!(await lstat(file)).isFile()) {
        throw new Error(`${file}: asset must be a file`);
      }
    }
  }
}

/**
 * Apply Codex transport and path constraints beyond the portable MCP schema.
 *
 * @param root - Plugin directory used to resolve working directories and local files.
 * @param manifest - MCP declaration that has passed the portable schema.
 * @returns Resolves when every server uses a supported transport and configuration.
 * @throws If servers are empty, require variable expansion, or use unsupported paths or URLs.
 */
async function checkMcp(root: string, manifest: McpManifest): Promise<void> {
  if (Object.keys(manifest.mcpServers).length === 0) {
    throw new Error(`${root}: mcp.config.json must declare at least one server`);
  }
  for (const [name, server] of Object.entries(manifest.mcpServers)) {
    if (!namePattern.test(name)) {
      throw new Error(`${root}: invalid MCP server name ${name}`);
    }
    if (server.type === 'sse') {
      throw new Error(`${root}: Codex does not support the legacy SSE transport`);
    }
    if (JSON.stringify(server).includes('${')) {
      throw new Error(
        `${root}: MCP path and environment variables need runtime expansion; use relative paths and inherited environment variables`,
      );
    }
    if (server.type === 'stdio') {
      text(server.command, `${root}: ${name}.command`);
      if (/\s/u.test(server.command)) {
        throw new Error(`${root}: MCP command must be one executable token`);
      }
      const cwd = server.cwd ?? './';
      if (
        cwd !== './' &&
        !(await lstat(await containedPath(root, cwd))).isDirectory()
      ) {
        throw new Error(`${root}: MCP cwd must be a directory`);
      }
      if (server.command.includes('/') || server.command.includes('\\')) {
        if (
          path.posix.isAbsolute(server.command) ||
          path.win32.isAbsolute(server.command) ||
          server.command.includes('\\')
        ) {
          throw new Error(
            `${root}: MCP executable paths must be relative to the plugin`,
          );
        }
        const command = path.posix.join(cwd, server.command);
        const file = await containedPath(root, command);
        if (!(await lstat(file)).isFile()) {
          throw new Error(`${file}: MCP command must be a file`);
        }
      }
      for (const arg of server.args ?? []) {
        if (arg.startsWith('./') || arg.startsWith('../')) {
          await containedPath(root, path.posix.join(cwd, arg));
        }
      }
    } else {
      const url = new URL(server.url);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username !== '' ||
        url.password !== ''
      ) {
        throw new Error(
          `${root}: MCP URL must use HTTP or HTTPS without embedded credentials`,
        );
      }
    }
  }
}

/**
 * Load authored marketplace files and validate every declared plugin and component.
 * The catalog and plugin directories must match exactly. Generated files are
 * checked separately by {@link generate} with its check argument set to true.
 * An empty catalog may omit the `plugins` directory.
 *
 * @param root - Marketplace directory containing `marketplace.config.json` and `plugins`.
 * @returns The validated catalog, plugin metadata, skills, MCP servers, and hooks.
 * @throws If a schema, inventory, name, version, reference, or component check fails.
 */
export async function loadMarketplace(root: string): Promise<Marketplace> {
  const schemas = new Schemas();
  const catalog = await schemas.check<Catalog>(
    'catalog.schema.json',
    await readJson(path.join(root, 'marketplace.config.json')),
    'catalog',
  );
  text(catalog.interface.displayName, 'catalog displayName');
  const names = new Set<string>();
  const declared = new Set<string>();
  for (const entry of catalog.plugins) {
    if (names.has(entry.name) || declared.has(entry.path)) {
      throw new Error(`Duplicate plugin name or path: ${entry.name}`);
    }
    if (entry.path !== `plugins/${entry.name}`) {
      throw new Error(`${entry.name}: path must be plugins/${entry.name}`);
    }
    names.add(entry.name);
    declared.add(entry.path);
    text(entry.category, `${entry.name}: category`);
  }
  const inventoryRoot = path.join(root, 'plugins');
  if (await exists(inventoryRoot)) {
    if (!(await lstat(inventoryRoot)).isDirectory()) {
      throw new Error('plugins must be a directory, without a symlink');
    }
    for (const entry of await readdir(inventoryRoot, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) {
        throw new Error(
          `plugins/${entry.name}: plugin inventory accepts directories only`,
        );
      }
      if (!declared.has(`plugins/${entry.name}`)) {
        throw new Error(`Unlisted plugin directory: plugins/${entry.name}`);
      }
    }
  }
  const plugins: Plugin[] = [];
  for (const entry of catalog.plugins) {
    const pluginRoot = await containedPath(root, entry.path);
    const files = await filesBelow(pluginRoot);
    if (files.includes(path.join(pluginRoot, 'plugin.json'))) {
      throw new Error(
        `${entry.name}: root plugin.json overrides the Codex manifest; use plugin.config.json`,
      );
    }
    const manifest = await schemas.check<PluginManifest>(
      'upstream/plugin.schema.json',
      await readJson(path.join(pluginRoot, 'plugin.config.json')),
      entry.name,
    );
    if (manifest.name !== entry.name) {
      throw new Error(
        `${entry.name}: plugin.config.json name must match the catalog and directory`,
      );
    }
    text(manifest.version, `${entry.name}: version`);
    text(manifest.description, `${entry.name}: description`);
    if (validVersion(manifest.version) === null) {
      throw new Error(
        `${entry.name}: version must be a semantic version such as 1.0.0`,
      );
    }
    if (new Set(manifest.keywords).size !== (manifest.keywords ?? []).length) {
      throw new Error(`${entry.name}: duplicate keywords`);
    }
    const extension = manifest.extensions?.['com.openai'] ?? {};
    if (Object.keys(manifest.extensions ?? {}).some((key) => key !== 'com.openai')) {
      throw new Error(`${entry.name}: only the com.openai extension is supported`);
    }
    if (Object.keys(extension).some((key) => !['interface', 'hooks'].includes(key))) {
      throw new Error(
        `${entry.name}: com.openai supports interface and hooks; skills and MCP use standard paths`,
      );
    }
    await schemas.check(
      'generated/codex-plugin.schema.json',
      { name: entry.name, ...extension },
      `${entry.name}: com.openai`,
    );
    await checkAssets(pluginRoot, extension);
    const skills = await skillFiles(pluginRoot, files);
    const hooks = await hooksFor(pluginRoot, extension.hooks, schemas);
    const mcpFile = path.join(pluginRoot, 'mcp.config.json');
    const mcp = (await exists(mcpFile))
      ? await schemas.check<McpManifest>(
          'upstream/mcp.schema.json',
          await readJson(mcpFile),
          mcpFile,
        )
      : undefined;
    if (mcp !== undefined) {
      await checkMcp(pluginRoot, mcp);
    }
    if (skills.length === 0 && mcp === undefined && hooks.length === 0) {
      throw new Error(
        `${entry.name}: plugin must provide a skill, MCP server, or hook`,
      );
    }
    const plugin: Plugin = { entry, root: pluginRoot, manifest, skills, hooks };
    if (mcp !== undefined) {
      plugin.mcp = mcp;
    }
    plugins.push(plugin);
  }
  return { root, catalog, plugins };
}

/**
 * Convert validated portable MCP declarations to Codex runtime settings.
 * Stdio servers default to the plugin root; HTTP headers become `http_headers`.
 *
 * @param manifest - MCP declaration already checked by {@link loadMarketplace}.
 * @returns The `mcpServers` document to write as the plugin's generated `mcp.json`.
 */
export function runtimeMcp(manifest: McpManifest): Record<string, unknown> {
  const servers: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(manifest.mcpServers)) {
    if (server.type === 'stdio') {
      const { type: _transport, ...config } = server;
      servers[name] = { ...config, cwd: config.cwd ?? './' };
    } else {
      servers[name] = {
        url: server.url,
        ...(server.headers === undefined ? {} : { http_headers: server.headers }),
      };
    }
  }
  return { mcpServers: servers };
}

/**
 * Build the Codex marketplace, plugin manifests, and optional MCP runtime documents.
 *
 * @param marketplace - Validated authored files returned by {@link loadMarketplace}.
 * @returns A map from repository-relative output paths to JSON-compatible documents.
 */
export function generatedFiles(marketplace: Marketplace): Map<string, unknown> {
  const files = new Map<string, unknown>();
  files.set('.agents/plugins/marketplace.json', {
    name: marketplace.catalog.name,
    interface: marketplace.catalog.interface,
    plugins: marketplace.plugins.map(({ entry }) => ({
      name: entry.name,
      source: { source: 'local', path: `./${entry.path}` },
      policy: {
        installation: 'AVAILABLE',
        authentication: entry.authentication,
        products: ['codex'],
      },
      category: entry.category,
    })),
  });
  for (const plugin of marketplace.plugins) {
    const { manifest, entry } = plugin;
    files.set(`${entry.path}/.codex-plugin/plugin.json`, {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      keywords: manifest.keywords ?? [],
      ...(plugin.skills.length === 0 ? {} : { skills: './skills' }),
      ...(plugin.mcp === undefined ? {} : { mcpServers: './mcp.json' }),
      ...manifest.extensions?.['com.openai'],
    });
    if (plugin.mcp !== undefined) {
      files.set(`${entry.path}/mcp.json`, runtimeMcp(plugin.mcp));
    }
  }
  return files;
}

/**
 * Validate generated Codex documents, then write them or compare them with disk.
 * Plugins without MCP declarations must not retain an old generated `mcp.json`.
 *
 * @param marketplace - Validated authored files returned by {@link loadMarketplace}.
 * @param check - Check current files when true; write output and remove stale MCP files otherwise.
 * @returns Resolves when generated schemas and the requested disk operation pass.
 * @throws If output is invalid or, in check mode, files are missing, stale, or malformed.
 */
export async function generate(
  marketplace: Marketplace,
  check: boolean,
): Promise<void> {
  const schemas = new Schemas();
  for (const [relative, value] of generatedFiles(marketplace)) {
    const file = path.join(marketplace.root, relative);
    if (relative.endsWith('/marketplace.json')) {
      await schemas.check('generated/codex-marketplace.schema.json', value, relative);
    } else if (relative.endsWith('/plugin.json')) {
      await schemas.check('generated/codex-plugin.schema.json', value, relative);
    } else if (record(value)) {
      await schemas.check(
        'upstream/codex-config.schema.json',
        { mcp_servers: value.mcpServers },
        relative,
      );
    }
    if (check) {
      if (!(await exists(file)) || (await readFile(file, 'utf8')) !== jsonText(value)) {
        throw new Error(
          `${relative}: generated file is missing or stale; run npm run generate`,
        );
      }
      // Validate disk contents as well as the generated expectation.
      await readJson(file);
    } else {
      await writeJson(file, value);
    }
  }
  for (const plugin of marketplace.plugins.filter(
    (candidate) => candidate.mcp === undefined,
  )) {
    const file = path.join(plugin.root, 'mcp.json');
    if (await exists(file)) {
      if (check) {
        throw new Error(`${file}: stale MCP output; run npm run generate`);
      }
      await rm(file);
    }
  }
}
