import { create } from 'zustand';
import { PAGES_KIND, fileMapEntryOf } from '../../shared/root-kinds.js';

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
 * 2.1.8 (M30): does a `file:changed` path reach the open `.html` preview? Only a
 * path that falls under a raw entry of the `pages` kind's file map (today
 * `**\/*.html`) — the narrowing comes from the kind declaration, classified the
 * way `PagesService.walk` classifies it (`format === 'raw'`), not from an
 * extension or a pattern literal of our own.
 */
export function isHtmlPreviewPath(path: string): boolean {
  const entry = fileMapEntryOf(PAGES_KIND, path);
  return entry?.format === 'raw';
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
