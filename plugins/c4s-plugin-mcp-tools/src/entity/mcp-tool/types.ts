/**
 * Client-side mirrors of `data.schema`. TYPES ONLY — validation is the host's,
 * generated from the same declaration, and a second copy of the rules here would
 * be a second thing to keep in step.
 */

/** One row of `params[]` — the flat reading of the protocol's `inputSchema`. */
export interface McpToolParam {
  name: string;
  type: string;
  required?: boolean;
  default?: string | null;
  description?: string | null;
}

/**
 * The four annotation hints.
 *
 * `boolean | null | undefined` and NOT `boolean`, in every one of them. Absent
 * means "the server declares no annotation", which is a different fact from an
 * explicit `false`, and the type is where that difference has to survive first —
 * a renderer given `boolean` has already lost it.
 */
export type McpToolHint = boolean | null | undefined;

export interface McpTool {
  slug: string;
  title: string;
  name: string;
  server: string;
  description: string;
  params: McpToolParam[];
  returns?: string | null;
  sampleReturn?: string | null;
  readOnlyHint?: McpToolHint;
  destructiveHint?: McpToolHint;
  idempotentHint?: McpToolHint;
  openWorldHint?: McpToolHint;
  logic?: string | null;
  /**
   * Tag slugs, carried on every generated read. Load-bearing for this type
   * rather than decorative: the `srv-{server}` mirror tag in here is what the
   * list groups by and what a page's embedded tool list filters on.
   */
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

/** What a create call must carry — the host's generated schema enforces it. */
export interface McpToolCreate {
  name: string;
  server: string;
  description: string;
  slug?: string;
  params?: McpToolParam[];
  returns?: string | null;
  sampleReturn?: string | null;
  readOnlyHint?: McpToolHint;
  destructiveHint?: McpToolHint;
  idempotentHint?: McpToolHint;
  openWorldHint?: McpToolHint;
  logic?: string | null;
  tags?: string[];
}

export type McpToolUpdate = Partial<Omit<McpToolCreate, 'tags'>>;

/** The four hints in render order, with the labels the detail panel draws. */
export const MCP_TOOL_HINTS = [
  { key: 'readOnlyHint', label: 'Read-only' },
  { key: 'destructiveHint', label: 'Destructive' },
  { key: 'idempotentHint', label: 'Idempotent' },
  { key: 'openWorldHint', label: 'Open world' },
] as const satisfies ReadonlyArray<{ key: keyof McpTool; label: string }>;
