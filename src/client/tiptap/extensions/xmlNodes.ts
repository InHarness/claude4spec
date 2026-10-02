import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { serializeXmlTag } from '../../../shared/xml-tags.js';
import { maskTagAttributeValues } from '../../../shared/code-ranges.js';
import { getXmlTag, listXmlTags } from '../../../shared/xml-markup/registry.js';
import { registeredTagRegexAnchored } from '../../../shared/xml-markup/pattern.js';
import { XmlTagView } from './views/XmlTagView.js';
import { provideXmlTagNodes } from '../registry.js';

/**
 * M20 — editor nodes built FROM THE M51 REGISTRY. The editor materialises one
 * node for every registered tag name, of one of two generic kinds picked by
 * the tag's `form`:
 *  - an inline tag node — markdown-it rule `xml_inline`, for `inline` names;
 *  - a block tag node — markdown-it rule `xml_block`, for `block` names.
 * The node view shows the component the owning module assigned to the name
 * (`client/xml-markup/renders.ts`). No module registers a node or a parser
 * rule for its tag, and no list of names is written down here: names and the
 * attribute pattern both come from the registry (`shared/xml-markup/pattern.ts`),
 * the same pattern the server parser uses — so the same text yields the same
 * set of recognised tags on both sides, including the whitespace rule
 * (`<name />` is a tag, `<name/>` is not).
 *
 * markdown-it's default HTML rules only accept tag names matching
 * [A-Za-z][A-Za-z0-9\-]* — which rejects underscore names (`inline_mention`,
 * `tagged_list_mixed`, …). And HTML does NOT treat `<foo/>` as self-closing for
 * custom tags. So these rules emit the tags as PAIRED elements
 * (`<foo attr="…"></foo>`), which the DOM parser reads as empty elements.
 */

function toPairedHtml(kind: string, attrs: string | undefined): string {
  const attrPart = (attrs ?? '').trim();
  return `<${kind}${attrPart ? ` ${attrPart}` : ''}></${kind}>`;
}

/** A registered tag matching at the start of `text`, or null. */
export function matchXmlTagAt(text: string): RegExpExecArray | null {
  return registeredTagRegexAnchored()?.exec(text) ?? null;
}

// These rules cover EVERY registered name at once, whichever node installed
// them. In a context whose whitelist leaves a tag's node out, the tag must never
// reach here: `RawJsxNode` registers its rules first (lower priority ⇒ earlier
// setup ⇒ earlier in the ruler chain) and routes every registered-but-unmounted
// name to the raw node, which is why it is mounted in every context.
function setupXmlMarkdownRules(md: any) {
  if (md.__claude4specXmlRules) return;
  md.__claude4specXmlRules = true;

  md.block.ruler.before(
    'html_block',
    'xml_block',
    (state: any, startLine: number, endLine: number, silent: boolean) => {
      const pos = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      const line = state.src.slice(pos, max);
      const match = matchXmlTagAt(line);
      if (!match) return false;
      if (getXmlTag(match[1]!)?.form !== 'block') {
        // An INLINE tag opening a line is prose: it belongs to a paragraph,
        // where `xml_inline` turns it into its node. Without this, a name
        // markdown-it accepts as an HTML tag (`todo` has no underscore) alone
        // on its line would be taken by `html_block` as raw HTML — unpaired —
        // and the DOM would nest what follows inside it. Never a terminator.
        if (silent) return false;
        return paragraphRule(state)(state, startLine, endLine, false);
      }
      if (line.slice(match[0].length).trim() !== '') return false;
      if (silent) return true;
      const token = state.push('html_block', '', 0);
      token.content = toPairedHtml(match[1]!, match[2]);
      token.map = [startLine, startLine + 1];
      state.line = startLine + 1;
      return true;
    },
  );

  // A backtick inside a tag's attribute value is not an inline-code delimiter.
  // Ordering alone is not enough: `backticks` fires at an EARLIER lone backtick
  // and pairs it with the one in `caption`, eating half the tag. So in front of
  // `backticks` sits a guard that looks for the closing run on the text with
  // attribute values masked — the same gate the server scanner uses. It scans
  // forward from the run the parser actually reached (like the stock rule), so
  // backticks consumed earlier by `escape` or a link URL never become openers.
  // It steps in only when masking changes the paragraph.
  md.inline.ruler.before('backticks', 'xml_backticks_guard', (state: any, silent: boolean) => {
    if (state.src.charCodeAt(state.pos) !== 0x60 /* ` */) return false;
    const masked = maskedSrc(state);
    if (masked === null) return false;
    const start = state.pos;
    let runEnd = start;
    while (masked.charCodeAt(runEnd) === 0x60) runEnd++;
    const len = runEnd - start;
    const closer = findClosingRun(masked, runEnd, len);
    if (closer < 0) {
      if (!silent) state.pending += state.src.slice(start, runEnd);
      state.pos = runEnd;
      return true;
    }
    if (!silent) {
      const token = state.push('code_inline', 'code', 0);
      token.markup = state.src.slice(start, runEnd);
      let content = state.src.slice(runEnd, closer).replace(/\n/g, ' ');
      if (content.length > 2 && content.startsWith(' ') && content.endsWith(' ') && /[^ ]/.test(content)) {
        content = content.slice(1, -1);
      }
      token.content = content;
    }
    state.pos = closer + len;
    return true;
  });

  // `xml_inline` stays in front of `html_inline`, AFTER `raw_jsx_inline`: moving
  // it up to `backticks` would put it ahead of the raw-JSX context gate and
  // render unmounted tags as chips. Every registered name is recognised here —
  // a `block` tag written mid-prose too — so recognition never depends on the
  // position in the line, exactly like the server parser.
  md.inline.ruler.before('html_inline', 'xml_inline', (state: any, silent: boolean) => {
    if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
    const match = matchXmlTagAt(state.src.slice(state.pos));
    if (!match) return false;
    if (!silent) {
      const token = state.push('html_inline', '', 0);
      token.content = toPairedHtml(match[1]!, match[2]);
    }
    state.pos += match[0].length;
    return true;
  });
}

