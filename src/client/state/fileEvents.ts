import { create } from 'zustand';

export interface ExternalChangeEvent {
  /** 0.1.96 multiroot: same relative path can exist in multiple roots. */
  rootId: string;
  path: string;
  ts: number;
}

interface FileEventsState {
  externalChange: ExternalChangeEvent | null;
  notifyExternalChange(rootId: string, path: string): void;
  clearExternalChange(): void;
  /** Separate channel for briefs — brief paths live in a different namespace
   * (briefsDir) than page paths, so they must not collide on `externalChange`. */
  briefExternalChange: ExternalChangeEvent | null;
  notifyBriefExternalChange(path: string): void;
  clearBriefExternalChange(): void;
}

export const useFileEventsStore = create<FileEventsState>((set) => ({
  externalChange: null,
  notifyExternalChange(rootId, path) {
    set({ externalChange: { rootId, path, ts: Date.now() } });
  },
  clearExternalChange() {
    set({ externalChange: null });
  },
  briefExternalChange: null,
  notifyBriefExternalChange(path) {
    // Briefs live in their own single-namespace channel; tag with the 'brief' marker.
    set({ briefExternalChange: { rootId: 'brief', path, ts: Date.now() } });
  },
  clearBriefExternalChange() {
    set({ briefExternalChange: null });
  },
}));
