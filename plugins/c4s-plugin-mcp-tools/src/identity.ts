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

/**
 * The MIRROR TAG prefix, and the one hand-synchronised value in this type.
 *
 * `server` has to be a structural field — it is a member of the `mcp__{server}__{name}`
 * identifier the model sees, and an input to the slug pattern. But the embedding
 * mechanism that puts a server's tool list on a page filters by TAG and never by
 * field value, so every record additionally carries `srv-{server}`.
 *
 * The cost is explicit and deliberately NOT engineered away here: nothing
 * validates the pair. `check_consistency` cannot see it, because a tag is not a
 * reference. When the two disagree the failure is silent — the tool vanishes
 * from its server's list while the entity still exists. The create dialog
 * pre-fills the tag from the typed `server` so the common path stays aligned;
 * beyond that it is author discipline, enforced only by an acceptance criterion.
 */
export const SERVER_TAG_PREFIX = 'srv-';

/** `srv-{server}` for a server name. The one place that spelling is composed. */
export function serverTagFor(server: string): string {
  return `${SERVER_TAG_PREFIX}${server}`;
}

/** The server a mirror tag names, or `null` when the tag is not a mirror tag. */
export function serverFromTag(tag: string): string | null {
  return tag.startsWith(SERVER_TAG_PREFIX) ? tag.slice(SERVER_TAG_PREFIX.length) : null;
}
