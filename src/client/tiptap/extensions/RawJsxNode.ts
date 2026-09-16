import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import {
  getDispatchAllowlist,
  isPassthroughTag,
  matchJsxTagOpen,
  findJsxSpanEnd,
} from '../../../shared/jsx-passthrough.js';
import { escapeRawAttr } from '../../../shared/raw-jsx-escape.js';
import { isRegisteredXmlTag } from './xmlNodes.js';
import { RawJsxView } from './views/RawJsxView.js';

/**
 * M20 — unknown `.mdx` JSX component tags (name ∉ dispatch allowlist) are
 * preserved BYTE-PERFECT in a dedicated raw code node rather than passed through
 * to tiptap-markdown (which would map/strip them). This reactivates the dormant
 * L8 contract `markdownIt = { kind: 'block_content' }` as the fallback for
 * unknown tags (its previous consumer, the content-bearing `<diagram>`, moved to
 * an entity in v0.1.64).
 *
 * Roundtrip mechanism: tiptap-markdown roundtrips through the DOM, not through
 * markdown-it tokens, so the verbatim bytes are smuggled in a `data-c4s-raw`
 * attribute (entity-escaped so the transported HTML is valid; the DOM decodes it
 * back on parse) and re-emitted by a custom serializer that writes them verbatim
 * — crucially WITHOUT a ``` fence, which would change the file and break MDX.
 *
 * Mapping: self-closing tags (anywhere) and mid-prose paired tags → inline node
 * (inline `<code>`); a paired `<Tag>…</Tag>` opening at line start and closing a
 * line → block node (code block).
 *
 * Two disjoint gates route a tag here (M20 `m20mdxjsx`, `ctx4prof` rule 6):
 *   1. `isPassthroughTag(name)` — component-shaped name ∉ dispatch allowlist
 *      (`<Callout/>`), in every context;
 *   2. name ∈ dispatch allowlist (or a plugin embed tag) but its node is NOT
 *      mounted in THIS context (`name ∉ spec.extensions`) — `<single_element/>`
 *      in an entity description, `<todo/>` in a plan, every reference tag in a
 *      brief or patch. Without this gate the XML rule of a sibling node turned
 *      the tag into HTML for a node type the schema does not have, and
 *      ProseMirror dropped it silently on the first save.
 * The context whitelist decides what RENDERS, not what SURVIVES a save: a tag
 * routed by gate 2 stays on disk byte for byte and remains a live reference for
 * the server-side M19 operations.
 *
 * The mounted set arrives through `options.mountedTags` (set by the registry
 * factory from `RegistryContext.contextSpec`); `null` means "everything
 * registered is mounted" — gate 2 is then inert, which is the pre-whitelist
 * behaviour and what `buildMarkdownIt` (read-only rendering) relies on.
 */

export interface RawJsxOptions {
  /** Names of the extensions mounted in this editor instance; `null` = gate 2 off. */
  mountedTags: readonly string[] | null;
}

export type RawTagPredicate = (name: string) => boolean;

/** Build the "route to raw node" predicate for one editor instance. */
export function rawTagPredicate(mountedTags: readonly string[] | null): RawTagPredicate {
  if (!mountedTags) return isPassthroughTag;
  const mounted = new Set(mountedTags);
  return (name) => {
    if (isPassthroughTag(name)) return true;
    if (mounted.has(name)) return false;
    return getDispatchAllowlist().has(name) || isRegisteredXmlTag(name);
  };
}

function emitInline(raw: string): string {
  return `<raw_jsx_inline data-c4s-raw="${escapeRawAttr(raw)}"></raw_jsx_inline>`;
}

function emitBlock(raw: string): string {
  return `<raw_jsx_block data-c4s-raw="${escapeRawAttr(raw)}"></raw_jsx_block>`;
}

