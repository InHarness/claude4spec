import { create } from 'zustand';
import { PAGES_KIND, fileMapEntryOf, systemRootKindOf } from '../../shared/root-kinds.js';
import type { PageFileType } from '../../shared/types.js';

/**
 * M30: expand/collapse state for the HTML preview iframe. This is UI state kept OUTSIDE
 * the URL (the URL still holds only the active file). Expanded = the iframe stretches
 * over the whole app window (in-app overlay, not the native Fullscreen API).
 */
interface HtmlViewerState {
  expanded: boolean;
  setExpanded(expanded: boolean): void;
  toggleExpanded(): void;
  /**
   * 0.2.110: per-file reload counter, bumped by `file:changed` for a `*.html`
   * path. The viewer keys its iframe on it, so the open file reloads when it
   * changes on disk. Keyed `${rootId}:${path}`.
   */
  revisions: Record<string, number>;
  notifyChanged(rootId: string, path: string): void;
}

/**
 * 2.1.23 (M30): the `fileType` of a file in a root with a facade — read off the
 * file map of THAT ROOT'S KIND, classified the way `PagesService.walk` builds
 * `PageNode.fileType`: a raw entry is `'html'` (the read-only `HtmlViewer`
 * preview, whatever the extension — an image in a skill package included),
 * anything else `'markdown'`. Never decided by the extension or the root id.
 */
export function previewFileTypeOf(rootId: string, path: string): PageFileType {
  const kind = systemRootKindOf(rootId) ?? PAGES_KIND;
  return fileMapEntryOf(kind, path)?.format === 'raw' ? 'html' : 'markdown';
}

/**
 * 2.1.8 (M30): does a `file:changed` path reach the open preview? Only a path
 * that falls under a raw entry of the root kind's file map (2.1.23: the kind of
 * `rootId`, no longer always `pages`).
 */
export function isHtmlPreviewPath(path: string, rootId: string = ''): boolean {
  return previewFileTypeOf(rootId, path) === 'html';
}

export const htmlRevisionKey = (rootId: string, path: string): string => `${rootId}:${path}`;

export const useHtmlViewerStore = create<HtmlViewerState>((set) => ({
  expanded: false,
  setExpanded: (expanded) => set({ expanded }),
  toggleExpanded: () => set((s) => ({ expanded: !s.expanded })),
  revisions: {},
  notifyChanged: (rootId, path) =>
    set((s) => {
      const key = htmlRevisionKey(rootId, path);
      return { revisions: { ...s.revisions, [key]: (s.revisions[key] ?? 0) + 1 } };
    }),
}));
