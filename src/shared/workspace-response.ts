/**
 * 2.1.58 (M31 L4, DTO `workspace-response`): the answer of `GET /api/workspace`
 * — the workspace this server process serves. Read by the screens that have no
 * project to take these values from (the workspace route frame, the workspace
 * settings page).
 */
export interface WorkspaceResponse {
  /** The workspace's name — its identity in the registry. */
  name: string;
  /**
   * `registry` — the project composition lives in the registry entry;
   * `home` — in the committed `workspace.json` of the home directory.
   */
  kind: 'registry' | 'home';
  /**
   * `id` of the project opened last in this workspace; `null` when none was
   * opened or that project no longer belongs to the workspace.
   */
  lastOpenedProject: string | null;
}
