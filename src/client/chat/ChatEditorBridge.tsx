import { useMemo, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { EditorBridgeProvider, type EditorBridge } from '../tiptap/EditorContext.js';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { useBaseRootId } from '../hooks/useConfig.js';
import type { EntityType, SectionIndexEntry } from '../../shared/entities.js';

type Navigate = ReturnType<typeof useNavigate>;

/**
 * The chat-aware `EditorBridge` (M53 rehyxchp, M20 nvc5wy2p): `openEntity` /
 * `openSection` navigate the main pane in the background, UNDER the overlay —
 * the chat overlay stays open (nothing here closes it), and the page editor
 * underneath scrolls to the target through the anchor hash.
 *
 * A section's root comes from the section index entry the chip itself fetched
 * (`['section', anchor]`), falling back to the project's base page root.
 * Pure (no hooks) so it can be tested without a router.
 */
export function createChatAwareBridge(
  navigate: Navigate,
  queryClient: Pick<QueryClient, 'getQueryData'>,
  baseRootId: string | null,
): EditorBridge {
  return {
    openEntity: (type: EntityType, slug: string) => {
      // Same resolution as the host's `navigateToEntity`: an inactive type has
      // no mounted route, so there is nowhere to go.
      const mod = clientPluginHost.getEntity(type);
      if (!mod) return;
      void navigate({ to: `${mod.pathPrefix}/$slug`, params: { slug } } as never);
    },
    openSection: (pagePath: string, anchor: string) => {
      const entry = queryClient.getQueryData<SectionIndexEntry | null>(['section', anchor]);
      const rootId = entry && entry.pagePath === pagePath ? entry.rootId : baseRootId;
      if (!rootId) return;
      void navigate({
        to: '/space/$rootId/$',
        params: { rootId, _splat: pagePath },
        hash: `anchor-${anchor}`,
      } as never);
    },
  };
}

/**
 * Wraps the chat message tree: every chip inside it calls the `editorBridge`
 * singleton, which delegates to this provider's chat-aware bridge because it is
 * the nearest one around the chip.
 */
export function ChatEditorBridgeProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const baseRootId = useBaseRootId();
  const bridge = useMemo(
    () => createChatAwareBridge(navigate, queryClient, baseRootId),
    [navigate, queryClient, baseRootId],
  );
  return <EditorBridgeProvider bridge={bridge}>{children}</EditorBridgeProvider>;
}
