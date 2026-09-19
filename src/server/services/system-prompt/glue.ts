import type { McpInventoryEntry } from './types.js';

/*
 * M48 — the glue every block renders with. Attribute values are escaped, an
 * attribute with no value is not written at all (not as an empty string), and a
 * block with no body is a self-closing tag.
 */

export function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function attrs(o: Record<string, string | number | undefined | null>): string {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}="${escapeAttr(String(v))}"`)
    .join(' ');
}

export function selfClose(name: string, attrsStr: string): string {
  return attrsStr ? `<${name} ${attrsStr}/>` : `<${name}/>`;
}

/** True when the turn mounted a server under this name — the gate for the blocks
 *  that only make sense beside it (today: `<workspace_projects>` beside `c4s-tools`). */
export function hasServer(inventory: readonly McpInventoryEntry[], name: string): boolean {
  return inventory.some((s) => s.name === name);
}

/** Blocks joined by one blank line; a block that did not render leaves no gap. */
export function joinBlocks(rendered: readonly (string | null)[]): string {
  return rendered.filter((s): s is string => s !== null && s !== '').join('\n\n');
}
