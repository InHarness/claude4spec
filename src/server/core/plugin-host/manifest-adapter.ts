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
import type { EntitySerializer } from '../../serialization/types.js';
import type { EntityCrudService } from './entity-crud-service.js';
import type { BackendModule, McpServerFactory, MountContext, PluginMountFn, SqlMigration } from './types.js';

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
  'table',
  'label',
  'labelPlural',
  'displayOrder',
  'slugFrom',
  'pathPrefix',
] as const;

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
  if (typeof c.slugFrom !== 'function') {
    throw new PluginManifestError(`entity "${c.type}" — slugFrom must be a function`);
  }
  if (c.serializer == null) {
    throw new PluginManifestError(`entity "${c.type}" — serializer is required`);
  }
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
    const migrations = backend.migrations as SqlMigration[] | undefined;
    const mount = backend.mount as PluginMountFn | undefined;
    if (mount && typeof mount !== 'function') {
      throw new PluginManifestError(`entity "${c.type}" — backend.mount must be a function`);
    }

    backendSlot = {
      migrations,
      mount,
      service: backend.service as ((ctx: MountContext) => EntityCrudService) | undefined,
      crud: backend.crud as NonNullable<BackendModule['backend']>['crud'],
      routes: backend.routes as
        | { router: (service: EntityCrudService, ctx: MountContext) => Router }
        | undefined,
      mcpServer: backend.mcpServer as
        | ((service: EntityCrudService, ctx: MountContext) => McpServerFactory)
        | undefined,
    };
  }

  return {
    type: c.type,
    table: c.table,
    label: c.label,
    labelPlural: c.labelPlural,
    displayOrder: c.displayOrder,
    slugFrom: c.slugFrom,
    pathPrefix: c.pathPrefix,
    serializer: c.serializer as EntitySerializer<unknown>,
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
 * `mcpServer` is declared without `service` — both factories receive the
 * service instance as their first argument and would otherwise fail
 * confusingly at first mount, deep inside a project's request path.
 */
export function synthesizeMount(module: BackendModule): BackendModule {
  const backend = module.backend;
  if (!backend || backend.mount) return module;

  const { service, crud, routes, mcpServer } = backend;
  if (!service && !crud && !routes && !mcpServer) return module;

  if (crud && !service) {
    throw new PluginManifestError(`entity "${module.type}" — backend.crud requires backend.service`);
  }
  if (mcpServer && !service) {
    throw new PluginManifestError(`entity "${module.type}" — backend.mcpServer requires backend.service`);
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
      ctx.registerMcpServer(`${module.type}-tools`, mcpServer(instance as EntityCrudService, ctx));
    }
  };

  return { ...module, backend: { ...backend, mount } };
}
