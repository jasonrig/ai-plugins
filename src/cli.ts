import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkProvenance, extractSchemas } from './extract.js';
import { exists, writeJson } from './io.js';
import { generate, loadMarketplace, pluginSchema } from './marketplace.js';

/**
 * Create a starter skill plugin, register it in the catalog, and generate Codex files.
 *
 * @param root - Marketplace directory whose existing catalog must be valid.
 * @param name - New plugin name, also used for its directory and starter skill.
 * @returns Resolves after the package, catalog, and generated files have been written.
 * @throws If the name is invalid, the plugin already exists, or validation or writing fails.
 */
async function createPlugin(root: string, name: string): Promise<void> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || name.length > 64) {
    throw new Error(
      'Use a plugin name of up to 64 lowercase letters, numbers, and single hyphens',
    );
  }
  const marketplace = await loadMarketplace(root);
  const relative = `plugins/${name}`;
  const directory = path.join(root, relative);
  if (
    (await exists(directory)) ||
    marketplace.catalog.plugins.some((entry) => entry.name === name)
  ) {
    throw new Error(`Plugin already exists: ${name}`);
  }
  const skill = path.join(directory, 'skills', name);
  await mkdir(skill, { recursive: true });
  await writeJson(path.join(directory, 'plugin.json'), {
    $schema: pluginSchema,
    name,
    version: '0.1.0',
    description: `Personal ${name} plugin.`,
  });
  await writeFile(
    path.join(skill, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Use when the user explicitly asks for the ${name} skill.\n---\n\nExplain that this skill is a starter. Ask the user what they want it to do.\n`,
  );
  marketplace.catalog.plugins.push({
    name,
    path: relative,
    category: 'Productivity',
    authentication: 'ON_USE',
  });
  await writeJson(path.join(root, 'marketplace.config.json'), marketplace.catalog);
  await generate(await loadMarketplace(root), false);
  console.log(`Created ${relative}. Edit plugin.json and skills/${name}/SKILL.md.`);
}

/**
 * Dispatch the marketplace command from process arguments in the current directory.
 *
 * @returns Resolves after the selected command completes and prints its result.
 * @throws If arguments are invalid or the selected operation fails.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = process.cwd();
  const command = args.shift();
  if (command === 'schema') {
    const mode = args.shift();
    let sourceDirectory: string | undefined;
    if (args.length !== 0) {
      if (
        args.shift() !== '--source-dir' ||
        args.length !== 1 ||
        args[0] === undefined
      ) {
        throw new Error('Usage: schema extract|check [--source-dir /path/to/codex]');
      }
      sourceDirectory = path.resolve(args.shift() ?? '');
    }
    if (mode !== 'extract' && mode !== 'check') {
      throw new Error('Usage: schema extract|check [--source-dir /path/to/codex]');
    }
    await extractSchemas(mode === 'check', sourceDirectory);
    console.log(
      mode === 'check'
        ? 'Schemas match the pinned Codex source.'
        : 'Updated Codex schemas and provenance.',
    );
  } else if (command === 'new' && args.length === 1 && args[0] !== undefined) {
    await checkProvenance();
    await createPlugin(root, args[0]);
  } else if (command === 'validate' && args.length === 0) {
    await checkProvenance();
    const marketplace = await loadMarketplace(root);
    await generate(marketplace, true);
    console.log(
      `Validated ${marketplace.plugins.length} plugins, schemas, inventory, and generated files.`,
    );
  } else if (
    command === 'generate' &&
    (args.length === 0 || (args.length === 1 && args[0] === '--check'))
  ) {
    await checkProvenance();
    await generate(await loadMarketplace(root), args.length === 1);
    console.log(
      args.length === 1
        ? 'Generated files are current.'
        : 'Updated Codex marketplace and plugin files.',
    );
  } else {
    throw new Error(
      'Usage: validate | generate [--check] | new NAME | schema extract|check [--source-dir PATH]',
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
