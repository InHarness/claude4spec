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
 *
 * Phase 3 (`2.0.0`): MAJOR bump. `onUnregister` is now a REQUIRED manifest slot
 * (the hot-reload pipeline calls it to tear the old version down before
 * re-registering the new one) — making a slot required is a breaking shape
 * change, hence the major. A plugin built against `^1.x` no longer satisfies
 * `2.0.0` and is reported `incompatible` with a migration descriptor (vs the
 * environment-level `skipped` for an `engines` miss). Additive same-major slots
 * (`contributes.settings`, `contributes.commands`) would have been a minor bump
 * on their own.
 */
export const HOST_API_VERSION = '2.0.0';

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
 * Authoring shape for one contributed writing style (M15). A plugin carries the
 * style inline (body + optional attached files) rather than dropping a SKILL.md
 * dir on disk — discovery is by push at load time (the loader fans these into
 * the per-project SkillRegistry as `source: "plugin"`), not by FS scan.
 */
export interface WritingStyleContribution {
  /** Stable identifier; also the dedup key against bundled/user styles. */
  slug: string;
  title: string;
  description: string;
  /** Positive integer; mirrors SKILL.md frontmatter `version`. */
  version: number;
  language: 'en' | 'pl';
  /** The skill body markdown (the SKILL.md content without frontmatter). */
  content: string;
  /** Optional attached files (templates/examples/workflows), keyed by rel path. */
  files?: Record<string, string>;
}

/**
 * M33 phase 3 — one settings field a plugin renders in its own Settings section
 * (panel M26), values stored under `config.plugins[<manifest.name>][key]`.
 * `kind` drives the reload classification on write:
 *   - `hot-reload` → only `invalidateQueries(['config'])`, no context rebuild
 *     (parity with `writingStyle` / `language`; takes effect next turn/thread).
 *   - `executive` → invalidates the `ProjectContext` (rebuild, no banner, no
 *     restart).
 */
export interface PluginSettingField {
  /** Stable field key inside the plugin's config namespace. */
  key: string;
  /** Human label shown in the Settings panel. */
  label: string;
  control: 'toggle' | 'text' | 'select' | 'multiselect';
  kind: 'hot-reload' | 'executive';
  /** Default applied when `config.plugins[<name>][key]` is absent. */
  default: unknown;
  /** Choices for `select` / `multiselect` controls. */
  options?: { value: string; label: string }[];
  /** Optional help/description text. */
  help?: string;
}

/** A plugin's settings module = an ordered list of fields. */
export type PluginSettingsModule = PluginSettingField[];

/**
 * M33 phase 3 — declarative editor slash-command contributed by a plugin
 * (typically an entity-less one). The loader normalizes each entry into an
 * `EditorExtensionRegistration.slashCommand` and routes it through
 * `registerEditorExtension(...)` — the SAME path as entity-borne extensions.
 * Declarative, not imperative: the plugin declares the trigger + popover to
 * open; execution is the editor framework's popover dispatch, not plugin code.
 * Kept as a dep-free subset here (the full `EditorExtensionRegistration` lives
 * client-side); `popoverKind` is narrowed against the client `PopoverMap`.
 */
export interface PluginCommandContribution {
  /** Stable registration name (unique within the editor extension registry). */
  name: string;
  /** Slash trigger token, e.g. "mychart". */
  trigger: string;
  /** Menu label shown in the slash palette. */
  label: string;
  /** Popover kind dispatched on invoke (client `PopoverKind`). */
  popoverKind: string;
  /** Editor contexts the command is available in. Omitted = all contexts. */
  availableIn?: string[];
}

/**
 * The default export of a plugin package. `contributes` is the capability
 * bundle: `contributes.entities` (phase 1), `contributes.writingStyles`
 * (phase 2 — pushed into the SkillRegistry as `source: "plugin"`), and
 * `contributes.settings` / `contributes.commands` (phase 3).
 */
export interface PluginManifest {
  /** npm package name. */
  name: string;
  /** plugin semver. */
  version: string;
  /** semver range — which Host API the plugin targets, e.g. "^2.0.0". */
  hostApiVersion: string;
  /** node/host engine constraints. */
  engines?: PluginEngines;
  /**
   * M33 phase 3 — REQUIRED teardown hook, symmetric to backend mount. The
   * hot-reload pipeline calls it on the OLD version before registering the new
   * one; without it a reload would leave duplicated slots (MCP server, Express
   * routes, editor extensions, zustand slice). Must be idempotent and
   * non-throwing — a thrown error is logged as a warning and never blocks the
   * reload.
   */
  onUnregister(): void;
  contributes: {
    entities?: EntityContribution[];
    /** M15 phase 2 — writing styles contributed by this plugin. */
    writingStyles?: WritingStyleContribution[];
    /** M33 phase 3 — settings fields rendered per-plugin in Settings (M26). */
    settings?: PluginSettingsModule;
    /** M33 phase 3 — declarative editor slash-commands (entity-less plugins). */
    commands?: PluginCommandContribution[];
  };
}

/** One plugin's Settings section, as returned by `ProjectPluginHost.listSettings()`. */
export interface PluginSettingsSection {
  /** Plugin package name — also the `config.plugins` namespace key. */
  name: string;
  version: string;
  fields: PluginSettingsModule;
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
