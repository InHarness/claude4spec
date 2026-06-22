/**
 * M33 — runtime plugin manifest contract (phase 1).
 *
 * A plugin is an npm package that default-exports (or named-exports as
 * `manifest`) a {@link PluginManifest}. The host loader (`loadWorkspacePlugins`)
 * dynamic-imports each workspace-declared package, validates `hostApiVersion`
 * / `engines`, then fans `contributes.entities` out to `registerEntityModule`.
 *
 * This lives in `shared/` (not `server/`) because the external `c4s-reader`
 * and plugin authors need the contract without pulling in express /
 * better-sqlite3. Server-only payloads (the express Router, the L9 serializer)
 * are typed `unknown` here and narrowed server-side.
 */

import type { EntityModuleManifest, SystemPromptContribution } from './types.js';

/**
 * The Host API version this build advertises. Bumped on a breaking change to
 * any surface counted into the contract: the manifest / EntityModule
 * signatures, the `mountBackend(app, mcpHost, db, cwd)` mount-context shape,
 * the chip/card/row prop shapes, and the L8 editor registration contract.
 *
 * A plugin whose `hostApiVersion` range does not satisfy this version is
 * skipped with a warning (never crashed over) — on the backend during load and
 * independently on the frontend during manifest consumption.
 */
export const HOST_API_VERSION = '1.4.0';

/** Node/host engine constraints — checked by the loader before registration. */
export interface PluginEngines {
  /** semver range matched against `process.versions.node`. */
  node?: string;
  [key: string]: string | undefined;
}

/**
 * Authoring shape for one contributed entity type. A superset of the shared
 * {@link EntityModuleManifest} carrying the slots the host needs to lower it
 * into a server `BackendModule`. The express Router (`backend.routes`) and the
 * L9 serializer are typed `unknown` here so the shared bundle stays dep-free;
 * the registry narrows them at registration time.
 */
export interface EntityContribution extends EntityModuleManifest {
  /** L9 — JSON serializer (server `EntitySerializer<unknown>`; narrowed server-side). */
  serializer: unknown;

  /** M05 — system prompt contribution composed by buildSystemPrompt. */
  systemPrompt: SystemPromptContribution;

  backend?: {
    /** Per-plugin idempotent SQL migrations (server `SqlMigration[]`). */
    migrations?: unknown[];
    /**
     * Full-power imperative mount hook (server `PluginMountFn`). Receives the
     * MountContext; owns service construction, route mounting, MCP + service
     * registration. Takes precedence over `routes`.
     */
    mount?: unknown;
    /**
     * Sugar: a pre-built express Router mounted at `pathPrefix`. When supplied
     * without `mount`, the registry synthesizes
     * `mount = (ctx) => ctx.app.use(pathPrefix, routes)` — no MCP server, no
     * entity service, no migrations.
     */
    routes?: unknown;
  };

  /** L8 — client editor extensions + render slots (narrowed client-side). */
  frontend?: unknown;
}

/**
 * The default export of a plugin package. `contributes` is the capability
 * bundle; phase 1 consumes `contributes.entities`. `writingStyles` is declared
 * but unused until phase 2 — the loader ignores it for now.
 */
export interface PluginManifest {
  /** npm package name. */
  name: string;
  /** plugin semver. */
  version: string;
  /** semver range — which Host API the plugin targets, e.g. "^1.4.0". */
  hostApiVersion: string;
  /** node/host engine constraints. */
  engines?: PluginEngines;
  contributes: {
    entities?: EntityContribution[];
    /** Reserved for phase 2 (writing-style plugins). Ignored in phase 1. */
    writingStyles?: unknown[];
  };
}

/**
 * Parse the major component of a clean semver string (e.g. "1.4.0" -> 1).
 * Used for the cheap major-mismatch gate on the frontend, mirroring the
 * backend's `semver.satisfies` check. Returns `null` for unparseable input.
 */
export function parseMajor(version: string): number | null {
  const match = /^\s*v?(\d+)\./.exec(version);
  if (!match) return null;
  const major = Number(match[1]);
  return Number.isFinite(major) ? major : null;
}
