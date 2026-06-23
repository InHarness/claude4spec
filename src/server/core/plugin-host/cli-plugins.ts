/**
 * M33 — server-free plugin diagnostics for the `c4s plugins` CLI.
 *
 * Runs the SAME bootstrap loader as the server (base packages) + the project's
 * trusted overlay, so `c4s plugins list|status|doctor` report the identical
 * loader state as `GET /api/_meta/plugins` without a running server. Kept free
 * of express so the CLI bundle stays light.
 */

import path from 'node:path';
import { HOST_API_VERSION } from '../../../shared/plugin-host/manifest.js';
import { PluginRegistryImpl } from './registry.js';
import { registerAllPlugins } from '../../serialization/registerAll.js';
import { loadWorkspacePlugins, type PluginLoadRecord } from './loader.js';
import { buildBasePluginPackages } from './base-packages.js';
import { enumerateOverlayPackages, loadProjectOverlay } from './overlay-loader.js';
import { WorkspaceRegistry } from '../../workspace/registry.js';
import { resolveWorkspaceProject } from '../../../core/workspace/resolve.js';

export interface PluginDiagnostics {
  hostApiVersion: string;
  /** Overlay trust state for the resolved project (`undefined` = undecided). */
  trust: boolean | undefined;
  packages: PluginLoadRecord[];
}

/**
 * Collect base + overlay loader records for the resolved project. Mirrors the
 * server's per-project `/_meta/plugins` assembly (base ∪ trust-gated overlay).
 */
export async function collectPluginDiagnostics(opts: {
  project?: string;
  workspace?: string;
}): Promise<PluginDiagnostics> {
  const resolved = resolveWorkspaceProject(opts);

  const registry = new PluginRegistryImpl();
  registerAllPlugins(registry);
  const baseLoad = await loadWorkspacePlugins(registry, resolved.pluginPackages);
  const base = buildBasePluginPackages(registry, baseLoad.records);

  const wsRegistry = new WorkspaceRegistry();
  const workspace = wsRegistry.getWorkspace(resolved.workspaceName);
  const trust = workspace ? wsRegistry.getProjectTrust(workspace, resolved.projectId) : undefined;

  const localPackages = enumerateOverlayPackages(resolved.projectDir);
  let overlayRecords: PluginLoadRecord[] = [];
  if (localPackages.length > 0 && trust === true) {
    overlayRecords = (await loadProjectOverlay(resolved.projectDir)).records;
  } else if (localPackages.length > 0) {
    overlayRecords = localPackages.map((pkg) => ({
      package: pkg,
      status: 'skipped' as const,
      code: 'PLUGIN_PROJECT_UNTRUSTED' as const,
      reason: 'project plugins not trusted on this machine (trustProjectPlugins)',
      layer: 'overlay' as const,
      trust: 'untrusted' as const,
      origin: path.join('.claude4spec', 'plugins', pkg),
    }));
  }

  return { hostApiVersion: HOST_API_VERSION, trust, packages: [...base, ...overlayRecords] };
}
