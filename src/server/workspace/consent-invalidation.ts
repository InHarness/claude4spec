import type { WorkspaceRegistry } from './registry.js';
import type { WorkspaceRecord } from './types.js';

/**
 * M31 `m31ctx001` (2.1.67): in the server process, a machine-local consent
 * written through this process's registry — `setProjectTrust` or
 * `setSkillUsesConfirmation` — invalidates the cached context of that project
 * of the served workspace (the project goes to the invalidated level of the
 * build queue). A write made by another process (the `c4s` CLI) goes through
 * another registry instance and reaches no listener here. Returns the
 * unsubscribe, called at shutdown.
 */
export function invalidateOnConsentChange(
  registry: Pick<WorkspaceRegistry, 'onProjectConsentChanged'>,
  workspace: Pick<WorkspaceRecord, 'name' | 'home'>,
  cache: { invalidate(projectId: string): void },
): () => void {
  return registry.onProjectConsentChanged((ws, projectId) => {
    if (ws.name === workspace.name && ws.home === workspace.home) cache.invalidate(projectId);
  });
}
