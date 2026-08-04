/**
 * M33: lower a runtime plugin's authoring shape (`EntityContribution`) into the
 * internal `BackendModule` the host already understands. This keeps
 * `mountBackend` / `MountContext` / `ProjectPluginHost` 100% unchanged — the
 * manifest is purely an authoring envelope, reconciled here.
 *
 * M13: backend mounting is now declarative by default. `lowerEntityContribution`
 * narrows the authoring `backend.{service,crud,routes,mcpServer}` slots (typed
 * `unknown` in the shared/dep-free `EntityContribution`) into their typed
 * `BackendModule` counterparts; `synthesizeMount` (below) is the single choke
 * point — called uniformly by `PluginRegistryImpl.registerEntityModule` for
 * BOTH externally-loaded plugins (via this file) AND in-repo entities (whose
 * `plugin.ts` builds a `BackendModule` directly, bypassing `EntityContribution`)
 * — that turns those slots into an equivalent imperative `mount`. An explicit
 * `backend.mount` (full-power escape hatch) always takes precedence and is
 * passed through untouched.
 */

import type { Router } from 'express';
import type {
  EntityContribution,
  WritingStyleContribution,
} from '../../../shared/plugin-host/manifest.js';
import type { SerializationContribution } from '../../serialization/types.js';
import type { EntityCrudService } from './entity-crud-service.js';
import type { McpServerFactory } from '../../../shared/plugin-host/mcp.js';
import type {
  BackendModule,
  EntityRenamedEvent,
  MountContext,
  PluginMountFn,
} from './types.js';

/** Thrown when a contribution is structurally invalid. Caught per-package by the loader. */
export class PluginManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginManifestError';
  }
}

/**
 * Validate one writing-style contribution (M15). Mirrors the SKILL.md
 * frontmatter checks in skill-registry so a plugin style is held to the same
 * shape as a file-authored one. Throws `PluginManifestError` (caught per-package
 * by the loader) on any structural problem.
 */
export function validateWritingStyle(c: WritingStyleContribution): WritingStyleContribution {
  if (!c || typeof c !== 'object') {
    throw new PluginManifestError('writingStyle contribution must be an object');
  }
  if (typeof c.slug !== 'string' || c.slug.length === 0) {
    throw new PluginManifestError('writingStyle — slug must be a non-empty string');
  }
  if (typeof c.title !== 'string' || c.title.length === 0) {
    throw new PluginManifestError(`writingStyle "${c.slug}" — title must be a non-empty string`);
  }
  if (typeof c.description !== 'string' || c.description.length === 0) {
    throw new PluginManifestError(`writingStyle "${c.slug}" — description must be a non-empty string`);
  }
  if (typeof c.version !== 'number' || !Number.isInteger(c.version) || c.version < 1) {
    throw new PluginManifestError(`writingStyle "${c.slug}" — version must be a positive integer`);
  }
  if (c.language !== 'en' && c.language !== 'pl') {
    throw new PluginManifestError(`writingStyle "${c.slug}" — language must be 'en' or 'pl'`);
  }
  if (typeof c.content !== 'string') {
    throw new PluginManifestError(`writingStyle "${c.slug}" — content must be a string`);
  }
  return c;
}

const MANIFEST_FIELDS = [
  'type',
  'data',
  'slugPattern',
  'payloadVersion',
  'label',
  'labelPlural',
  'displayOrder',
  'pathPrefix',
] as const;

/**
 * Slots removed in Host API 2.0.0, each with the successor to name in the error.
 *
 * A manifest still carrying one of these is REJECTED rather than tolerated. It
 * was authored against 1.x, so its DDL, its slug function and its snapshot are
 * all describing a contract the host no longer honours — loading it would
 * produce a type whose table is never created and whose slugs are never
 * generated. The semver gate catches the well-behaved case (a declared
 * `hostApiVersion` range); this catches the manifest that lies about its range,
 * and gives the author the same migration line `plugins doctor` prints.
 */
const REMOVED_SLOTS: ReadonlyArray<[string, string]> = [
  ['slugFrom', 'slugPattern'],
  ['table', 'data.schema (the projection is generated)'],
  ['composition', 'data.schema (the descriptor is derived)'],
];
const REMOVED_BACKEND_SLOTS: ReadonlyArray<[string, string]> = [
  ['migrations', 'data.schema (the projection is generated)'],
  ['auxTables', "data.schema (declare the collection that owns the table)"],
];

/**
 * Slots a 1.x serializer carried that Host API 2.0.0 derives instead.
 *
 * Rejected, not ignored: a package still shipping `snapshot` believes it owns
 * its file format, and loading it would leave the host generating a DIFFERENT
 * snapshot than the one the plugin was written to read back. Silence there costs
 * data; an error costs one line of migration.
 */