export function setupRawJsxRules(md: any, isRaw: RawTagPredicate = isPassthroughTag): void {
  if (md.__claude4specRawJsxRules) return;
  md.__claude4specRawJsxRules = true;

  // BLOCK: a component tag that owns its line — a self-closing `<Name …/>` alone
  // on the line, or a paired `<Name …>…</Name>` opening at line start and closing
  // a line (depth-counting nested same-name pairs). Claimed here so it does not
  // fall through to stock `html_block` (which would drop the unknown element).
  // Mid-prose tags are left to the inline rule.
  md.block.ruler.before(
    'html_block',
    'raw_jsx_block',
    (state: any, startLine: number, endLine: number, silent: boolean) => {
      const pos = state.bMarks[startLine] + state.tShift[startLine];
      if (state.src.charCodeAt(pos) !== 0x3c /* < */) return false;
      const open = matchJsxTagOpen(state.src, pos);
      if (!open || !isRaw(open.name)) return false;

      // Self-closing alone on its own line → block raw node.
      if (open.selfClosing) {
        if (state.src.slice(open.openEnd, state.eMarks[startLine]).trim() !== '') return false;
        if (silent) return true;
        const token = state.push('html_block', '', 0);
        token.content = emitBlock(state.src.slice(pos, open.openEnd));
        token.map = [startLine, startLine + 1];
        state.line = startLine + 1;
        return true;
      }

      const spanEnd = findJsxSpanEnd(state.src, pos, open.name);
      if (spanEnd === -1) return false;

      // Locate the line the close tag ends on; require nothing but whitespace
      // after it (otherwise it's an inline-in-prose case → let the inline rule handle).
      let closeLine = startLine;
      for (let i = startLine; i < endLine; i++) {
        if (spanEnd - 1 >= state.bMarks[i] && spanEnd - 1 <= state.eMarks[i]) {
          closeLine = i;
          break;
        }
      }
      if (state.src.slice(spanEnd, state.eMarks[closeLine]).trim() !== '') return false;
      if (silent) return true;

      const token = state.push('html_block', '', 0);
      token.content = emitBlock(state.src.slice(pos, spanEnd));
      token.map = [startLine, closeLine + 1];
      state.line = closeLine + 1;
      return true;
    },
  );

  // INLINE: self-closing `<Name …/>` anywhere, or a paired `<Name …>…</Name>`
  // embedded in prose (the block rule already claimed own-line paired blocks).
  md.inline.ruler.before('html_inline', 'raw_jsx_inline', (state: any, silent: boolean) => {
    const pos = state.pos;
    if (state.src.charCodeAt(pos) !== 0x3c /* < */) return false;
    const open = matchJsxTagOpen(state.src, pos);
    if (!open || !isRaw(open.name)) return false;

    let end: number;
    if (open.selfClosing) {
      end = open.openEnd;
    } else {
      end = findJsxSpanEnd(state.src, pos, open.name);
      if (end === -1 || end > state.posMax) return false;
    }
    if (!silent) {
      const token = state.push('html_inline', '', 0);
      token.content = emitInline(state.src.slice(pos, end));
    }
    state.pos = end;
    return true;
  });
}

// `data-c4s-raw` is HTML-entity escaped on emit; the DOM decodes attribute
// entities, so `getAttribute` already returns the original bytes — no manual
// unescape here (that would double-decode any literal entity in the source).
function readRaw(dom: HTMLElement): string {
  return dom.getAttribute('data-c4s-raw') ?? '';
}

/**
 * tiptap-markdown invokes `parse.setup` as `setup.call({ editor, options }, md)`,
 * so the instance's `mountedTags` option is reachable as `this.options`.
 */
function setupFromOptions(this: { options?: Partial<RawJsxOptions> } | void, md: any): void {
  const mounted = (this && this.options && this.options.mountedTags) ?? null;
  setupRawJsxRules(md, rawTagPredicate(mounted));
}

export const RawJsxInlineNode = Node.create<RawJsxOptions>({
  name: 'raw_jsx_inline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() {
    return { mountedTags: null };
  },
  addAttributes() {
    return { raw: { default: '' } };
  },
  parseHTML() {
    return [
      {
        tag: 'raw_jsx_inline',
        getAttrs: (node) => ({ raw: readRaw(node as HTMLElement) }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['raw_jsx_inline', mergeAttributes(HTMLAttributes, { class: 'c4s-raw-jsx' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(RawJsxView);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(String(node.attrs.raw ?? ''));
        },
        parse: { setup: setupFromOptions },
      },
    };
  },
});

export const RawJsxBlockNode = Node.create<RawJsxOptions>({
  name: 'raw_jsx_block',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() {
    return { mountedTags: null };
  },
  addAttributes() {
    return { raw: { default: '' } };
  },
  parseHTML() {
    return [
      {
        tag: 'raw_jsx_block',
        getAttrs: (node) => ({ raw: readRaw(node as HTMLElement) }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['raw_jsx_block', mergeAttributes(HTMLAttributes, { class: 'c4s-raw-jsx' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(RawJsxView);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(String(node.attrs.raw ?? ''));
          state.closeBlock(node);
        },
        parse: { setup: setupFromOptions },
      },
    };
  },
});
