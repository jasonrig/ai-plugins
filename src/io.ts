import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

/** Absolute project directory used to locate schemas and the extractor. */
export const toolRoot = fileURLToPath(new URL('../', import.meta.url));

/**
 * Serialize a value using the repository's generated JSON format.
 *
 * @param value - JSON-compatible data to serialize.
 * @returns Two-space-indented JSON followed by a newline.
 */
export function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Hash source or schema content for comparison with its pinned checksum.
 *
 * @param value - Raw bytes or a string encoded as UTF-8.
 * @returns The lowercase hexadecimal SHA-256 digest.
 */
export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Read JSON without allowing duplicate keys to hide an authored entry.
 *
 * @param file - Path to the UTF-8 JSON file.
 * @returns Parsed data that the caller must validate before use.
 * @throws If the file cannot be read, its JSON is invalid, or keys are duplicated.
 */
export async function readJson(file: string): Promise<unknown> {
  const text = await readFile(file, 'utf8');
  const value: unknown = JSON.parse(text);
  // JSON.parse accepts duplicate keys. Reject them before they hide an authored entry.
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(
      `${file}: ${document.errors.map((error) => error.message).join('; ')}`,
    );
  }
  return value;
}

/**
 * Check whether a filesystem entry exists, including a symbolic link.
 *
 * @param file - Path to inspect without following symbolic links.
 * @returns False only when the entry is absent.
 * @throws If inspection fails for a reason other than a missing entry.
 */
export async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Join a root with a relative path after rejecting traversal and ambiguous syntax.
 * This checks the path text; use {@link containedPath} to check its real location.
 *
 * @param root - Base directory to join with the accepted path.
 * @param value - Slash-separated relative path, optionally starting with `./`.
 * @returns The joined path without checking whether it exists.
 * @throws If the path is empty, absolute, or contains backslashes or dot segments.
 */
export function relativePath(root: string, value: string): string {
  const normalized = value.replace(/^\.\//u, '');
  if (
    normalized.length === 0 ||
    path.isAbsolute(normalized) ||
    normalized.includes('\\') ||
    normalized.split('/').some((part) => part === '..' || part === '.' || part === '')
  ) {
    throw new Error(`Invalid relative path: ${value}`);
  }
  return path.join(root, normalized);
}

/**
 * Resolve an existing relative path and check that it stays inside its root.
 *
 * @param root - Existing directory that must contain the target.
 * @param value - Relative path accepted by {@link relativePath}.
 * @returns The joined path after checking its resolved filesystem location.
 * @throws If either path is missing or the target resolves outside the root.
 */
export async function containedPath(root: string, value: string): Promise<string> {
  const file = relativePath(root, value);
  const [base, resolved] = await Promise.all([realpath(root), realpath(file)]);
  const relative = path.relative(base, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes plugin root: ${value}`);
  }
  return file;
}

/**
 * Walk a plugin directory and reject symbolic links and special filesystem entries.
 *
 * @param root - Directory to inspect recursively.
 * @returns Sorted file paths, joined to the supplied root.
 * @throws If an entry cannot be read or is neither a regular file nor a directory.
 */
export async function filesBelow(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Symlinks are not supported in plugins: ${file}`);
    }
    if (entry.isDirectory()) {
      files.push(...(await filesBelow(file)));
    } else if (entry.isFile()) {
      files.push(file);
    } else {
      throw new Error(`Unsupported file type: ${file}`);
    }
  }
  return files.toSorted();
}

/**
 * Write deterministic JSON, creating missing parent directories.
 *
 * @param file - Destination path; an existing file is overwritten.
 * @param value - JSON-compatible data formatted by {@link jsonText}.
 * @returns Resolves after the file has been written.
 */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, jsonText(value));
}
