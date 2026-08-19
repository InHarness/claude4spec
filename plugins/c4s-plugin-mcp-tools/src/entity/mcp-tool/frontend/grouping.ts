import type { McpTool } from '../types.js';

/**
 * Heading for a record whose `server` is blank.
 *
 * `server` is `required`, but the generated input schema accepts an empty
 * string, so a blank one is reachable through the API. The reason this bucket
 * exists is purely that a group heading with no text is unreadable — it is NOT a
 * consistency check wearing a different hat.
 */
export const UNGROUPED_LABEL = 'No server';

/** Stable key for that bucket. Leading space keeps it distinct from any name. */
export const UNGROUPED_KEY = ' ungrouped';

export interface ServerGroup {
  key: string;
  label: string;
  items: McpTool[];
}

/**
 * Group tools by their `server` field.
 *
 * A flat list of MCP tools is close to unreadable — names repeat across servers
 * (`read_page`, `list`, `get`) and the identifier a reader is matching against is
 * `mcp__{server}__{name}`, whose first half would otherwise appear only as a
 * muted column. Grouping puts the server where it belongs: once, as a heading.
 *
 * The field IS the grouping. An earlier revision grouped by a `srv-{server}`
 * tag mirroring this field, so that a page could embed one server's tools with
 * `<tagged_list tags="srv-…"/>`. That mirror is gone: the server name is a loose
 * label, embedding is done on tags an author chooses deliberately, and the two
 * have nothing to do with each other. Reading the field directly is also what
 * makes a tag/field disagreement unrepresentable — there is now only one value.
 *
 * Group order is alphabetical by server, with the blank bucket last.
 */
export function groupByServer(tools: McpTool[]): ServerGroup[] {
  const byServer = new Map<string, McpTool[]>();
  const ungrouped: McpTool[] = [];

  for (const tool of tools) {
    const server = (tool.server ?? '').trim();
    if (!server) {
      ungrouped.push(tool);
      continue;
    }
    const bucket = byServer.get(server);
    if (bucket) bucket.push(tool);
    else byServer.set(server, [tool]);
  }

  const groups: ServerGroup[] = [...byServer.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([server, items]) => ({ key: server, label: server, items }));

  if (ungrouped.length > 0) {
    groups.push({ key: UNGROUPED_KEY, label: UNGROUPED_LABEL, items: ungrouped });
  }
  return groups;
}
