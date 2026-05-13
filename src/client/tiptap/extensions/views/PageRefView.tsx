import { useMemo, type MouseEvent } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useNavigate } from '@tanstack/react-router';
import { usePageLinks } from '../../../hooks/usePageLinks.js';
import { PageRefChip, type PageRefChipState } from '../../../components/PageRefChip.js';
import { openPageRefPopover } from '../PageRefPopover.js';
import { resolveAgainstIndex } from '../../lib/pathResolve.js';
import type { PageRefSyntax } from '../PageRefNode.js';
import type { FileMeta } from '../../../../shared/page-links.js';

function normalizePath(
  raw: string,
  index: Record<string, FileMeta>,
  sourcePath?: string,
): string | null {
  if (!raw) return null;
  return resolveAgainstIndex(raw, {
    has: (p) => Object.prototype.hasOwnProperty.call(index, p),
  }, sourcePath);
}

export function PageRefView(props: NodeViewProps) {
  const { node } = props;
  const syntax = String(node.attrs.syntax ?? 'at') as PageRefSyntax;
  const path = String(node.attrs.path ?? '');
  const anchor = String(node.attrs.anchor ?? '');
  const label = String(node.attrs.label ?? '');
  const navigate = useNavigate();
  const { data, isLoading } = usePageLinks();

  const byPath = useMemo<Record<string, FileMeta>>(() => {
    const out: Record<string, FileMeta> = {};
    if (!data) return out;
    // The API returns links and reverseLinks; we need file metadata to show title + anchors.
    // Until a dedicated /api/page-links/files endpoint exists, derive title from path basename.
    const paths = new Set<string>();
    for (const p of Object.keys(data.links)) paths.add(p);
    for (const p of Object.keys(data.reverseLinks)) paths.add(p);
    for (const sources of Object.values(data.reverseLinks)) sources.forEach((p) => paths.add(p));
    for (const links of Object.values(data.links)) {
      for (const l of links) paths.add(l.targetPath);
    }
    for (const p of paths) {
      out[p] = { path: p, title: basenameTitle(p), anchors: [] };
    }
    return out;
  }, [data]);

  const sourcePath = (props.editor.storage as Record<string, unknown>).pageRefSourcePath as
    | string
    | undefined;
  const resolvedPath = normalizePath(path, byPath, sourcePath);
  const meta = resolvedPath ? byPath[resolvedPath] : undefined;

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

function basenameTitle(p: string): string {
  const base = p.split('/').pop() ?? p;
  return base.replace(/\.md$/, '');
}
