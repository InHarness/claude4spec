/**
 * 0.2.93 (M12) — `GET /api/projects/:id/_meta/mcp-config`.
 *
 * Every field arrives ready to display: the client neither interpolates a port
 * nor a project id, it renders `label` and copies `snippet` byte for byte.
 */
export interface McpConfigVariant {
  /** Stable key — the pill key and the active-selection key. */
  id: string;
  /** Pill label, ready to display. */
  label: string;
  /**
   * Ready-to-copy config entry — an instance of the spec's code snippet
   * `wpis-serwera-c4s-reader`, the workspace `publicUrl` and the project `id`
   * already injected from the workspace registry.
   */
  snippet: string;
}

export interface McpConfigResponse {
  /** Exactly three, in presentation order: HTTP project-bound, HTTP workspace-bound, stdio bridge. */
  variants: McpConfigVariant[];
}
