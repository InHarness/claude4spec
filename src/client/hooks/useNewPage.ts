import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { openPopover, toast } from '../ui/events.js';
import { useBaseRootId } from './useConfig.js';
import { useCreatePage } from './usePage.js';
import { deriveTitle } from '../lib/newPage.js';

/**
 * 2.1.17 (M02 `66se825m`) — the one "new page" action: the `+` at the PAGES
 * header of the page-tree group, and the `c4s:new-page` event (empty state).
 *
 * The page always lands in the BASE root — the one carrying `builtin: true` —
 * whatever accordions the sidebar shows and whichever root the reader is on:
 * the tree rows create nothing, so there is no "accordion it was invoked in"
 * to target. A folder is never created on its own; it appears with the first
 * page whose path contains it (`POST /api/pages/:rootId` creates parents).
 */
export function useNewPageAction(): (at: { x: number; y: number }) => Promise<void> {
  const baseRootId = useBaseRootId();
  const createPage = useCreatePage();
  const navigate = useNavigate();
  return useCallback(
    async (at: { x: number; y: number }) => {
      const result = await openPopover('new-page', at);
      if (!result || !baseRootId) return;
      try {
        await createPage.mutateAsync({
          rootId: baseRootId,
          path: result.path,
          content: `# ${deriveTitle(result.path)}\n\n`,
        });
        void navigate({ to: '/space/$rootId/$', params: { rootId: baseRootId, _splat: result.path } });
        toast.success(`Page ${result.path} created`);
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [baseRootId, createPage, navigate],
  );
}