const REMOVED_SERIALIZER_SLOTS: ReadonlyArray<[string, string]> = [
  ['type', 'the manifest already declares it'],
  ['version', 'payloadVersion (an integer, enforced by the upgrade chain)'],
  ['inlineMention', 'views.inline_mention'],
  ['singleElement', 'views.single_element'],
  ['elementListItem', 'views.element_list_item'],
  ['taggedListItem', 'views.tagged_list_item'],
  ['schema', 'nothing — schemas are derived from data.schema'],
];

function assertSerializationContribution(
  type: string,
  serializer: Record<string, unknown>,
  payloadVersion: number,
): void {
  for (const [slot, successor] of REMOVED_SERIALIZER_SLOTS) {
    if (serializer[slot] != null) {
      throw new PluginManifestError(
        `entity "${type}" — \`serializer.${slot}\` was removed in Host API 2.0.0; use \`${successor}\``,
      );
    }
  }
  /**
   * The manifest slot is the authority; the contribution's copy exists because
   * the brief declares it there. Two numbers that may disagree are a bug waiting
   * for the one reader that picks the other one, so disagreement is fatal here
   * rather than resolved silently at each call site.
   */
  if (serializer.payloadVersion != null && serializer.payloadVersion !== payloadVersion) {
    throw new PluginManifestError(
      `entity "${type}" — serializer.payloadVersion (${String(serializer.payloadVersion)}) ` +
        `disagrees with the manifest's payloadVersion (${payloadVersion})`,
    );
  }
  const upgrades = serializer.payloadUpgrades;
  if (upgrades != null) {
    if (!Array.isArray(upgrades) || upgrades.some((u) => typeof u !== 'function')) {
      throw new PluginManifestError(`entity "${type}" — payloadUpgrades must be an array of functions`);
    }
    /**
     * One step per version transition, no more and no less. A short chain is the
     * "conflicting gap" the loader would otherwise discover one entity at a time,
     * at boot, on somebody's real project.
     */
    if (upgrades.length !== payloadVersion - 1) {
      throw new PluginManifestError(
        `entity "${type}" — payloadUpgrades must have exactly ${payloadVersion - 1} step(s) for ` +
          `payloadVersion ${payloadVersion}, got ${upgrades.length}`,
      );
    }
  }
}

function assertContribution(c: EntityContribution): void {
  if (!c || typeof c !== 'object') {
    throw new PluginManifestError('entity contribution must be an object');
  }
  const record = c as unknown as Record<string, unknown>;
  for (const f of MANIFEST_FIELDS) {
    if (record[f] == null) {
      throw new PluginManifestError(`entity "${c.type ?? '?'}" missing required field "${f}"`);
    }
  }
  for (const [slot, successor] of REMOVED_SLOTS) {
    if (record[slot] != null) {
      throw new PluginManifestError(
        `entity "${c.type}" — \`${slot}\` was removed in Host API 2.0.0; declare \`${successor}\` instead`,
      );
    }
  }
  const backendRecord = record.backend as Record<string, unknown> | undefined;
  for (const [slot, successor] of REMOVED_BACKEND_SLOTS) {
    if (backendRecord?.[slot] != null) {
      throw new PluginManifestError(
        `entity "${c.type}" — \`backend.${slot}\` was removed in Host API 2.0.0; declare ` +
          `\`${successor}\` instead`,
      );
    }
  }
  if (c.serializer == null) {
    throw new PluginManifestError(`entity "${c.type}" — serializer is required`);
  }
  assertSerializationContribution(c.type, c.serializer as Record<string, unknown>, c.payloadVersion);
  if (c.systemPrompt == null) {
    throw new PluginManifestError(`entity "${c.type}" — systemPrompt is required`);
  }
  const backend = c.backend;
  if (backend != null && typeof backend !== 'object') {
    throw new PluginManifestError(`entity "${c.type}" — backend must be an object`);
  }
}

/**
 * Convert one `EntityContribution` (shared authoring shape with `unknown`
 * server payloads) into a fully-typed `BackendModule`. Narrows the declarative
 * slots into their typed counterparts but does NOT synthesize `mount` —
 * `PluginRegistryImpl.registerEntityModule` applies `synthesizeMount`
 * uniformly to every module regardless of origin (see module docstring).
 */
