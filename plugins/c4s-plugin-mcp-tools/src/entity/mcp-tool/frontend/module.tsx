import type { FrontendModule } from '@c4s/plugin-runtime';
import {
  MCP_TOOL_DISPLAY_ORDER,
  MCP_TOOL_LABEL,
  MCP_TOOL_LABEL_PLURAL,
  MCP_TOOL_PATH_PREFIX,
  MCP_TOOL_TYPE,
} from '../../../identity.js';
import { mcpToolData, mcpToolSlugPattern } from '../schema.js';
import { McpToolIcon } from './icon.js';
import { McpToolDetail } from './detail-panel.js';
import { mcpToolRoutes } from './routes.js';
import { listByTags, useGetBySlug } from './hooks.js';
import { McpToolChip } from './render-chip.js';
import { McpToolCard } from './render-card.js';
import { McpToolRow } from './render-row.js';

/**
 * The VISIBLE type's frontend module.
 *
 * `sidebarTab` + `routes` are what make this a first-class screen: a tab, a list,
 * a detail page and a deep-linkable history route. `detailPanel` and `routes` are
 * declared BOTH, which the host's slot rules require of a visible type - and
 * `renderOverlay` is deliberately absent, which the same rules require, since a
 * chip with a detail route opens it through the bridge rather than in an overlay.
 *
 * NO `editorExtensions`, per the brief: there is no `/mcp-tool` slash command,
 * because a tool is not authored in flight in prose the way a diagram is. The
 * package contributes no `commands` either, so there is no second declaration to
 * collide with this one.
 *
 * NO `stateSlice`: the list and the detail hold nothing that outlives navigation
 * beyond the query cache.
 */
export const mcpToolFrontendModule: FrontendModule = {
  type: MCP_TOOL_TYPE,
  /**
   * THE SAME declaration the backend contribution carries, not a second copy - a
   * hand-inlined mirror of the server's slug rule is free to drift from it, and
   * has before (a client `slugify` that could not fold non-ASCII produced one
   * slug here and another on the server).
   */
  data: mcpToolData,
  slugPattern: mcpToolSlugPattern,
  // Mirrors the backend contribution; the two declaring different versions is how
  // a frontend quietly reads a shape the server no longer writes.
  payloadVersion: 1,
  label: MCP_TOOL_LABEL,
  labelPlural: MCP_TOOL_LABEL_PLURAL,
  displayOrder: MCP_TOOL_DISPLAY_ORDER,
  pathPrefix: MCP_TOOL_PATH_PREFIX,
  renderRow: McpToolRow as FrontendModule['renderRow'],
  renderChip: McpToolChip as FrontendModule['renderChip'],
  renderCard: McpToolCard as FrontendModule['renderCard'],
  detailPanel: McpToolDetail as FrontendModule['detailPanel'],
  useGetBySlug: ((slug: string | null) =>
    useGetBySlug(slug)) as unknown as FrontendModule['useGetBySlug'],
  listByTags: ({ tags, filter }) => listByTags(tags, filter),
  routes: mcpToolRoutes,
  /**
   * NO `emptyState` here, and that is not a dropped requirement. The brief gives
   * the string "No MCP tools described yet." as a `sidebarTab.emptyState`, but
   * the slot is typed `ComponentType<unknown>` and the host's `Sidebar` never
   * reads it - a component supplied here would be dead code that no user ever
   * sees. The string is not lost: it is the list screen's `EmptyState` title in
   * `routes.tsx`, which is the surface a reader with no tools actually lands on.
   */
  sidebarTab: {
    icon: McpToolIcon as unknown as NonNullable<FrontendModule['sidebarTab']>['icon'],
    label: MCP_TOOL_LABEL_PLURAL,
    order: MCP_TOOL_DISPLAY_ORDER,
  },
};
