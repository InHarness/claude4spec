/**
 * Verbatim-attribute escaping for the raw JSX node (M20 — unknown `.mdx`
 * component tags). The original tag bytes are smuggled through the
 * `markdown → DOMParser → ProseMirror → markdown` pipeline inside a
 * `data-c4s-raw="…"` attribute, so they must survive HTML attribute-value
 * normalization byte-for-byte.
 *
 * Newline encoding (`&#10;`/`&#13;`) is load-bearing: DOMParser collapses raw
 * CR/LF/tab in attribute values to spaces, so multi-line paired bodies would be
 * mangled without it. `&` is escaped first (and unescaped last) to avoid
 * double-encoding. This is the scheme used by the former content-bearing
 * diagram node (`diagram-source-escape.ts`, removed in v0.1.64).
 */
export function escapeRawAttr(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function unescapeRawAttr(escaped: string): string {
  return escaped
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&#13;/g, '\r')
    .replace(/&#10;/g, '\n')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}
