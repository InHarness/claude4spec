import { useMemo, type MouseEvent } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useNavigate } from '@tanstack/react-router';
import { usePageLinks } from '../../../hooks/usePageLinks.js';
import { PageRefChip, type PageRefChipState } from '../../../components/PageRefChip.js';
import { openPageRefPopover } from '../PageRefPopover.js';
import { resolveAgainstIndex, buildPageRefIndex, basenameTitle } from '../../lib/pathResolve.js';
import type { PageRefSyntax } from '../PageRefNode.js';
import type { FileMeta } from '../../../../shared/page-links.js';

function normalizePath(
  raw: string,
  index: Map<string, FileMeta>,
  sourcePath?: string,
  dir?: string,
): string | null {
  if (!raw) return null;
  return resolveAgainstIndex(raw, { has: (p) => index.has(p) }, sourcePath, dir);
}

export function PageRefView(props: NodeViewProps) {
  const { node } = props;
  const syntax = String(node.attrs.syntax ?? 'at') as PageRefSyntax;
  const path = String(node.attrs.path ?? '');
  const anchor = String(node.attrs.anchor ?? '');
  const label = String(node.attrs.label ?? '');
  const navigate = useNavigate();
  const { data, isLoading } = usePageLinks();

  const storage = props.editor.storage as Record<string, unknown>;
  const sourcePath = storage.pageRefSourcePath as string | undefined;
  const rootId = storage.pageRefRootId as string | undefined;
  const dir = storage.pageRefDir as string | undefined;

  // The API returns links and reverseLinks keyed by composite `${rootId}:${relPath}`;
  // buildPageRefIndex narrows to the current root and strips the prefix so the resolver
  // (incl. the 0.1.100 dir-strip fallback) matches bare relPaths. Title is the basename
  // until a dedicated /api/page-links/files endpoint exists.
  const byPath = useMemo<Map<string, FileMeta>>(
    () => (data ? buildPageRefIndex(data, rootId) : new Map()),
    [data, rootId],
  );

  const resolvedPath = normalizePath(path, byPath, sourcePath, dir);
  const meta = resolvedPath ? byPath.get(resolvedPath) : undefined;

  const chipState: PageRefChipState = (() => {
    if (isLoading && !data) return 'loading';
    if (!resolvedPath) return 'broken';
    if (anchor && meta && meta.anchors.length > 0 && !meta.anchors.includes(anchor)) return 'stale';
    return 'normal';
  })();

  const title = meta?.title ?? basenameTitle(path);

  const handleClick = (e: MouseEvent<HTMLSpanElement>) => {
    if (e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      const anchorEl = e.currentTarget;
      const rect = anchorEl.getBoundingClientRect();
      void openPageRefPopover(
        { x: rect.left, y: rect.bottom + 4 },
        {
          syntax,
          path,
          anchor,
          label,
          onRemove: () => props.deleteNode(),
          onSave: (attrs) => props.updateAttributes(attrs),
        },
      );
      return;
    }
    if (chipState === 'broken') {
      // No navigation target — open popover for fix.
      const anchorEl = e.currentTarget;
      const rect = anchorEl.getBoundingClientRect();
      void openPageRefPopover(
        { x: rect.left, y: rect.bottom + 4 },
        {
          syntax,
          path,
          anchor,
          label,
          onRemove: () => props.deleteNode(),
          onSave: (attrs) => props.updateAttributes(attrs),
        },
      );
      return;
    }
    if (!resolvedPath) return;
    void navigate({
      to: '/pages/$',
      params: { _splat: resolvedPath },
      hash: anchor ? `anchor-${anchor}` : undefined,
    });
  };

  // Fallback render for miss @-syntax (no resolved path, not broken explicitly from link/backticks):
  // When index is still loading, show loading chip; otherwise show broken chip so user sees issue.
  return (
    <NodeViewWrapper as="span" className="inline-flex align-middle" contentEditable={false}>
      <PageRefChip
        syntax={syntax}
        path={path}
        anchor={anchor || undefined}
        label={label || undefined}
        title={title}
        state={chipState}
        onClick={handleClick}
      />
    </NodeViewWrapper>
  );
}
