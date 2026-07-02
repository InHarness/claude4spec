import MarkdownIt from 'markdown-it';
import { setupXmlMarkdownRules } from '../extensions/xmlNodes.js';
import { setupAnchorMarkerRule } from '../extensions/AnchorMarker.js';
import { setupPageRefRules } from '../extensions/PageRefNode.js';
import { setupSectionRefMarkdownRule } from '../extensions/SectionRefNode/index.js';
import { setupRawJsxRules } from '../extensions/RawJsxNode.js';
import type { FileMeta } from '../../../shared/page-links.js';

export interface BuildMarkdownItOptions {
  /** Case-sensitive map of root-relative paths to FileMeta. Used by code_inline and link post-processors. */
  pagesIndex?: ReadonlyMap<string, FileMeta>;
  /** Tweak the markdown-it constructor options (defaults match tiptap-markdown). */
  html?: boolean;
  breaks?: boolean;
  linkify?: boolean;
  /**
   * 0.1.96: per-root behaviour gates (subset of the shared `Root` flags). When
   * omitted, all rule setups run (full `pages`-root behaviour) for backward
   * compatibility. When provided, reference and section rules are gated so a
   * minimal root round-trips its raw `<…/>` tags as text rather than promoting
   * them to nodes with no matching editor schema.
   */
  root?: { sectionIndexed?: boolean; referenceValidated?: boolean };
}

/**
 * Centralized markdown-it factory. Applies all custom rule setups from the editor
 * extension registry plus M14 PageRef rules. Shared by tiptap-markdown (through
 * extension `parse.setup` hooks) and by non-editor consumers (Faza 4: UserTextMarkdown).
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
  // Gate rule setups on the root's properties. Defaults preserve full behaviour
  // so unmigrated callers (and non-root consumers) keep every rule. Rule order is
  // preserved to keep markdown-it precedence identical to pre-0.1.96.
  const referenceValidated = options.root?.referenceValidated ?? true;
  const sectionIndexed = options.root?.sectionIndexed ?? true;
  if (referenceValidated) setupXmlMarkdownRules(md); // 5 reference nodes (referenceValidated)
  if (sectionIndexed) setupAnchorMarkerRule(md); // anchors (sectionIndexed)
  setupPageRefRules(md); // @path.md links — base (scoped by linkTargets)
  if (sectionIndexed) setupSectionRefMarkdownRule(md); // section refs (sectionIndexed)
  setupRawJsxRules(md); // raw mdx JSX — base
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
