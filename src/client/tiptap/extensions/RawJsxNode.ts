import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import {
  JSX_BLOCK_RULE_NAME,
  findJsxSpanEnd,
  isPassthroughTag,
  jsxBlockRule,
  matchJsxTagOpen,
} from '../../../shared/jsx-passthrough.js';
import { isRegisteredXmlTag } from '../../../shared/xml-markup/registry.js';
import { escapeRawAttr } from '../../../shared/raw-jsx-escape.js';
import { matchXmlTagAt } from './xmlNodes.js';
import { RawJsxView } from './views/RawJsxView.js';

/**
 * M20 — unknown JSX component tags (name outside the M51 registry), in EVERY
 * markdown content of the editor — `.md`, `.mdx`, entity descriptions, plans —
 * not only `.mdx` (`m20mdxjsx`), are preserved BYTE-PERFECT in a dedicated raw
 * code node rather than passed through to tiptap-markdown (which would
 * map/strip them). The L8 contract `markdownIt = { kind: 'block_content' }` is
 * the fallback for unknown tags.
 *
 * Roundtrip mechanism: tiptap-markdown roundtrips through the DOM, not through
 * markdown-it tokens, so the verbatim bytes are smuggled in a `data-c4s-raw`
 * attribute (entity-escaped so the transported HTML is valid; the DOM decodes it
 * back on parse) and re-emitted by a custom serializer that writes them verbatim
 * — crucially WITHOUT a ``` fence, which would change the file and break MDX.
 *
 * Two parser rules (`wry28ibe`):
 *  - BLOCK — M51's block rule of a JSX region (`jsxBlockRule`, shared with the
 *    server scanner, nesting counted by name in the same container) → block
 *    node with the region's bytes;
 *  - INLINE — in front of `backticks` (`lb9dq0ed`), closing searched only in
 *    the current inline block → inline node: a self-closing tag, a pair with
 *    its inner text, or — for an unpaired tag and each half of a pair split by
 *    an inline-block, table-cell or container boundary — the tag alone, the
 *    rest of the paragraph staying markdown with live chips (M51 `c1m5maz3`).
 * A tag quoted in inline code is code, never a raw node.
 *
 * Three disjoint gates route a tag here (M20 `m20mdxjsx`, `ctx4prof` rule 6):
 *   1. `isPassthroughTag(name)` — component-shaped name outside the registry
 *      (`<Callout/>`), in every context;
 *   2. a registered XML tag whose node is NOT mounted in THIS context
 *      (`name ∉ spec.extensions`) — `<single_element/>` in an entity
 *      description, `<todo/>` in a plan, every reference tag in a brief or
 *      patch. Without this gate the XML rule of a sibling node turned the tag
 *      into HTML for a node type the schema does not have, and ProseMirror
 *      dropped it silently on the first save;
 *   3. 2.1.2 (M51) — a registered name written in a shape the shared tag
 *      pattern does not recognise (`<todo/>` — no whitespace after the name).
 *      The server parser does not see it as a tag either, so the editor must
 *      not turn it into a node through the stock HTML rules: it stays verbatim.
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
    return isRegisteredXmlTag(name);
  };
}

function emitInline(raw: string): string {
  return `<raw_jsx_inline data-c4s-raw="${escapeRawAttr(raw)}"></raw_jsx_inline>`;
}

function emitBlock(raw: string): string {
  return `<raw_jsx_block data-c4s-raw="${escapeRawAttr(raw)}"></raw_jsx_block>`;
}

/** Gate 3: a registered name at `pos` that the shared tag pattern does not match. */
function isUnrecognisedTagShape(src: string, pos: number, name: string): boolean {
  return isRegisteredXmlTag(name) && matchXmlTagAt(src.slice(pos)) === null;
}

/** A closing tag `</Name>` anchored at the start of `text`. */
const CLOSE_AT_START_RE = /^<\/([A-Za-z][\w.-]*)\s*>/;

/** markdown-it's own `paragraph` block rule of the parser `state` belongs to. */
function paragraphRule(state: any): (state: any, start: number, end: number, silent: boolean) => boolean {
  const rule = state.md.block.ruler.__rules__.find((r: { name: string }) => r.name === 'paragraph');
  return rule.fn;
}

/** Block rule name: an unpaired raw tag opening a line starts a paragraph. */
export const RAW_JSX_LINE_RULE_NAME = 'raw_jsx_line';
/** Inline rule name: the raw JSX rule in front of `backticks` (M20 `lb9dq0ed`). */
export const RAW_JSX_INLINE_RULE_NAME = 'raw_jsx_inline';

