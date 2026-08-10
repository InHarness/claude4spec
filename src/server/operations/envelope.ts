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

import { DEFAULT_BUDGET_CHARS } from '../discovery/budget.js';

/** The MCP tool result shape, structurally identical to the vendor's `McpToolResult`. */
export interface ToolEnvelope {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * Who is being measured — the operation's name and the channel that rendered it.
 *
 * This does NOT contradict the header's "output shape depends only on the
 * CHANNEL, never on the operation". That rule is about the shape on the WIRE:
 * the envelope must not grow a field because of which operation filled it. What
 * the function KNOWS is a different axis from what it emits, and `ctx` never
 * reaches `content`.
 */
export interface ToolCallContext {
  /** Catalog name of the operation, e.g. `update_sections`. */
  operation: string;
  /** The rendering channel — `mcp` and `internal` both land here. */
  channel: string;
}

/**
 * The last N measurements, newest last. A ring rather than a growing array: this
 * runs on every tool call for the life of the process.
 */
const MEASUREMENT_RING = 200;
const measurements: ResponseSizeRecord[] = [];

export interface ResponseSizeRecord {
  operation: string;
  channel: string;
  chars: number;
  /** True when this response alone exceeded the whole budget. */
  overBudget: boolean;
}

/**
 * Response size, per call, in the same unit as the budget: characters of
 * serialized JSON (`discovery/budget.ts` counts `JSON.stringify(item).length`).
 *
 * Measuring HERE rather than in each tool handler is the whole point — it is the
 * one locus every agent-facing channel already passes through, so a single
 * instrumentation covers all of them and no new tool can quietly escape it.
 *
 * 0.2.15 — ALWAYS ON, where it used to be gated on `C4S_RESPONSE_SIZE=1`.
 *
 * The gate made the measurement a diagnostic someone had to think to enable,
 * which is the same as not having it: the budget contract
 * (`DEFAULT_BUDGET_CHARS`) and the echo-free rule are both claims ABOUT response
 * size, and a claim with no instrument behind it cannot be falsified. It costs
 * one `length` read on a string that was serialized anyway.
 *
 * What is still gated is the LOG LINE — a line per tool call is noise by
 * default. The record is kept either way, so a test or a diagnostic route can
 * ask what the last calls actually cost.
 */
function recordResponseSize(chars: number, ctx: ToolCallContext | undefined): void {
  const record: ResponseSizeRecord = {
    operation: ctx?.operation ?? 'unknown',
    channel: ctx?.channel ?? 'unknown',
    chars,
    overBudget: chars > DEFAULT_BUDGET_CHARS,
  };
  measurements.push(record);
  if (measurements.length > MEASUREMENT_RING) measurements.shift();
  if (process.env.C4S_RESPONSE_SIZE === '1') {
    console.log(`[response-size] ${record.operation} ${record.channel} ${chars}`);
  }
  /**
   * A response that blows the budget on its own is warned about unconditionally.
   * It is not an error — the operation answered, and truncating here would
   * corrupt a payload the caller is already parsing — but it is the signal that
   * some operation is missing a budget, and it should not need an env var to
   * become visible.
   */
  if (record.overBudget) {
    console.warn(
      `[response-size] ${record.operation} (${record.channel}) returned ${chars} chars, over the ${DEFAULT_BUDGET_CHARS} budget`,
    );
  }
}

/** The recent measurements, oldest first. For tests and diagnostics. */
export function recentResponseSizes(): readonly ResponseSizeRecord[] {
  return measurements;
}

/**
 * `internal` / `mcp` success — data serialized into a single text block.
 *
 * Serialized once: the string that goes on the wire is the string that gets
 * measured, so the number in the log cannot drift from what the caller paid for.
 */
export function toolSuccess(data: unknown, ctx?: ToolCallContext): ToolEnvelope {
  const text = JSON.stringify(data);
  recordResponseSize(text?.length ?? 0, ctx);
  return { content: [{ type: 'text', text }] };
}

/**
 * `internal` / `mcp` error. `hint` is carried alongside rather than folded into
 * `error`: it is the half that says which call WOULD have worked, and a caller
 * that wants to act on it has to be able to tell the two apart.
 *
 * `extra` is for the fields a specific refusal carries as its REMEDY, not as
 * decoration — `currentHash` on a `PAGE_CONFLICT` is the whole recovery path (the
 * caller re-reads, re-applies, passes it back), so dropping it turns a
 * recoverable conflict into a dead end. It stays a narrow door on purpose: a
 * refusal that needs a field the taxonomy does not have is usually a refusal
 * that needs a better code.
 */
export function toolError(
  code: string,
  message: string,
  hint?: string,
  extra?: Record<string, unknown>,
): ToolEnvelope {
  return {
    content: [
      { type: 'text', text: JSON.stringify({ error: message, code, ...(hint ? { hint } : {}), ...extra }) },
    ],
    isError: true,
  };
}

/**
 * The refusal envelope for a thrown error — the shape every MCP tool server in
 * this repo had its own copy of.
 *
 * Three of them were written or rewritten in 0.2.13 alone, each subtly different:
 * `page-tools` forwarded `hint` and `currentHash`, `plan-tools` forwarded neither,
 * `brief-tools` forwarded only the message. So `DomainError.hint` — the field this
 * release added expressly to carry the repair path — was silently dropped on every
 * plan refusal, and `entities-router.decodeToolFailure` had to sniff two shapes on
 * the way back. A module whose header says "every tool hand-rolled these" while
 * every new tool goes on hand-rolling them has documented the problem rather than
 * fixed it.
 *
 * Structural typing, not `instanceof`: `DomainError` and `ConflictError` live in
 * two service modules that this one must not depend on (the dependency runs the
 * other way), and both are plain classes carrying `code`/`hint`/`currentHash`.
 */
export function toolFailure(err: unknown): ToolEnvelope {
  const e = err as { code?: unknown; hint?: unknown; currentHash?: unknown; message?: unknown };
  const code = typeof e?.code === 'string' ? e.code : 'INTERNAL';
  const message = err instanceof Error ? err.message : String(err);
  const hint = typeof e?.hint === 'string' ? e.hint : undefined;
  const extra = typeof e?.currentHash === 'string' ? { currentHash: e.currentHash } : undefined;
  return toolError(code, message, hint, extra);
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
