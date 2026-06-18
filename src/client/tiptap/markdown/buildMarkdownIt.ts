import MarkdownIt from 'markdown-it';
import { setupXmlMarkdownRules } from '../extensions/xmlNodes.js';
import { setupAnchorMarkerRule } from '../extensions/AnchorMarker.js';
import { setupPageRefRules } from '../extensions/PageRefNode.js';
import { setupSectionRefMarkdownRule } from '../extensions/SectionRefNode/index.js';
import { setupRawJsxRules } from '../extensions/RawJsxNode.js';
import type { FileMeta } from '../../../shared/page-links.js';

export interface BuildMarkdownItOptions {
  /** Case-sensitive map of pagesDir-relative paths to FileMeta. Used by code_inline and link post-processors. */
  pagesIndex?: ReadonlyMap<string, FileMeta>;
  /** Tweak the markdown-it constructor options (defaults match tiptap-markdown). */
  html?: boolean;
  breaks?: boolean;
  linkify?: boolean;
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
  setupXmlMarkdownRules(md);
  setupAnchorMarkerRule(md);
  setupPageRefRules(md);
  setupSectionRefMarkdownRule(md);
  setupRawJsxRules(md);
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
