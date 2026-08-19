import type { EntityContribution } from '@c4s/plugin-runtime';
import {
  MCP_TOOL_DISPLAY_ORDER,
  MCP_TOOL_LABEL,
  MCP_TOOL_LABEL_PLURAL,
  MCP_TOOL_PATH_PREFIX,
  MCP_TOOL_TYPE,
} from '../../identity.js';
import { mcpToolData, mcpToolSlugPattern } from './schema.js';
import { mcpToolSystemPrompt } from './system-prompt.js';

/**
 * The `mcp-tool` contribution.
 *
 * WHAT IS NOT HERE is most of what this type is.
 *
 * NO `backend` KEY AT ALL, and its absence is the declaration. The type has no
 * domain method beyond CRUD, so there is no service, no router, no MCP server of
 * its own — the host generates the write path from `data.schema`, the REST
 * router from `pathPrefix` + `data`, the `mcp_tool` projection table from the
 * same schema, the search scope from its text leaves, and snapshot/restore/diff
 * from the declaration. The one-line justification: A DESCRIPTION OF A TOOL IS
 * NOT EXECUTABLE. This entity validates nothing, calls nothing and mounts
 * nothing, so there is nothing for a backend slot to hold.
 *
 * (It is not the first such package — `database-table` declares no `backend`
 * either, and `dto` says so in its own header. What is true of this one is the
 * reason: not "the host got good enough at deriving CRUD", but "there is no
 * behaviour here to describe".)
 *
 * NO `slugConflict`, which leaves the host default `'reject'` — and that default
 * is load-bearing for this type. A duplicate `(server, name)` pair is TWO
 * DESCRIPTIONS OF ONE TOOL, not two tools; a `-2` suffix would record the
 * mistake as a legal catalogue entry instead of refusing it. `spreadsheet`
 * declares `'suffix'` because two sheets sharing a title is ordinary. Two tools
 * sharing a server and a name is not.
 *
 * NO `payloadUpgrades`, because `payloadVersion` is 1 — nothing of this type
 * exists on disk anywhere, so there is no earlier shape to migrate from. The
 * chain starts empty and stays that way until a field changes meaning.
 */
export const mcpToolEntity: EntityContribution = {
  type: MCP_TOOL_TYPE,
  data: mcpToolData,
  slugPattern: mcpToolSlugPattern,
  payloadVersion: 1,
  label: MCP_TOOL_LABEL,
  labelPlural: MCP_TOOL_LABEL_PLURAL,
  displayOrder: MCP_TOOL_DISPLAY_ORDER,
  pathPrefix: MCP_TOOL_PATH_PREFIX,
  systemPrompt: mcpToolSystemPrompt,
};