export function setupRawJsxRules(md: any, isRaw: RawTagPredicate = isPassthroughTag): void {
  if (md.__claude4specRawJsxRules) return;
  md.__claude4specRawJsxRules = true;

  /** Does the opening tag named `name` at `pos` go to the raw node (gates 1–3)? */
  const acceptsOpen = (name: string, src: string, pos: number): boolean =>
    isRaw(name) || isUnrecognisedTagShape(src, pos, name);

  // BLOCK: M51's block rule of a JSX region (`61f2qnb2`), the SAME rule the
  // server scanner's tokenizer runs (`sjjkc8bt`) — a self-closing tag alone on
  // its line, or a pair opening a line and closed in the same container with
  // nothing after the closing tag. Only what the region becomes is the
  // editor's: a block raw node with the region's exact bytes.
  md.block.ruler.before(
    'html_block',
    JSX_BLOCK_RULE_NAME,
    jsxBlockRule({ accepts: acceptsOpen, emit: emitBlock }),
  );

  // An opening the block rule declined (unpaired, or its pair split by a
  // container boundary) and a lone closing tag opening a line are prose: they
  // start a paragraph, where the inline rule turns the tag alone into a raw
  // node and the rest of the paragraph stays markdown with live chips (M51
  // `c1m5maz3`). Without this, markdown-it's `html_block` would take the line
  // up to the next blank one as raw HTML, and the unknown element — with the
  // tags after it — would be dropped by the DOM step. Never a terminator: in
  // no `alt` chain, so it does not interrupt a paragraph.
  md.block.ruler.before('html_block', RAW_JSX_LINE_RULE_NAME, (state: any, startLine: number, endLine: number, silent: boolean) => {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const src: string = state.src;
    const pos: number = state.bMarks[startLine] + state.tShift[startLine];
    if (src.charCodeAt(pos) !== 0x3c /* < */) return false;
    const line = src.slice(pos, state.eMarks[startLine]);
    const close = CLOSE_AT_START_RE.exec(line);
    const open = close ? null : matchJsxTagOpen(src, pos);
    if (close ? !isRaw(close[1]!) : !open || !acceptsOpen(open.name, src, pos)) return false;
    if (silent) return false;
    return paragraphRule(state)(state, startLine, endLine, false);
  });

  // INLINE: in front of `backticks` (M20 `lb9dq0ed`): between inline code and
  // a tag the construct that starts earlier wins — a tag quoted in inline code
  // is code (`backticks` took it at its earlier backtick), and a backtick after
  // a tag's `<` opens no code. Closing is searched only in the current inline
  // block (M51 `5wf420mr`): `state.src` is that block's text.
  //  - a self-closing `<Name …/>` anywhere → raw node of the tag;
  //  - a pair `<Name …>…</Name>` closed in this inline block → raw node of the region;
  //  - an unpaired opening (no close in this inline block — also one half of a
  //    pair split by an inline-block, table-cell or container boundary) → raw
  //    node of the tag alone; the rest stays markdown (M51 `c1m5maz3`);
  //  - a lone closing `</Name>` (the other half) → raw node of the tag alone.
  md.inline.ruler.before('backticks', RAW_JSX_INLINE_RULE_NAME, (state: any, silent: boolean) => {
    const pos = state.pos;
    const src: string = state.src;
    if (src.charCodeAt(pos) !== 0x3c /* < */) return false;

    let end: number;
    const open = matchJsxTagOpen(src, pos);
    if (open) {
      if (!acceptsOpen(open.name, src, pos) || open.openEnd > state.posMax) return false;
      if (open.selfClosing) {
        end = open.openEnd;
      } else {
        const spanEnd = findJsxSpanEnd(src, pos, open.name, [], state.posMax);
        end = spanEnd === -1 ? open.openEnd : spanEnd;
      }
    } else {
      const close = CLOSE_AT_START_RE.exec(src.slice(pos, state.posMax));
      if (!close || !isRaw(close[1]!)) return false;
      end = pos + close[0].length;
    }
    if (!silent) {
      const token = state.push('html_inline', '', 0);
      token.content = emitInline(src.slice(pos, end));
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
  // The node's text is its raw bytes. tiptap-markdown's table serializer
  // writes a cell only when its `textContent` is not blank — without this a
  // cell holding nothing but a raw tag (`| <Callout> | </Callout> |`) would be
  // saved empty.
  extendNodeSchema() {
    return { leafText: (node: { attrs: Record<string, unknown> }) => String(node.attrs.raw ?? '') };
  },
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
