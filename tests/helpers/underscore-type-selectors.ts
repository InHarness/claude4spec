/**
 * happy-dom's selector parser rejects element names with an underscore
 * (`raw_jsx_inline`, `inline_mention`, … — valid CSS type selectors a browser
 * accepts), and both `tiptap-markdown` (`normalizeBlocks`: one
 * `querySelectorAll` over every block node's `parseDOM` tag) and ProseMirror's
 * `DOMParser` (`matches(dom, rule.tag)`) build selectors from those names.
 * `withUnderscoreTypeSelectors` gives `Element.prototype.matches` /
 * `querySelectorAll` the browser's answer for a bare type selector with an
 * underscore (tag name equality) and hands every other selector to happy-dom
 * unchanged — the editor itself runs as is. Returns the restore function.
 */

/** A bare type selector happy-dom cannot parse: an element name with an underscore. */
const UNDERSCORE_TYPE = /^[a-zA-Z][\w-]*_[\w-]*$/;

/** Split a selector list on its top-level commas (none inside `[...]`, `(...)` or quotes). */
function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of selector) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}

export function withUnderscoreTypeSelectors(): () => void {
  const proto = Element.prototype;
  const nativeMatches = proto.matches;
  const nativeQueryAll = proto.querySelectorAll;
  const needsShim = (selector: string) => splitSelectorList(selector).some((p) => UNDERSCORE_TYPE.test(p));
  function matches(this: Element, selector: string): boolean {
    if (!needsShim(selector)) return nativeMatches.call(this, selector);
    return splitSelectorList(selector).some((part) =>
      UNDERSCORE_TYPE.test(part)
        ? this.tagName.toLowerCase() === part.toLowerCase()
        : nativeMatches.call(this, part),
    );
  }
  function querySelectorAll(this: Element, selector: string) {
    if (!needsShim(selector)) return nativeQueryAll.call(this, selector);
    // Every descendant in document order, kept when it matches the list.
    return Array.from(nativeQueryAll.call(this, '*')).filter((el) => matches.call(el, selector));
  }
  proto.matches = matches;
  (proto as { querySelectorAll: unknown }).querySelectorAll = querySelectorAll;
  return () => {
    proto.matches = nativeMatches;
    proto.querySelectorAll = nativeQueryAll;
  };
}