/** markdown-it's own `paragraph` block rule. */
function paragraphRule(state: any): (state: any, start: number, end: number, silent: boolean) => boolean {
  const rule = state.md.block.ruler.__rules__.find((r: { name: string }) => r.name === 'paragraph');
  return rule.fn;
}

/** The paragraph with tag attribute values masked; null when masking is a no-op. */
function maskedSrc(state: any): string | null {
  if (state.__c4sMaskedSrcFor === state.src) return state.__c4sMaskedSrc;
  const src: string = state.src;
  const masked = maskTagAttributeValues(src, [[0, src.length]]);
  state.__c4sMaskedSrcFor = src;
  state.__c4sMaskedSrc = masked === src ? null : masked;
  return state.__c4sMaskedSrc;
}

/** Offset of the next backtick run of exactly `len` at or after `from`, or -1. */
function findClosingRun(text: string, from: number, len: number): number {
  const re = /`+/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) if (m[0].length === len) return m.index;
  return -1;
}

function pickAttrs(dom: HTMLElement, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = dom.getAttribute(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

const nodeCache = new Map<string, Node>();

/**
 * The editor node of one registered tag. Every attribute in the tag's
 * attribute order defaults to `null` — absent — and only a present one is
 * written back, so a tag round-trips byte-for-byte: no `caption=""` appears on
 * a tag written without one, and `<todo comment=""/>` keeps its empty comment.
 */
export function xmlTagNode(name: string): Node {
  const cached = nodeCache.get(name);
  if (cached) return cached;
  const def = getXmlTag(name);
  if (!def) throw new Error(`No editor node for "${name}" — it is not a registered XML tag`);
  const inline = def.form === 'inline';
  const node = Node.create({
    name,
    group: inline ? 'inline' : 'block',
    inline,
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return Object.fromEntries(def.attrOrder.map((a) => [a, { default: null }]));
    },
    parseHTML() {
      return [{ tag: name, getAttrs: (dom) => pickAttrs(dom as HTMLElement, def.attrOrder) }];
    },
    renderHTML({ HTMLAttributes }) {
      return [name, mergeAttributes(HTMLAttributes)];
    },
    addNodeView() {
      return ReactNodeViewRenderer(XmlTagView);
    },
    addStorage() {
      return {
        markdown: {
          serialize(state: any, n: any) {
            state.write(serializeXmlTag(name, n.attrs));
            if (!inline) state.closeBlock(n);
          },
          parse: { setup: setupXmlMarkdownRules },
        },
      };
    },
  });
  nodeCache.set(name, node);
  return node;
}

/** Nodes of the registered tags among `names` (a context's whitelist), in registry order. */
export function xmlTagNodesFor(names: readonly string[]): Node[] {
  const allowed = new Set(names);
  return listXmlTags()
    .filter((t) => allowed.has(t.name))
    .map((t) => xmlTagNode(t.name));
}

provideXmlTagNodes(xmlTagNodesFor);

export { setupXmlMarkdownRules };
