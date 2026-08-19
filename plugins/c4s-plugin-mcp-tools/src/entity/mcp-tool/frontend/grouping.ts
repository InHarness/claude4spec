import { SERVER_TAG_PREFIX, serverFromTag } from '../../../identity.js';
import type { McpTool } from '../types.js';

/**
 * Heading shown for tools carrying no `srv-*` tag.
 *
 * They are GROUPED, not dropped. A tool whose mirror tag is missing has already
 * fallen out of its server's embedded list — that is the silent failure this type
 * lives with — and hiding it from the one screen that could reveal the problem
 * would make the silence total. `/acs` does the same thing under "Project-level".
 */
export const UNGROUPED_LABEL = 'No server tag';

/** Stable key for that bucket. Not a tag slug — no tag may collide with it. */
export const UNGROUPED_KEY = ' ungrouped';

export interface ServerGroup {
  key: string;
  label: string;
  items: McpTool[];
}

/**
 * Group tools by their `srv-*` MIRROR TAG, not by the `server` field.
 *
 * By the tag, deliberately, even though the field is right there and always
 * populated. The tag is what the page-embedding mechanism filters on, so grouping
 * by it makes this screen show exactly what a server's page will show — including
 * the discrepancies. Grouping by the field instead would render a tidy, correct
 * list and hide the one failure mode the type actually has.
 *
 * A tool carrying two `srv-*` tags appears under each. That is not tidied up
 * here: it is a real authoring mistake with a real consequence (the tool shows up
 * in two servers' lists), and this screen is where it should be visible.
 *
 * Group order is alphabetical by server, with the ungrouped bucket last — it is
 * an exception bucket, and an exception belongs at the end, not sorted into the
 * middle by whatever its label happens to start with.
 */
export function groupByServerTag(tools: McpTool[]): ServerGroup[] {
  const byServer = new Map<string, McpTool[]>();
  const ungrouped: McpTool[] = [];

  for (const tool of tools) {
    const servers = (tool.tags ?? [])
      .filter((t) => t.startsWith(SERVER_TAG_PREFIX))
      .map(serverFromTag)
      .filter((s): s is string => Boolean(s));

    if (servers.length === 0) {
      ungrouped.push(tool);
      continue;
    }
    for (const server of servers) {
      const bucket = byServer.get(server);
      if (bucket) bucket.push(tool);
      else byServer.set(server, [tool]);
    }
  }

  const groups: ServerGroup[] = [...byServer.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([server, items]) => ({ key: `${SERVER_TAG_PREFIX}${server}`, label: server, items }));

  if (ungrouped.length > 0) {
    groups.push({ key: UNGROUPED_KEY, label: UNGROUPED_LABEL, items: ungrouped });
  }
  return groups;
}
