import { useNavigate } from '@tanstack/react-router';
import { useSection } from '../hooks/useSection.js';
import { usePlanByAnchor } from '../hooks/usePlanByAnchor.js';
import { SectionRefChip, type SectionRefChipState } from './SectionRefChip.js';
import type { MouseEvent } from 'react';

interface Props {
  anchor: string;
}

/**
 * Self-contained chip for cross-pipeline use (chat UI / non-tiptap consumers).
 * Pulls section metadata via TanStack Query and navigates on click. The pure
 * `<SectionRefChip />` stays presentational — this wrapper owns the data + click.
 *
 * Resolution is page-first: a page-section hit wins outright. Only when the page
 * lookup resolves to a genuine miss (404 → `null`, not a still-loading `undefined`)
 * do we fall back to a plan-anchor lookup, so a plan citation opens `/plans/$planId`
 * and scrolls to the heading. The broken chip renders only when both lookups miss.
 */
export function SectionRefChipWithData({ anchor }: Props) {
  const { data: section } = useSection(anchor || null);
  // `section === null` means the page lookup finished and found nothing (404); only then
  // do we try the plan lookup. `undefined` still means loading, so we keep page-first.
  const pageMiss = Boolean(anchor) && section === null;
  const { data: plan } = usePlanByAnchor(anchor || null, pageMiss);
  const navigate = useNavigate();

  const state: SectionRefChipState = !anchor
    ? 'broken'
    : section
      ? 'normal'
      : section === undefined
        ? 'loading'
        : plan === undefined
          ? 'loading'
          : plan
            ? 'normal'
            : 'broken';

  const onClick = (e: MouseEvent<HTMLSpanElement>) => {
    if (!section && !plan) return;
    e.preventDefault();
    e.stopPropagation();
    if (section) {
      void navigate({
        to: '/space/$rootId/$',
        params: { rootId: section.rootId, _splat: section.pagePath },
        hash: `anchor-${anchor}`,
      } as never);
      return;
    }
    if (plan) {
      void navigate({
        to: '/plans/$planId',
        params: { planId: String(plan.planId) },
        hash: `anchor-${anchor}`,
      } as never);
    }
  };

  const resolved = section || plan;

  return (
    <SectionRefChip
      anchor={anchor}
      pagePath={section?.pagePath}
      headingText={section?.headingText}
      state={state}
      onClick={resolved ? onClick : undefined}
      interactive={!!resolved}
    />
  );
}
