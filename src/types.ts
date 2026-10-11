/** One published plugin, with its package path, category, and authentication policy. */
export interface CatalogEntry {
  name: string;
  /** Repository-relative package directory; must be plugins/<name>. */
  path: string;
  category: string;
  authentication: 'ON_USE' | 'ON_INSTALL';
}

/** Authored catalog that supplies the identity and plugin inventory for Codex output. */
export interface Catalog {
  name: string;
  interface: { displayName: string };
  plugins: CatalogEntry[];
}

/**
 * Portable plugin metadata validated against the vendored Agent Plugins schema.
 * The repository also requires a semantic version and a nonempty description.
 */
export interface PluginManifest {
  $schema: string;
  name: string;
  version?: string;
  description?: string;
  author?: { name?: string; email?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  /** Host metadata; this repository accepts com.openai interface fields and hooks. */
  extensions?: Record<string, Record<string, unknown>>;
}

/**
 * A portable MCP transport declaration before conversion to Codex runtime settings.
 * The public schema includes SSE; marketplace validation rejects that transport.
 */
export type McpServer =
  | {
      type: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | { type: 'streamable-http' | 'sse'; url: string; headers?: Record<string, string> };

/** Authored mcp.config.json, with server names mapped to portable transport settings. */
export interface McpManifest {
  $schema: string;
  mcpServers: Record<string, McpServer>;
}

/** A validated skill whose front-matter name matches its containing directory. */
export interface Skill {
  name: string;
  /** Absolute path to the skill's SKILL.md file. */
  file: string;
}

/** Validated package metadata and discovered components used to generate and test output. */
export interface Plugin {
  entry: CatalogEntry;
  /** Absolute path to this plugin's package directory. */
  root: string;
  manifest: PluginManifest;
  skills: Skill[];
  mcp?: McpManifest;
  /** Hook documents resolved from inline declarations or referenced files. */
  hooks: Record<string, unknown>[];
}

/** Validated authored catalog and packages, ready for generation or Codex integration. */
export interface Marketplace {
  /** Absolute path to the marketplace repository. */
  root: string;
  catalog: Catalog;
  plugins: Plugin[];
}

/** Pins the Codex release, source commit, and verified files used for schema extraction. */
export interface SourceLock {
  repository: string;
  version: string;
  /** Full Git commit SHA; extraction never follows a mutable branch or tag. */
  revision: string;
  /** Upstream paths, cache filenames, and SHA-256 hashes of the exact source bytes. */
  files: { path: string; filename: string; sha256: string }[];
}
