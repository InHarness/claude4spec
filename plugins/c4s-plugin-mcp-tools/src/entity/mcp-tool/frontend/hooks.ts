import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mcpToolsApi, type McpToolListQuery } from './api.js';
import { MCP_TOOL_TYPE } from '../../../identity.js';
import type { McpTool, McpToolCreate, McpToolUpdate } from '../types.js';

const keys = {
  all: [MCP_TOOL_TYPE] as const,
  list: (q: McpToolListQuery) => [MCP_TOOL_TYPE, 'list', q] as const,
  detail: (slug: string) => [MCP_TOOL_TYPE, 'detail', slug] as const,
};

export function useMcpToolList(query: McpToolListQuery = {}) {
  return useQuery({ queryKey: keys.list(query), queryFn: () => mcpToolsApi.list(query) });
}

/**
 * THREE STATES, and the panel discriminates all three: `undefined` while
 * loading, `null` when the slug resolves to nothing, the tool otherwise.
 *
 * The `null` arm has to be MADE — `apiFetch` throws on any non-2xx, so without
 * this a 404 leaves `data` permanently `undefined` and the panel renders a
 * skeleton forever. Only 404 becomes `null`: "this tool does not exist" and "the
 * server did not answer" are different facts, and the panel must not report the
 * second as the first.
 */
export function useGetBySlug(slug: string | null) {
  return useQuery({
    queryKey: slug ? keys.detail(slug) : [MCP_TOOL_TYPE, 'detail', 'none'],
    queryFn: async (): Promise<McpTool | null> => {
      try {
        return await mcpToolsApi.get(slug as string);
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
    enabled: Boolean(slug),
    // A missing entity is an ANSWER, not a failure to get one.
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 3,
  });
}

export function useCreateMcpTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: McpToolCreate) => mcpToolsApi.create(input),
    onSuccess: (tool: McpTool) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.invalidateQueries({ queryKey: keys.detail(tool.slug) });
      // The create path assigns the `srv-{server}` mirror tag, so the tag
      // registry the list groups by has just changed.
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useUpdateMcpTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, body }: { slug: string; body: McpToolUpdate & { newSlug?: string } }) =>
      mcpToolsApi.update(slug, body),
    onSuccess: (tool: McpTool, { slug }) => {
      qc.invalidateQueries({ queryKey: keys.all });
      // A rename moved the row: the old key can never resolve again.
      if (slug !== tool.slug) qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.invalidateQueries({ queryKey: keys.detail(tool.slug) });
      qc.invalidateQueries({ queryKey: ['versions', MCP_TOOL_TYPE, tool.slug] });
      qc.invalidateQueries({ queryKey: ['tags'] });
      // A rename repoints references inside pages, so their cache is stale too.
      qc.invalidateQueries({ queryKey: ['pages'] });
    },
  });
}

export function useDeleteMcpTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug }: { slug: string }) => mcpToolsApi.remove(slug),
    onSuccess: (_data, { slug }) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.removeQueries({ queryKey: keys.detail(slug) });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

/** The `listByTags` slot the host calls to fill a tag page. */
export async function listByTags(tags: string[], filter: 'and' | 'or' = 'or'): Promise<McpTool[]> {
  return mcpToolsApi.list({ tags, tagFilter: filter });
}
