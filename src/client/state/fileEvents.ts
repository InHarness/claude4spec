import { create } from 'zustand';

export interface ExternalChangeEvent {
  path: string;
  ts: number;
}

interface FileEventsState {
  externalChange: ExternalChangeEvent | null;
  notifyExternalChange(path: string): void;
  clearExternalChange(): void;
}

export const useFileEventsStore = create<FileEventsState>((set) => ({
  externalChange: null,
  notifyExternalChange(path) {
    set({ externalChange: { path, ts: Date.now() } });
  },
  clearExternalChange() {
    set({ externalChange: null });
  },
}));