export function lowerEntityContribution(c: EntityContribution): BackendModule {
  assertContribution(c);

  const backend = c.backend;
  let backendSlot: BackendModule['backend'];

  if (backend) {
    const mount = backend.mount as PluginMountFn | undefined;
    if (mount && typeof mount !== 'function') {
      throw new PluginManifestError(`entity "${c.type}" — backend.mount must be a function`);
    }

    backendSlot = {
      mount,
      service: backend.service as ((ctx: MountContext) => EntityCrudService) | undefined,
      crud: backend.crud as NonNullable<BackendModule['backend']>['crud'],
      routes: backend.routes as
        | { router: (service: EntityCrudService, ctx: MountContext) => Router }
        | undefined,
      mcpServer: backend.mcpServer as
        | ((service: EntityCrudService, ctx: MountContext) => McpServerFactory)
        | undefined,
      auxTables: backend.auxTables as string[] | undefined,
      onEntityRenamed: backend.onEntityRenamed as
        | ((ev: EntityRenamedEvent, ctx: MountContext) => void)
        | undefined,
    };
  }

  return {
    type: c.type,
    label: c.label,
    labelPlural: c.labelPlural,
    displayOrder: c.displayOrder,
    data: c.data,
    slugPattern: c.slugPattern,
    payloadVersion: c.payloadVersion,
    pathPrefix: c.pathPrefix,
    dependsOn: c.dependsOn,
    serializer: c.serializer as SerializationContribution<unknown>,
    systemPrompt: c.systemPrompt,
    backend: backendSlot,
  };
}

/**
 * M13 — the single lowering choke point: turn a module's declarative backend
 * slots (`service`/`crud`/`routes`/`mcpServer`) into an equivalent imperative
 * `mount`, iff no explicit `mount` was already supplied (the escape hatch
 * always wins, unchanged). Called by `PluginRegistryImpl.registerEntityModule`
 * for every module — both in-repo entities (hand-built `BackendModule`, no
 * `EntityContribution` involved) and externally-loaded plugins (already run
 * through `lowerEntityContribution` first).
 *
 * Idempotent / side-effect-free at registration time: it only builds a new
 * `mount` closure, never calls it. Throws `PluginManifestError` if `crud` or
 * `mcpServer` is declared without `service` (both factories receive the
 * service instance as their first argument) or if `routes.router` is present
 * but not a function (the pre-M13 bare-Router sugar) — all three would
 * otherwise fail confusingly at first mount, deep inside a project's request
 * path.
 */
export function synthesizeMount(module: BackendModule): BackendModule {
  const backend = module.backend;
  if (!backend || backend.mount) return module;

  const { service, crud, routes, mcpServer, onEntityRenamed } = backend;
  if (!service && !crud && !routes && !mcpServer && !onEntityRenamed) return module;

  if (crud && !service) {
    throw new PluginManifestError(`entity "${module.type}" — backend.crud requires backend.service`);
  }
  if (mcpServer && !service) {
    throw new PluginManifestError(`entity "${module.type}" — backend.mcpServer requires backend.service`);
  }
  if (routes && typeof routes.router !== 'function') {
    // M13 breaking change: backend.routes.router is now ALWAYS a factory
    // `(service, ctx) => Router` — a manifest still written against the old
    // pre-M13 "bare Router" sugar (`backend.routes = someRouterInstance`)
    // would otherwise only fail later, deep inside mountBackend, as a raw
    // "routes.router is not a function" TypeError that fails the whole
    // project load. Fail fast here with a readable, attributable error.
    throw new PluginManifestError(
      `entity "${module.type}" — backend.routes.router must be a function (service, ctx) => Router; ` +
        `a bare express Router is no longer accepted (breaking change from the pre-M13 "routes" sugar)`,
    );
  }

  const mount: PluginMountFn = (ctx: MountContext): void => {
    let instance: EntityCrudService | undefined;
    if (service) {
      instance = service(ctx);
      ctx.registerEntityService(module.type, instance);
    }
    if (routes) {
      ctx.app.use(module.pathPrefix, routes.router(instance as EntityCrudService, ctx));
    }
    if (mcpServer) {
      // 0.1.133: the slot returns the MCP server HANDLE directly (not a thunk).
      // Per-turn freshness is host-owned — wrap the slot factory in a thunk so
      // `buildMcpServers()` re-invokes it each turn for a fresh, connectable
      // server (an MCP instance can't be re-`connect`ed across turns).
      // Thunk auto-unwrapping (pre-0.1.133 contract) and shape validation both
      // live in `ProjectPluginHostImpl.buildMcpServers()` — the single choke
      // point every registered factory passes through, including the ones a
      // plugin's own `mount()` registers without going through this adapter.
      const svc = instance as EntityCrudService;
      ctx.registerMcpServer(`${module.type}-tools`, () => mcpServer(svc, ctx));
    }
    if (onEntityRenamed) {
      ctx.registerRenameListener((ev) => onEntityRenamed(ev, ctx));
    }
  };

  return { ...module, backend: { ...backend, mount } };
}
