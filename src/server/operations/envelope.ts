/**
 * L3 — the result/error envelope of the operation catalog.
 *
 * Input is JSON validated by the operation's schema. Output shape depends only
 * on the CHANNEL, never on the operation:
 *
 * `internal` / `mcp` success:
 * ```json
 * { "content": [{ "type": "text", "text": "<data as a JSON string>" }] }
 * ```
 *
 * `internal` / `mcp` error:
 * ```json
 * { "content": [{ "type": "text", "text": "{\"error\":\"...\",\"code\":\"...\"}" }], "isError": true }
 * ```
 *
 * `rest` and `cli` keep their own envelopes (L4 / L14) — but the CODE is shared;
 * see `error-codes.ts`. That is the whole point: the envelope is the channel's,
 * the taxonomy is the catalog's.
 *
 * Every MCP tool in the repo hand-rolled these two shapes before 0.2.13, which
 * is how `{ error: { code, message } }` and `{ error, code }` both ended up on
 * the wire from tools sitting on the same server.
 */

/** The MCP tool result shape, structurally identical to the vendor's `McpToolResult`. */
export interface ToolEnvelope {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** `internal` / `mcp` success — data serialized into a single text block. */
export function toolSuccess(data: unknown): ToolEnvelope {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

/**
 * `internal` / `mcp` error. `hint` is carried alongside rather than folded into
 * `error`: it is the half that says which call WOULD have worked, and a caller
 * that wants to act on it has to be able to tell the two apart.
 */
export function toolError(code: string, message: string, hint?: string): ToolEnvelope {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message, code, ...(hint ? { hint } : {}) }) }],
    isError: true,
  };
}

/**
 * The `rest` envelope, for handlers that build a refusal by hand rather than
 * throwing. Throwing `DomainError`/`DiscoveryError` and letting
 * `routes/errors.ts` map it is still preferred — it is the path that already
 * forwards `hint` and picks the status from the shared tables.
 */
export function restError(code: string, message: string, hint?: string): { error: { code: string; message: string; hint?: string } } {
  return { error: { code, message, ...(hint ? { hint } : {}) } };
}
