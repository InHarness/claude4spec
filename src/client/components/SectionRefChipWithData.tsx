import { useNavigate } from '@tanstack/react-router';
import { useSection } from '../hooks/useSection.js';
import { SectionRefChip, type SectionRefChipState } from './SectionRefChip.js';
import type { MouseEvent } from 'react';

interface Props {
  anchor: string;
}

/**
 * Self-contained chip for cross-pipeline use (chat UI / non-tiptap consumers).
 * Pulls section metadata via TanStack Query and navigates on click. The pure
 * `<SectionRefChip />` stays presentational — this wrapper owns the data + click.
 */
export function SectionRefChipWithData({ anchor }: Props) {
  const { data, isLoading } = useSection(anchor || null);
  const navigate = useNavigate();

  const state: SectionRefChipState = !anchor
    ? 'broken'
    : isLoading && data === undefined
      ? 'loading'
      : data
        ? 'normal'
        : 'broken';

  const onClick = (e: MouseEvent<HTMLSpanElement>) => {
    if (!data) return;
    e.preventDefault();
    e.stopPropagation();
    void navigate({
      to: '/pages/$',
      params: { _splat: data.pagePath },
      hash: `anchor-${anchor}`,
    } as never);
  };

  return (
    <SectionRefChip
      anchor={anchor}
      pagePath={data?.pagePath}
      headingText={data?.headingText}
      state={state}
      onClick={data ? onClick : undefined}
      interactive={!!data}
    />
  );
}
