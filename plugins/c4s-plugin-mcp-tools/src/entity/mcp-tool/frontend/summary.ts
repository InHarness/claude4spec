import type { McpTool, McpToolHint } from '../types.js';
import { MCP_TOOL_HINTS } from '../types.js';

/**
 * The three-state reading of an annotation hint, in ONE place.
 *
 * This is the type's most collapsible rule, so it is a function rather than a
 * convention: absent means "the server declares no annotation", which is a
 * different fact from a declared `false` and must never be rendered as one.
 *
 * The `0`/`1` arm is not defensive padding. The host stores every top-level
 * boolean as a SQLite integer and writes it to the entity file the same way
 * (`"headerRow": 1` throughout the corpus), so a declared `false` can reach a
 * renderer as `0` — falsy, and indistinguishable from absent to any `if (hint)`.
 * That is exactly the collapse this function exists to prevent.
 */
export function readHint(value: McpToolHint | 0 | 1): 'yes' | 'no' | 'undeclared' {
  if (value === null || value === undefined) return 'undeclared';
  return value ? 'yes' : 'no';
}

/** The hints a server actually declared, in render order. Absent ones drop out. */
export function declaredHints(tool: McpTool): Array<{ label: string; value: boolean }> {
  const out: Array<{ label: string; value: boolean }> = [];
  for (const { key, label } of MCP_TOOL_HINTS) {
    const state = readHint(tool[key] as McpToolHint);
    if (state !== 'undeclared') out.push({ label, value: state === 'yes' });
  }
  return out;
}

/**
 * The one-line shape of a tool, for a row or a card: how many parameters, how
 * many of them are required.
 *
 * A tool with NO parameters says so explicitly rather than rendering an empty
 * string — "no parameters" is a legal and common state (an operation taking only
 * a slug), and a blank line would read as missing description instead.
 */
export function shapeSummary(tool: McpTool): string {
  const params = tool.params ?? [];
  if (params.length === 0) return 'no parameters';
  const required = params.filter((p) => p.required).length;
  const noun = params.length === 1 ? 'parameter' : 'parameters';
  return required > 0
    ? `${params.length} ${noun} · ${required} required`
    : `${params.length} ${noun}`;
}
