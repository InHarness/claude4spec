/**
 * M33: lower a runtime plugin's authoring shape (`EntityContribution`) into the
 * internal `BackendModule` the host already understands. This keeps
 * `mountBackend` / `MountContext` / `ProjectPluginHost` 100% unchanged — the
 * manifest is purely an authoring envelope, reconciled here.
 *
 * Two backend shapes are supported:
 *  - `backend.mount` (full power)  — passes through as the `BackendModule` mount.
 *  - `backend.routes` (sugar)      — a pre-built express Router; synthesized into
 *    `mount = (ctx) => ctx.app.use(pathPrefix, routes)`. No MCP server, no entity
 *    service, no migrations beyond what is declared.
 */

import type { Router } from 'express';
import type { EntityContribution } from '../../../shared/plugin-host/manifest.js';
import type { EntitySerializer } from '../../serialization/types.js';
import type { BackendModule, MountContext, PluginMountFn, SqlMigration } from './types.js';

/** Thrown when a contribution is structurally invalid. Caught per-package by the loader. */
export class PluginManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginManifestError';
  }
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
 * server payloads) into a fully-typed `BackendModule`.
 */
export function lowerEntityContribution(c: EntityContribution): BackendModule {
  assertContribution(c);

  const backend = c.backend;
  let backendSlot: BackendModule['backend'];

  if (backend) {
    const migrations = backend.migrations as SqlMigration[] | undefined;
    let mount = backend.mount as PluginMountFn | undefined;

    if (!mount && backend.routes != null) {
      const routes = backend.routes as Router;
      const pathPrefix = c.pathPrefix;
      mount = (ctx: MountContext): void => {
        ctx.app.use(pathPrefix, routes);
      };
    }

    if (mount && typeof mount !== 'function') {
      throw new PluginManifestError(`entity "${c.type}" — backend.mount must be a function`);
    }

    backendSlot = { migrations, mount };
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
