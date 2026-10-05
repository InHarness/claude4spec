import React, { createContext, useContext, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { PageRefChip } from '../components/PageRefChip.js';
import { usePageLinks } from '../hooks/usePageLinks.js';
import { useBaseRootId, useRoots } from '../hooks/useConfig.js';
import { pageTarget } from '../lib/pageTarget.js';
import type { FileMeta } from '../../shared/page-links.js';
import type { PageRefPayload } from './remark-page-refs.js';

/**
 * The pages a chat message can resolve a reference against — every path the
 * page-link graph knows. Moved here from the retired `UserTextMarkdown`.
 */
export function useChatPagesIndex(): Map<string, FileMeta> | undefined {
  const { data } = usePageLinks();
  return useMemo(() => {
    if (!data) return undefined;
    const paths = new Set<string>();
    for (const p of Object.keys(data.links)) paths.add(p);
    for (const p of Object.keys(data.reverseLinks)) paths.add(p);
    for (const sources of Object.values(data.reverseLinks)) sources.forEach((p) => paths.add(p));
    for (const links of Object.values(data.links)) for (const l of links) paths.add(l.targetPath);
    const map = new Map<string, FileMeta>();
    for (const p of paths) map.set(p, { path: p, title: basenameTitle(p), anchors: [] });
    return map;
  }, [data]);
}

/**
 * The index a message's `ChatMarkdown` already built, handed to its chips so a
 * message with N references builds the path map once, not N times.
 */
export const ChatPagesIndexContext = createContext<Map<string, FileMeta> | undefined>(undefined);

function basenameTitle(p: string): string {
  const base = p.split('/').pop() ?? p;
  return base.replace(/\.mdx?$/i, '');
}

function resolvePath(path: string, index: Map<string, FileMeta> | undefined): string | null {
  if (!path || !index) return null;
  if (index.has(path)) return path;
  if (!/\.\w+$/.test(path) && index.has(`${path}.md`)) return `${path}.md`;
  return null;
}

/**
 * A page reference in a chat message (M14): a `PageRefChip` that navigates to
 * the page — and to the section, with an anchor. A chat message has no
 * document root, so a bare path resolves in the base root.
 */
export function ChatPageRef({ refAttrs }: { refAttrs: PageRefPayload }) {
  const navigate = useNavigate();
  const baseRootId = useBaseRootId();
  const roots = useRoots();
  const pagesIndex = useContext(ChatPagesIndexContext);
  const resolved = resolvePath(refAttrs.path, pagesIndex);
  const meta = resolved ? pagesIndex?.get(resolved) : undefined;
  const onClick =
    resolved && baseRootId
      ? (e: React.MouseEvent<HTMLSpanElement>) => {
          e.preventDefault();
          e.stopPropagation();
          const target = pageTarget(resolved, roots.map((r) => r.id), baseRootId);
          void navigate({
            to: '/space/$rootId/$',
            params: { rootId: target.rootId, _splat: target.path },
            hash: refAttrs.anchor ? `anchor-${refAttrs.anchor}` : undefined,
          });
        }
      : undefined;
  return (
    <PageRefChip
      syntax={refAttrs.syntax}
      path={refAttrs.path}
      anchor={refAttrs.anchor}
      label={refAttrs.label}
      title={meta?.title}
      state={resolved ? 'normal' : 'broken'}
      onClick={onClick}
      interactive={!!resolved}
    />
  );
}
