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
  /** Ready-to-copy config entry, port and project id already injected. */
  snippet: string;
}

export interface McpConfigResponse {
  /** Exactly three, in presentation order: HTTP project-bound, HTTP workspace-bound, stdio bridge. */
  variants: McpConfigVariant[];
}
