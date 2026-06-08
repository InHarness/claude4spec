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
}

export const useHtmlViewerStore = create<HtmlViewerState>((set) => ({
  expanded: false,
  setExpanded: (expanded) => set({ expanded }),
  toggleExpanded: () => set((s) => ({ expanded: !s.expanded })),
}));
