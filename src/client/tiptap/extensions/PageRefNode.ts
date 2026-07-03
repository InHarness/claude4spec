import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { PageRefView } from './views/PageRefView.js';
import { resolveAgainstIndex } from '../lib/pathResolve.js';

export type PageRefSyntax = 'at' | 'backticks' | 'link';

// Path segment — letters, digits, underscore, dot, slash, hyphen. Starts with word char.
const PATH_BODY = String.raw`[\w][\w/.-]*?`;
const PATH_WITH_EXT_RE = new RegExp(`^(${PATH_BODY}\\.\\w+)(?:#([a-f0-9]{8}))?$`);
// Inline @-trigger: match after verifying lookbehind manually in rule. Terminates at whitespace, sentence/quote punctuation, or string end.
const AT_PAYLOAD_RE = new RegExp(`^(${PATH_BODY})(?:#([a-f0-9]{8}))?(?=[\\s.,;:!?)\\]}"']|$)`);
// Link href: optional ../ ./ prefix, then path with extension.
const LINK_PATH_RE = new RegExp(`^(?:\\.{1,2}/)*${PATH_BODY}\\.\\w+$`);

function isWordCodePoint(c: number): boolean {
  return (
    (c >= 0x30 && c <= 0x39) || // 0-9
    (c >= 0x41 && c <= 0x5a) || // A-Z
    (c >= 0x61 && c <= 0x7a) || // a-z
    c === 0x5f // _
  );
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function buildHtmlInline(
  attrs: { syntax: PageRefSyntax; path: string; anchor?: string; label?: string },
): string {
  const parts = [
    'data-page-ref="true"',
    `data-syntax="${attrs.syntax}"`,
    `data-path="${escapeAttr(attrs.path)}"`,
  ];
  if (attrs.anchor) parts.push(`data-anchor="${escapeAttr(attrs.anchor)}"`);
  if (attrs.label) parts.push(`data-label="${escapeAttr(attrs.label)}"`);
  return `<page_ref ${parts.join(' ')}></page_ref>`;
}

function resolvesInIndex(
  index: ReadonlyMap<string, unknown> | undefined,
  path: string,
  sourcePath?: string,
  dir?: string,
): boolean {
  if (!index) return false;
  return resolveAgainstIndex(path, index, sourcePath, dir) !== null;
}

/**
 * Register the three markdown-it rules that produce `<page_ref/>` tokens:
 *   1. inline @-trigger (`@path[#anchor]`) — always emits; View falls back to plain on miss.
 *   2. code_inline post-processor (`` `path.ext[#anchor]` ``) — only converts on index hit.
 *   3. link post-processor (`[label](path)`) — only converts on index hit for relative targets.
 *
 * The pagesIndex is read from `md.__c4sPagesIndex` at rule execution time so that
 * tiptap-markdown (which reuses a single markdown-it instance per editor) can
 * refresh the index without re-registering rules.
 */
export function setupPageRefRules(md: any): void {
  if (md.__c4sPageRefRules) return;
  md.__c4sPageRefRules = true;

  md.inline.ruler.before('emphasis', 'inline_page_ref', (state: any, silent: boolean) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x40 /* @ */) return false;
    if (start > 0 && isWordCodePoint(state.src.charCodeAt(start - 1))) return false;
    const match = AT_PAYLOAD_RE.exec(state.src.slice(start + 1));
    if (!match) return false;
    if (!silent) {
      const token = state.push('html_inline', '', 0);
      token.content = buildHtmlInline({
        syntax: 'at',
        path: match[1]!,
        anchor: match[2],
      });
    }
    state.pos += 1 + match[0].length;
    return true;
  });

  md.core.ruler.after('inline', 'page_ref_code_postprocess', (state: any) => {
    const index = state.md.__c4sPagesIndex as ReadonlyMap<string, unknown> | undefined;
    if (!index) return;
    const sourcePath = state.md.__c4sPageRefSourcePath as string | undefined;
    const dir = state.md.__c4sPageRefDir as string | undefined;
    const Token = state.Token;
    for (const block of state.tokens) {
      if (!block.children) continue;
      for (let i = 0; i < block.children.length; i++) {
        const tok = block.children[i];
        if (tok.type !== 'code_inline') continue;
        const m = PATH_WITH_EXT_RE.exec(tok.content);
        if (!m) continue;
        const path = m[1]!;
        const anchor = m[2];
        if (!resolvesInIndex(index, path, sourcePath, dir)) continue;
        const replacement = new Token('html_inline', '', 0);
        replacement.content = buildHtmlInline({ syntax: 'backticks', path, anchor });
        block.children[i] = replacement;
      }
    }
  });

  md.core.ruler.after('inline', 'page_ref_link_postprocess', (state: any) => {
    const index = state.md.__c4sPagesIndex as ReadonlyMap<string, unknown> | undefined;
    if (!index) return;
    const sourcePath = state.md.__c4sPageRefSourcePath as string | undefined;
    const dir = state.md.__c4sPageRefDir as string | undefined;
    const Token = state.Token;
    for (const block of state.tokens) {
      if (!block.children) continue;
      const children = block.children;
      for (let i = 0; i < children.length; i++) {
        if (children[i].type !== 'link_open') continue;
        const href = children[i].attrGet?.('href') ?? '';
        if (!href || /^[a-z]+:/i.test(href) || href.startsWith('#') || href.startsWith('/')) continue;
        const [pathPart, anchorPart] = href.split('#', 2);
        if (!pathPart || !LINK_PATH_RE.test(pathPart)) continue;
        const anchor = anchorPart && /^[a-f0-9]{8}$/.test(anchorPart) ? anchorPart : undefined;
        if (!resolvesInIndex(index, pathPart, sourcePath, dir)) continue;
        let j = i + 1;
        let label = '';
        while (j < children.length && children[j].type !== 'link_close') {
          if (children[j].type === 'text') label += children[j].content;
          j++;
        }
        if (j >= children.length) continue;
        const replacement = new Token('html_inline', '', 0);
        replacement.content = buildHtmlInline({
          syntax: 'link',
          path: pathPart,
          anchor,
          label: label || undefined,
        });
        children.splice(i, j - i + 1, replacement);
      }
    }
  });
}

