import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Ajv } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { Schema } from 'ajv';
import { toolRoot } from './io.js';

/** Loads checked-in schemas and validates data using the matching JSON Schema draft. */
export class Schemas {
  private readonly loaded = new Map<string, Schema>();

  /**
   * Validate data against a schema stored under the project's `schemas` directory.
   * Schema documents are cached per instance; validation does not change the data.
   *
   * @typeParam T - Type represented by the selected schema; the caller chooses it.
   * @param name - Schema path relative to the `schemas` directory.
   * @param value - Data to validate.
   * @param label - File or component name included in validation errors.
   * @returns The original value typed as T after successful validation.
   * @throws If the schema cannot be loaded or compiled, or the data is invalid.
   */
  async check<T>(name: string, value: unknown, label: string): Promise<T> {
    let schema = this.loaded.get(name);
    if (schema === undefined) {
      const parsed: unknown = JSON.parse(
        await readFile(path.join(toolRoot, 'schemas', name), 'utf8'),
      );
      if (!isSchema(parsed)) {
        throw new Error(`Invalid schema document: ${name}`);
      }
      schema = parsed;
      this.loaded.set(name, schema);
    }
    const options = {
      allErrors: true,
      strict: true,
      // Codex uses `not: { required: [...] }` without repeating sibling properties.
      strictRequired: name !== 'upstream/codex-config.schema.json',
      validateFormats: false,
    };
    const ajv =
      name === 'upstream/codex-config.schema.json'
        ? new Ajv(options)
        : new Ajv2020(options);
    const validate = ajv.compile<T>(schema);
    if (!validate(value)) {
      throw new Error(
        `${label}: schema validation failed: ${JSON.stringify(validate.errors)}`,
      );
    }
    return value;
  }
}

/**
 * Check that parsed schema data has a supported synchronous document shape.
 *
 * @param value - Untrusted data parsed from a schema file.
 * @returns Whether Ajv can receive the value as a synchronous schema document.
 */
function isSchema(value: unknown): value is Schema {
  return (
    typeof value === 'boolean' ||
    (typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      (!('$async' in value) || value.$async === false))
  );
}
