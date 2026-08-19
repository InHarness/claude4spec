/**
 * Identity of the type this package contributes.
 *
 * Plain constants, and the module is deliberately REACT-FREE: it is reachable
 * from `src/index.ts`, the entry the host's Node loader imports on every boot.
 * Reading a string literal out of a `.tsx` would put React, `react/jsx-runtime`
 * and `lucide-react` on the server's plugin-load path, and turn any install that
 * prunes UI dependencies from its server image into a hard `PLUGIN_IMPORT_FAILED`
 * with the type silently absent. Two envelopes learned this the same way.
 */

export const MCP_TOOL_TYPE = 'mcp-tool';

/**
 * The projection table, stated for tests to assert against rather than to
 * configure anything: the host derives it from the type via `typeTablePrefix`,
 * so `mcp-tool` → `mcp_tool` with nothing declared. `params` carries no
 * `keyFields`, so it stays EMBEDDED JSON on this row instead of projecting to a
 * table of its own — a parameter list is read with its tool, never queried
 * across tools.
 */
export const MCP_TOOL_TABLE = 'mcp_tool';

export const MCP_TOOL_PATH_PREFIX = '/mcp-tools';
export const MCP_TOOL_LABEL = 'MCP Tool';
export const MCP_TOOL_LABEL_PLURAL = 'MCP Tools';

/** Sidebar position among the contributed types, and the release-diff order. */
export const MCP_TOOL_DISPLAY_ORDER = 8;
