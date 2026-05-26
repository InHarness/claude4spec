import { create } from 'zustand';

export interface ExternalChangeEvent {
  path: string;
  ts: number;
}

interface FileEventsState {
  externalChange: ExternalChangeEvent | null;
  notifyExternalChange(path: string): void;
  clearExternalChange(): void;
  /** Separate channel for briefs — brief paths live in a different namespace
   * (briefsDir) than page paths, so they must not collide on `externalChange`. */
  briefExternalChange: ExternalChangeEvent | null;
  notifyBriefExternalChange(path: string): void;
  clearBriefExternalChange(): void;
}

export const useFileEventsStore = create<FileEventsState>((set) => ({
  externalChange: null,
  notifyExternalChange(path) {
    set({ externalChange: { path, ts: Date.now() } });
  },
  clearExternalChange() {
    set({ externalChange: null });
  },
  briefExternalChange: null,
  notifyBriefExternalChange(path) {
    set({ briefExternalChange: { path, ts: Date.now() } });
  },
  clearBriefExternalChange() {
    set({ briefExternalChange: null });
  },
}));
