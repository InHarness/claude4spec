import { create } from 'zustand';

type PageView = 'editor' | 'history';

interface PageViewState {
  pageView: PageView;
  setPageView(view: PageView): void;
}

export const usePageViewStore = create<PageViewState>((set) => ({
  pageView: 'editor',
  setPageView: (pageView) => set({ pageView }),
}));
