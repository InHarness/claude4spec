import { create } from 'zustand';

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
