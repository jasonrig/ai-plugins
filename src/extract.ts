import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  exists,
  jsonText,
  readJson,
  relativePath,
  sha256,
  toolRoot,
  writeJson,
} from './io.js';
import { Schemas } from './schemas.js';
import type { SourceLock } from './types.js';

/** Promise-based process runner used to invoke the standalone Rust extractor. */
const exec = promisify(execFile);
/** Schema filenames that the extractor must produce, excluding provenance. */
export const schemaNames = [
  'codex-marketplace.schema.json',
  'codex-plugin.schema.json',
  'codex-hooks.schema.json',
];

/**
 * Read and validate the pinned Codex release, source revision, and source hashes.
 *
 * @returns The validated source lock from the project's schema directory.
 * @throws If the lock is missing, malformed, or fails its schema.
 */
export async function sourceLock(): Promise<SourceLock> {
  return new Schemas().check<SourceLock>(
    'source-lock.schema.json',
    await readJson(path.join(toolRoot, 'schemas/codex-source.lock.json')),
    'Codex source lock',
  );
}

/**
 * Refuse source or schema content that differs from its pinned checksum.
 *
 * @param content - Exact bytes to verify before parsing or compilation.
 * @param expected - Expected lowercase hexadecimal SHA-256 digest.
 * @param label - Source path used to identify a checksum failure.
 * @throws If the content hash differs from the expected digest.
 */
export function verifySource(
  content: Uint8Array,
  expected: string,
  label: string,
): void {
  if (sha256(content) !== expected) {
    throw new Error(
      `${label}: SHA-256 differs from the source lock; review the source pin`,
    );
  }
}

/**
 * Prepare verified source files in the cache for the pinned Codex revision.
 * Without a local checkout, reuse cached files or download missing files from
 * the pinned upstream commit. Every input is checked before it is copied.
 *
 * @param sourceDirectory - Optional Codex checkout or submodule to read instead.
 * @returns The cache directory containing verified extraction inputs.
 * @throws If source filenames repeat, input cannot be read, or a hash differs.
 */
export async function prepareSource(sourceDirectory?: string): Promise<string> {
  const lock = await sourceLock();
  const cache = path.join(toolRoot, '.cache/codex', lock.revision);
  await mkdir(cache, { recursive: true });
  const filenames = new Set<string>();
  for (const file of lock.files) {
    if (filenames.has(file.filename)) {
      throw new Error(`Duplicate source filename: ${file.filename}`);
    }
    filenames.add(file.filename);
    const target = relativePath(cache, file.filename);
    let content: Uint8Array;
    if (sourceDirectory !== undefined) {
      content = await readFile(relativePath(sourceDirectory, file.path));
    } else if (await exists(target)) {
      content = await readFile(target);
    } else {
      const response = await fetch(
        `https://raw.githubusercontent.com/openai/codex/${lock.revision}/${file.path}`,
        { signal: AbortSignal.timeout(30_000) },
      );
      if (!response.ok) {
        throw new Error(`${file.path}: source download failed (${response.status})`);
      }
      content = new Uint8Array(await response.arrayBuffer());
    }
    verifySource(content, file.sha256, file.path);
    // The build always reads a verified copy, even when the caller uses a submodule.
    await writeFile(target, content);
  }
  return cache;
}

/**
 * Describe the source pin, extractor hashes, and validation profile for generated schemas.
 *
 * @returns JSON-compatible provenance computed from the current project files.
 * @throws If the source lock is invalid or an extractor file cannot be read.
 */
export async function provenance(): Promise<unknown> {
  const lock = await sourceLock();
  const extractorFiles = [
    'extract.rs',
    'build.rs',
    'src/main.rs',
    'Cargo.toml',
    'Cargo.lock',
  ];
  const extractor: Record<string, string> = {};
  for (const file of extractorFiles) {
    extractor[file] = sha256(
      await readFile(path.join(toolRoot, 'tools/codex-schema', file)),
    );
  }
  return {
    source: lock,
    extractor,
    profile: {
      unknownFields: 'reject',
      untypedFallbacks: 'excluded from schema only',
      catalogFallbackMetadata: 'excluded; use plugin.config.json',
    },
  };
}

/**
 * Verify checked-in provenance and the checksums of vendored upstream schemas.
 * This uses local files and does not fetch source or run the Rust extractor.
 *
 * @returns Resolves when all recorded provenance and upstream hashes match.
 * @throws If provenance is stale, an upstream lock entry is invalid, or a hash differs.
 */
export async function checkProvenance(): Promise<void> {
  const file = path.join(toolRoot, 'schemas/generated/provenance.json');
  if ((await readFile(file, 'utf8')) !== jsonText(await provenance())) {
    throw new Error('Schema provenance is stale; run npm run schema:extract');
  }
  const upstream = await readJson(path.join(toolRoot, 'schemas/upstream.lock.json'));
  if (!Array.isArray(upstream)) {
    throw new Error('Invalid upstream schema lock');
  }
  for (const entry of upstream as unknown[]) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('file' in entry) ||
      typeof entry.file !== 'string' ||
      !('sha256' in entry) ||
      typeof entry.sha256 !== 'string'
    ) {
      throw new Error('Invalid upstream schema lock entry');
    }
    verifySource(
      await readFile(relativePath(toolRoot, entry.file)),
      entry.sha256,
      entry.file,
    );
  }
}

/**
 * Run the standalone Rust extractor against verified Codex source files.
 * Temporary output is removed after checking or writing all expected schemas.
 *
 * @param check - Compare output with checked-in files when true; replace them otherwise.
 * @param sourceDirectory - Optional local Codex checkout or submodule to read.
 * @returns Resolves when extraction and the requested check or write have completed.
 * @throws If the build fails or warns, output is unexpected, or checked files differ.
 */
export async function extractSchemas(
  check: boolean,
  sourceDirectory?: string,
): Promise<void> {
  const cache = await prepareSource(sourceDirectory);
  const scratchRoot = path.join(toolRoot, '.cache');
  const output = await mkdtemp(path.join(scratchRoot, 'schemas-'));
  try {
    const { stderr } = await exec(
      'cargo',
      [
        'run',
        '--locked',
        '--manifest-path',
        path.join(toolRoot, 'tools/codex-schema/Cargo.toml'),
        '--',
        output,
      ],
      {
        cwd: toolRoot,
        env: {
          ...process.env,
          CARGO_HOME: path.join(toolRoot, '.cache/cargo'),
          CODEX_SCHEMA_SOURCE_DIR: cache,
        },
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    if (stderr.includes('warning:')) {
      throw new Error(`Schema extractor emitted a warning:\n${stderr}`);
    }
    await writeJson(path.join(output, 'provenance.json'), await provenance());
    const expected = [...schemaNames, 'provenance.json'].toSorted();
    const actual = (await readdir(output)).toSorted();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Unexpected schema output: ${actual.join(', ')}`);
    }
    const destination = path.join(toolRoot, 'schemas/generated');
    await mkdir(destination, { recursive: true });
    if (
      check &&
      JSON.stringify((await readdir(destination)).toSorted()) !==
        JSON.stringify(expected)
    ) {
      throw new Error('Checked-in schema inventory differs from extractor output');
    }
    for (const name of expected) {
      const content = await readFile(path.join(output, name), 'utf8');
      const target = path.join(destination, name);
      if (check) {
        if (content !== (await readFile(target, 'utf8'))) {
          throw new Error(
            `${name}: schema differs from pinned source; run npm run schema:extract`,
          );
        }
      } else {
        await writeFile(target, content);
      }
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}
