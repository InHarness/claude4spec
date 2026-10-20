/**
 * Cross-cutting routes owned by the plugin host (M13), mounted on the PER-PROJECT
 * router (so paths resolve under `/api/projects/:id`). Provides overlay-aware
 * diagnostics + the machine-local trust gate:
 *
 *   GET  /_meta/entities  → activation partition (active/inactive/unknown)
 *   GET  /_meta/plugins   → base ∪ overlay package diagnostics + shadow report
 *   POST /trust-plugins   → persist trustProjectPlugins, trigger context rebuild
 */

import { Router } from 'express';
import { HOST_API_VERSION } from '../../../shared/plugin-host/manifest.js';
import type { PluginHost } from './types.js';
import type { PluginLoadRecord } from './loader.js';
import { overlayRefWarnings, withRefWarnings } from './ref-warnings.js';
import type { WorkspaceRegistry } from '../../workspace/registry.js';
import type { WorkspaceRecord } from '../../workspace/types.js';
import type { ContextInvalidation } from '../../../shared/types.js';

/** One shadowed type with both layers' origins (cross-layer collision). */
export interface ShadowedReportEntry {
  type: string;
  overlayOrigin: string;
  baseOrigin: string;
}

/** Per-project `/_meta/plugins` payload (extends the process-global shape). */
export interface ProjectPluginsMetaResponse {
  hostApiVersion: string;
  /** True when `<cwd>/.claude4spec/plugins/` ships at least one package. */
  localPluginsPresent: boolean;
  /** Machine-local trust decision: undefined = undecided (prompt). */
  trust: boolean | undefined;
  packages: PluginLoadRecord[];
  shadowed: ShadowedReportEntry[];
}

export interface PluginHostRouterDeps {
  host: PluginHost;
  registry: WorkspaceRegistry;
  workspace: WorkspaceRecord;
  projectId: string;
  /** Base-layer package records (synthetic builtin + workspace/npm). */
  basePackages: PluginLoadRecord[];
  /** Overlay-layer package records for THIS project (loaded or untrusted-skipped). */
  overlayRecords: PluginLoadRecord[];
  localPluginsPresent: boolean;
  trust: boolean | undefined;
  /**
   * M31 cache-invalidation hook — fired after a trust change to rebuild the context.
   * Called WITHOUT a reason: a trust flip loads or unloads the whole overlay
   * layer (plugin commands, plugin subagents, the frontend manifest, cross-layer
   * shadowing), not just activation, so every tab of the project keeps the M31
   * full reload. The goal there is "no server restart", which the rebuild gives.
   */
  onContextConfigChanged?: (opts?: ContextInvalidation) => void;
}

export function pluginHostRouter(deps: PluginHostRouterDeps): Router {
  const {
    host,
    registry,
    workspace,
    projectId,
    basePackages,
    overlayRecords,
    localPluginsPresent,
    trust,
    onContextConfigChanged,
  } = deps;
  const router = Router();

  router.get('/_meta/entities', (_req, res) => {
    res.json(host.partition());
  });

  // M33: commands of all loaded+trusted plugins in the effective pool —
  // axis B, deliberately NOT filtered by `config.entities` (so a plugin's
  // slash-commands survive deactivation of its entity types). The editor
  // registers each command as a slash extension. 2.1.21: there is no
  // `/_meta/plugin-settings` any more — plugins contribute no settings.
  router.get('/_meta/plugin-commands', (_req, res) => {
    res.json({ commands: host.listCommands() });
  });

  const overlayWithWarnings = (): PluginLoadRecord[] =>
    withRefWarnings(overlayRecords, overlayRefWarnings(host.listAvailable(), overlayRecords));

  router.get('/_meta/plugins', (_req, res) => {
    const baseOriginForType = (type: string): string =>
      basePackages.find((p) => p.contributedTypes?.includes(type))?.package ?? '@c4s/builtin';
    const shadowed: ShadowedReportEntry[] = host.shadowReport().map((s) => ({
      type: s.type,
      overlayOrigin: s.overlayOrigin,
      baseOrigin: baseOriginForType(s.type),
    }));
    const response: ProjectPluginsMetaResponse = {
      hostApiVersion: HOST_API_VERSION,
      localPluginsPresent,
      trust,
      // 2.1.41 — an overlay type's ref warnings are judged against base ∪ overlay.
      packages: [...basePackages, ...overlayWithWarnings()],
      shadowed,
    };
    res.json(response);
  });

  // M33 trust gate. Persists the decision per (workspace × project) in
  // `~/.claude4spec/` (never the repo) and rebuilds the context so the overlay
  // (un)loads without a process restart. The client refetches activation after.
  router.post('/trust-plugins', (req, res) => {
    const value = (req.body as { trust?: unknown } | undefined)?.trust;
    if (typeof value !== 'boolean') {
      return res
        .status(400)
        .json({ error: { code: 'VALIDATION', message: 'trust must be a boolean' } });
    }
    registry.setProjectTrust(workspace, projectId, value);
    // Not `activation-changed`: the overlay layer itself changed — reload the tabs.
    onContextConfigChanged?.();
    res.json({ trust: value });
  });

  return router;
}
