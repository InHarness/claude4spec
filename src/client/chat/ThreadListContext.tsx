import { createContext, useContext, type ReactNode } from 'react';
import { useThreadList } from './useThreadList.js';

type ThreadListValue = ReturnType<typeof useThreadList>;

const ThreadListContext = createContext<ThreadListValue | null>(null);

/**
 * Single shared instance of the thread list. Spec (L5-C-state) keeps chat
 * threads OUT of TanStack Query — they are owned by one hook with its own cache.
 * Mounting this provider once (over both ChatOverlay and PlanPage) collapses what
 * used to be one independent `useThreadList()` per consumer into a single fetch,
 * fixing the duplicate GET /api/threads on every reload.
 */
export function ThreadListProvider({ children }: { children: ReactNode }) {
  const value = useThreadList();
  return <ThreadListContext.Provider value={value}>{children}</ThreadListContext.Provider>;
}

export function useThreadListContext(): ThreadListValue {
  const ctx = useContext(ThreadListContext);
  if (!ctx) throw new Error('useThreadListContext must be used within a ThreadListProvider');
  return ctx;
}
