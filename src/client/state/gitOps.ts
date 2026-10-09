import { create } from 'zustand';

/**
 * 2.1.10 (M28 8i5qf0xx, M31 ic35jwy6) — the git operation THIS client has in
 * flight. The WS map needs it to tell "my own sync/checkout moved HEAD" (the
 * response handler reloads the project route) from "another client moved HEAD"
 * (`git:status-changed { headChanged: true }` → reload here). The header entry
 * reads it for its spinner and lock.
 */
export type GitOwnOp = 'checkout' | 'fetch' | 'sync';

interface GitOpsState {
  pending: GitOwnOp | null;
  begin(op: GitOwnOp): void;
  /** Clears only when `op` is still the pending one. */
  end(op: GitOwnOp): void;
}

export const useGitOpsStore = create<GitOpsState>((set, get) => ({
  pending: null,
  begin: (op) => set({ pending: op }),
  end: (op) => {
    if (get().pending === op) set({ pending: null });
  },
}));
