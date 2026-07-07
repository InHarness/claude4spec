/**
 * M33 — runtime plugin manifest contract.
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
 * the chip/card/row prop shapes, the L8 editor registration contract, and the
 * prop contracts of the `stable` Host UI Kit components (M34/L12;
 * `@c4s/plugin-runtime/ui`). See `UI_KIT_STABLE_COMPONENTS` in
 * `ui-kit-surface.ts`; `experimental` kit components are deliberately NOT part
 * of this surface.
 *
 * A plugin whose `hostApiVersion` range does not satisfy this version is
 * skipped with a warning (never crashed over) — on the backend during load and
 * independently on the frontend during manifest consumption.
 *
 * Versioning rule — only a breaking slot-shape change bumps the version, and it
 * bumps the MAJOR (with a descriptor in the changelog — see `host-api.ts`); the
 * loader gate compares majors only. A plugin built against a different major is
 * reported `incompatible` with a migration descriptor (vs the environment-level
 * `skipped` for an `engines` miss).
 *
 * `1.0.0` baseline — the Host UI Kit catalog + `stable` prop contracts
 * (`@c4s/plugin-runtime/ui`, M34/L12) shipped WITHIN this major, so they are
 * folded into the `1.0.0` versioned surface rather than bumping it; no major has
 * been crossed, so the changelog stays empty.
 *
 * M13 (0.1.113) — the declarative backend surface (`service`/`crud`/`routes`/
 * `mcpServer` slots, `EntityCrudService`/`BaseEntityCrudService`,
 * `SystemPromptContribution.mcpToolsLine` becoming optional) is an additive
 * extension of the `1.0.0` contract: new optional slots, no shape change to
 * anything a plugin already depended on (the `mount` escape hatch is
 * unchanged). Per the qualification rule above, additive-within-baseline
 * during stabilization (no published third-party plugins yet) does not bump
 * the version — it is simply folded into what `1.0.0` now covers, same as the
 * Host UI Kit precedent.
 */
export const HOST_API_VERSION = '1.0.0';

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
     * ESCAPE HATCH — full-power imperative mount hook (server `PluginMountFn`).
     * A typical plugin does not write this; declare `service`/`crud`/`routes`/
     * `mcpServer` instead and the host synthesizes an equivalent mount. When
     * present, `mount` takes precedence over the declarative slots below (they
     * are ignored).
     */
    mount?: unknown;
    /**
     * M13 — L2 service factory (server `(ctx: MountContext) => EntityCrudService`).
     * Instantiated by the host EXACTLY ONCE per `ProjectContext`; the same
     * instance is then visible in DI (`ctx.registerEntityService`), in the
     * generic `entity-tools` CRUD registry, and as the argument passed to the
     * `routes`/`mcpServer` factories below (referential identity).
     */
    service?: unknown;
    /**
     * M13 — declarative contribution to the generic `entity-tools` MCP server.
     * Requires `service` (validated at registration — `crud` without `service`
     * is a rejected plugin, not silently-missing CRUD). `updateSchema` defaults
     * to `createSchema.partial()`.
     */
    crud?: {
      /** server `ZodRawShape`. */
      createSchema: unknown;
      /** server `ZodRawShape`; default `createSchema.partial()`. */
      updateSchema?: unknown;
      descriptions?: { entity?: string };
    };
    /**
     * A factory receiving the SAME service instance as `crud`/`mcpServer`
     * (server `(service, ctx) => Router`), mounted at `pathPrefix`. ALWAYS a
     * factory — never a bare Router (express's `Router` type is itself
     * callable, so a `Router | (fn)` union can't be discriminated at
     * runtime). A plugin with no service dependency just ignores the args.
     */
    routes?: {
      router: unknown;
    };
    /**
     * M13 — factory for a CUSTOM MCP server carrying ONLY this type's
     * non-standard tools (e.g. `link_dto`/`unlink_dto`); CRUD tools belong
     * exclusively to `entity-tools`, never to a per-type server. Registered as
     * `${type}-tools`. Omit when the type has no custom tools — no server is
     * mounted in that case. (server `(service, ctx) => McpServerFactory`.)
     */
    mcpServer?: unknown;
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
 * M33 — one settings field a plugin renders in its own Settings section
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
 * M33 — declarative editor slash-command contributed by a plugin
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
 * bundle: `contributes.entities`, `contributes.writingStyles` (pushed into the
 * SkillRegistry as `source: "plugin"`), and
 * `contributes.settings` / `contributes.commands`.
 */
export interface PluginManifest {
  /** npm package name. */
  name: string;
  /** plugin semver. */
  version: string;
  /** semver range — which Host API the plugin targets, e.g. "^1.0.0". */
  hostApiVersion: string;
  /** node/host engine constraints. */
  engines?: PluginEngines;
  /**
   * REQUIRED teardown hook, symmetric to backend mount — a required slot from
   * the `1.0.0` baseline. The hot-reload pipeline calls it on the OLD version
   * before registering the new one; without it a reload would leave duplicated
   * slots (MCP server, Express routes, editor extensions, zustand slice). Must
   * be idempotent and non-throwing — a thrown error is logged as a warning and
   * never blocks the reload.
   */
  onUnregister(): void;
  contributes: {
    entities?: EntityContribution[];
    /** M15 — writing styles contributed by this plugin. */
    writingStyles?: WritingStyleContribution[];
    /** M33 — settings fields rendered per-plugin in Settings (M26). */
    settings?: PluginSettingsModule;
    /** M33 — declarative editor slash-commands (entity-less plugins). */
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
