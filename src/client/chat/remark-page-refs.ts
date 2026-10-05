import { ANCHOR_ID_SOURCE } from '../../shared/anchor-pattern.js';
import type { PageLinkSyntax } from '../../shared/page-links.js';
import { AT_PAYLOAD_RE, LINK_PATH_RE, PATH_WITH_EXT_RE, isWordCodePoint } from '../tiptap/extensions/PageRefNode.js';
import { resolveAgainstIndex, type PathIndex } from '../tiptap/lib/pathResolve.js';

/**
 * 2.1.7 (M05/M14) — page references in a USER chat message, now that the
 * message renders through `<ChatMarkdown />` like every other chat text.
 *
 * The same three rules the editor's markdown-it pipeline applies
 * (`PageRefNode.setupPageRefRules`), over react-markdown's syntax tree:
 *  1. `@path[#anchor]` in prose — always a chip (unresolved → broken chip);
 *  2. `` `path.ext[#anchor]` `` — a chip only when the path resolves;
 *  3. `[label](path)` with a relative target — a chip only when it resolves.
 * A match becomes a link whose href carries the reference
 * ({@link PAGE_REF_HREF_PREFIX}); `ChatMarkdown`'s `a` override renders it as
 * a `PageRefChip`, the way XML chips ride on `CHIP_HREF_PREFIX`.
 *
 * `breaks` mirrors the old renderer: a newline in a user message is a line
 * break, not a space.
 */
export const PAGE_REF_HREF_PREFIX = '#__c4s_page_ref__';

export interface PageRefPayload {
  syntax: PageLinkSyntax;
  path: string;
  anchor?: string;
  label?: string;
}

export function encodePageRef(ref: PageRefPayload): string {
  return PAGE_REF_HREF_PREFIX + encodeURIComponent(JSON.stringify(ref));
}

export function decodePageRef(href: string): PageRefPayload | null {
  if (!href.startsWith(PAGE_REF_HREF_PREFIX)) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(href.slice(PAGE_REF_HREF_PREFIX.length))) as PageRefPayload;
    return parsed && typeof parsed.path === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

const ANCHOR_ONLY_RE = new RegExp(`^${ANCHOR_ID_SOURCE}$`);

function refLink(ref: PageRefPayload, text: string): MdNode {
  return { type: 'link', url: encodePageRef(ref), children: [{ type: 'text', value: text }] };
}

function textToNodes(value: string, breaks: boolean): MdNode[] {
  const out: MdNode[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ type: 'text', value: buf });
    buf = '';
  };
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === '\n' && breaks) {
      flush();
      out.push({ type: 'break' });
      continue;
    }
    if (c === '@' && (i === 0 || !isWordCodePoint(value.charCodeAt(i - 1)))) {
      const m = AT_PAYLOAD_RE.exec(value.slice(i + 1));
      if (m) {
        flush();
        out.push(refLink({ syntax: 'at', path: m[1]!, ...(m[2] ? { anchor: m[2] } : {}) }, `@${m[0]}`));
        i += m[0].length;
        continue;
      }
    }
    buf += c;
  }
  flush();
  return out;
}

function textOf(node: MdNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

function transform(node: MdNode, index: PathIndex | undefined, breaks: boolean): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text') {
      next.push(...textToNodes(child.value ?? '', breaks));
      continue;
    }
    if (child.type === 'inlineCode' && index) {
      const m = PATH_WITH_EXT_RE.exec(child.value ?? '');
      if (m && resolveAgainstIndex(m[1]!, index) !== null) {
        next.push(refLink({ syntax: 'backticks', path: m[1]!, ...(m[2] ? { anchor: m[2] } : {}) }, child.value ?? ''));
        continue;
      }
    }
    if (child.type === 'link') {
      const href = child.url ?? '';
      const [pathPart, anchorPart] = href.split('#', 2);
      const relative = !!href && !/^[a-z]+:/i.test(href) && !href.startsWith('#') && !href.startsWith('/');
      if (index && relative && pathPart && LINK_PATH_RE.test(pathPart) && resolveAgainstIndex(pathPart, index) !== null) {
        const label = textOf(child);
        next.push({
          ...child,
          url: encodePageRef({
            syntax: 'link',
            path: pathPart,
            ...(anchorPart && ANCHOR_ONLY_RE.test(anchorPart) ? { anchor: anchorPart } : {}),
            ...(label ? { label } : {}),
          }),
        });
        continue;
      }
      // Any other link keeps its children as they are — no refs inside a link.
      next.push(child);
      continue;
    }
    if (child.type !== 'inlineCode' && child.type !== 'code') transform(child, index, breaks);
    next.push(child);
  }
  node.children = next;
}

/** The remark plugin: `[remarkPageRefs, { index, breaks }]`. */
export function remarkPageRefs(options: { index?: PathIndex; breaks?: boolean } = {}) {
  return (tree: MdNode) => transform(tree, options.index, options.breaks ?? true);
}
