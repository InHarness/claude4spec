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
import type { WorkspaceRegistry } from '../../workspace/registry.js';
import type { WorkspaceRecord } from '../../workspace/types.js';

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
  /** M31 cache-invalidation hook — fired after a trust change to rebuild the context. */
  onContextConfigChanged?: () => void;
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

  // M33: settings/commands of all loaded+trusted plugins in the
  // effective pool — axis B, deliberately NOT filtered by `config.entities`
  // (so a plugin's Settings section + slash-commands survive deactivation of
  // its entity types). The Settings panel renders one section per plugin under
  // `config.plugins[<name>]`; the editor registers each command as a slash
  // extension.
  router.get('/_meta/plugin-settings', (_req, res) => {
    res.json({ sections: host.listSettings() });
  });

  router.get('/_meta/plugin-commands', (_req, res) => {
    res.json({ commands: host.listCommands() });
  });

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
      packages: [...basePackages, ...overlayRecords],
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
    onContextConfigChanged?.();
    res.json({ trust: value });
  });

  return router;
}
