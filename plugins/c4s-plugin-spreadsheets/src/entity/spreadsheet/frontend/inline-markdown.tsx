/**
 * Inline-markdown renderer for spreadsheet cell values (0.0.2).
 *
 * A cell value is a plain `string` everywhere in the data layer (storage, index,
 * serializer) — markdown is JUST a string. This module is the ONE place where
 * that string is interpreted as markdown, and only the INLINE subset:
 *
 *   - `` `code` `` → <code>
 *   - `**bold**` / `__bold__` → <strong>
 *   - `[text](url)` → <a href> (href sanitized)
 *
 * Block constructs (headings, lists, fenced blocks, tables) are deliberately NOT
 * handled — the scope is inline formatting inside a single grid cell.
 *
 * Self-contained on purpose: no markdown dependency is pulled into the frontend
 * bundle. Output is React nodes (never `dangerouslySetInnerHTML`), so link hrefs
 * are the only injection surface and they are scheme-checked below.
 */

import { createElement } from 'react';
import type { ReactNode } from 'react';

/** Schemes permitted on a rendered link. Anything else (javascript:, data:, …) is dropped. */
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * Return `url` if it is safe to place in an `href`, else `null`. A value with no
 * scheme (relative path, fragment, bare `example.com`) is allowed; a value with a
 * scheme is allowed only when the scheme is in {@link SAFE_SCHEMES}.
 */
function safeHref(url: string): string | null {
  const trimmed = url.trim();
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (scheme && !SAFE_SCHEMES.has(scheme[1].toLowerCase())) return null;
  return trimmed;
}

/**
 * Matches the NEXT inline token anywhere in the string. Alternation order encodes
 * precedence at a shared position: code span first (its body is literal), then
 * bold, then link. Non-global — we re-run it on the remaining tail each step.
 */
const TOKEN =
  /(`+)([^`]*?)\1|\*\*([^*]+?)\*\*|__([^_]+?)__|\[([^\]]*)\]\(([^)\s]*)\)/;

/**
 * Parse `text` into React nodes, rendering the inline-markdown subset. Bold and
 * link-text bodies are parsed recursively (so `**a `b`**` nests); a code span's
 * body is emitted literally. Returns a flat `ReactNode[]` suitable as element
 * children (each dynamic node gets a stable-within-call key).
 */
export function renderInlineMarkdown(text: string, keyPrefix = 'md'): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let offset = 0; // consumed chars, for stable keys
  let n = 0;

  while (rest.length > 0) {
    const m = TOKEN.exec(rest);
    if (!m || m.index === undefined) {
      nodes.push(rest);
      break;
    }

    // Literal text before the token.
    if (m.index > 0) nodes.push(rest.slice(0, m.index));

    const key = `${keyPrefix}-${offset + m.index}-${n++}`;

    if (m[1] !== undefined) {
      // `code` — body is literal, never re-parsed.
      nodes.push(createElement('code', { key }, m[2]));
    } else if (m[3] !== undefined || m[4] !== undefined) {
      // **bold** / __bold__
      const inner = (m[3] ?? m[4]) as string;
      nodes.push(createElement('strong', { key }, ...renderInlineMarkdown(inner, key)));
    } else {
      // [text](url)
      const label = m[5] ?? '';
      const href = safeHref(m[6] ?? '');
      const children = renderInlineMarkdown(label, key);
      if (href === null) {
        // Unsafe scheme: drop the link, keep the visible text.
        nodes.push(...children);
      } else {
        nodes.push(
          createElement(
            'a',
            { key, href, rel: 'noopener noreferrer', target: '_blank' },
            ...children,
          ),
        );
      }
    }

    const consumed = m.index + m[0].length;
    offset += consumed;
    rest = rest.slice(consumed);
  }

  return nodes;
}
