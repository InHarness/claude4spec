import MarkdownIt from 'markdown-it';
import { setupXmlMarkdownRules } from '../extensions/xmlNodes.js';
import { setupAnchorMarkerRule } from '../extensions/AnchorMarker.js';
import { setupPageRefRules } from '../extensions/PageRefNode.js';
import { rawTagPredicate, setupRawJsxRules } from '../extensions/RawJsxNode.js';
import { getContextSpec, type EditorContextId } from '../registry.js';
import type { FileMeta } from '../../../shared/page-links.js';

export interface BuildMarkdownItOptions {
  /** Case-sensitive map of root-relative paths to FileMeta. Used by code_inline and link post-processors. */
  pagesIndex?: ReadonlyMap<string, FileMeta>;
  /** Tweak the markdown-it constructor options (defaults match tiptap-markdown). */
  html?: boolean;
  breaks?: boolean;
  linkify?: boolean;
  /**
   * 2.1.8: the editor context to parse as (`page` = a `kind: pages` root's
   * layers, `artifact` = brief / patch). When omitted, all rule setups run
   * (read-only rendering). When provided, the rules follow the context's
   * whitelist: a tag the context mounts no node for round-trips as raw text
   * rather than being promoted to a node with no matching editor schema, and
   * anchor comments become markers only where `anchor_marker` is mounted.
   */
  context?: EditorContextId;
}

/**
 * Centralized markdown-it factory. Applies all custom rule setups from the editor
 * extension registry plus M14 PageRef rules. Shared by tiptap-markdown (through
 * extension `parse.setup` hooks). Chat messages use react-markdown (`ChatMarkdown`),
 * with the same page-ref grammar re-applied by `chat/remark-page-refs.ts`.
 *
 * pagesIndex can also be updated in-place on an already-built instance by assigning
 * to `md.__c4sPagesIndex` — rules dereference it at execution time.
 */
export function buildMarkdownIt(options: BuildMarkdownItOptions = {}): MarkdownIt {
  const md = new MarkdownIt({
    html: options.html ?? true,
    breaks: options.breaks ?? false,
    linkify: options.linkify ?? false,
  });
  // Gate rule setups on the context's whitelist. No context = every rule
  // (read-only rendering). The XML tag rules recognise every registered name
  // (M51); a tag the context gates out (an entity tag or `section_ref` in
  // `artifact`) is routed to the raw node by the raw-JSX rules, which run
  // first — it round-trips as text instead of becoming a node with no
  // matching editor schema.
  const mounted = options.context ? getContextSpec(options.context).extensions : null;
  setupRawJsxRules(md, rawTagPredicate(mounted)); // raw mdx JSX + gated / malformed tags — base
  setupXmlMarkdownRules(md); // every registered XML tag (M51)
  if (!mounted || mounted.includes('anchor_marker')) setupAnchorMarkerRule(md); // anchors (kind's anchor layer)
  setupPageRefRules(md); // @path.md links — base
  if (options.pagesIndex) {
    (md as unknown as { __c4sPagesIndex: ReadonlyMap<string, FileMeta> }).__c4sPagesIndex =
      options.pagesIndex;
  }
  return md;
}

/**
 * Update the pagesIndex attached to an already-built markdown-it instance.
 * The post-processor rules read the index at execution time, so subsequent
 * `md.render(...)` calls will use the new index without re-creating rules.
 */
export function setPagesIndex(md: MarkdownIt, index: ReadonlyMap<string, FileMeta> | undefined): void {
  (md as unknown as { __c4sPagesIndex?: ReadonlyMap<string, FileMeta> }).__c4sPagesIndex = index;
}