export const PageRefNode = Node.create({
  name: 'page_ref',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      syntax: { default: 'at' },
      path: { default: '' },
      anchor: { default: '' },
      label: { default: '' },
    };
  },
  parseHTML() {
    const getAttrs = (node: HTMLElement) => ({
      syntax: node.getAttribute('data-syntax') ?? 'at',
      path: node.getAttribute('data-path') ?? '',
      anchor: node.getAttribute('data-anchor') ?? '',
      label: node.getAttribute('data-label') ?? '',
    });
    return [
      { tag: 'page_ref', getAttrs },
      { tag: 'span[data-page-ref]', getAttrs },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-page-ref': 'true' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageRefView);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const syntax = (node.attrs.syntax as PageRefSyntax) || 'at';
          const path = String(node.attrs.path ?? '');
          const anchor = String(node.attrs.anchor ?? '');
          const label = String(node.attrs.label ?? '');
          const suffix = anchor ? `#${anchor}` : '';
          switch (syntax) {
            case 'at':
              state.write(`@${path}${suffix}`);
              return;
            case 'backticks':
              state.write('`' + path + suffix + '`');
              return;
            case 'link': {
              const text = label || path;
              state.write(`[${text}](${path}${suffix})`);
              return;
            }
          }
        },
        parse: {
          setup(md: any) {
            setupPageRefRules(md);
            // Attach (or refresh) the pagesIndex + source path so the post-processors
            // can resolve hits relative to the current document.
            // `this` is { editor, options } per tiptap-markdown MarkdownParser.
            const editor = (this as { editor?: { storage?: Record<string, unknown> } }).editor;
            const index = editor?.storage?.pagesIndex;
            if (index) md.__c4sPagesIndex = index;
            const sourcePath = editor?.storage?.pageRefSourcePath;
            if (typeof sourcePath === 'string') md.__c4sPageRefSourcePath = sourcePath;
            else delete md.__c4sPageRefSourcePath;
            // 0.1.100: current root's dir feeds the resolver's CWD-relative fallback.
            const dir = editor?.storage?.pageRefDir;
            if (typeof dir === 'string') md.__c4sPageRefDir = dir;
            else delete md.__c4sPageRefDir;
          },
        },
      },
    };
  },
});
