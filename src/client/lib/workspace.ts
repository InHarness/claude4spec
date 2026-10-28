/**
 * Client mirror of the workspace-scope payloads (plain `fetch('/api/workspace')`,
 * outside the project prefix — see api-core.ts).
 */
import type { WorkspaceResponse } from '../../shared/workspace-response.js';

export type { WorkspaceResponse };

/** One project of the workspace listing (`GET /api/workspace` → `projects[]`). */
export interface WorkspaceProject {
  id: string;
  name: string;
  cwd: string;
  live: boolean;
}

/**
 * `GET /api/workspace`: the `WorkspaceResponse` fields plus the UI's project
 * listing, which has no route of its own yet (ASSUMPTION:dev-0601).
 */
export interface WorkspaceListing extends WorkspaceResponse {
  projects: WorkspaceProject[];
}

/** One read of the workspace this server process serves. */
export async function fetchWorkspace(): Promise<WorkspaceListing> {
  const res = await fetch('/api/workspace');
  if (!res.ok) throw new Error(`GET /api/workspace failed (HTTP ${res.status})`);
  return (await res.json()) as WorkspaceListing;
}
