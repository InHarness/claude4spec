import { useNavigate } from '@tanstack/react-router';
import { useSection } from '../hooks/useSection.js';
import { usePlanByAnchor } from '../hooks/usePlanByAnchor.js';
import { SectionRefChip, type SectionRefChipState } from './SectionRefChip.js';
import { editorBridge } from '../runtime/editor-bridge.js';
import type { MouseEvent } from 'react';

interface Props {
  anchor: string;
}

/**
 * Self-contained `<section_ref>` chip for BOTH pipelines (editor and chat — M13
 * chipprops, 2.1.28). Pulls section metadata via TanStack Query; a click on a
 * page section calls `editorBridge.openSection(page_path, anchor)`, the
 * `@c4s/plugin-runtime` singleton that delegates to the nearest
 * `EditorBridgeProvider` (editor: navigate + scroll + pulse; chat: navigate under
 * the open overlay). The chip knows neither pipeline. The pure
 * `<SectionRefChip />` stays presentational — this wrapper owns the data + click.
 *
 * Resolution is page-first: a page-section hit wins outright. Only when the page
 * lookup resolves to a genuine miss (404 → `null`, not a still-loading `undefined`)
 * do we fall back to a plan-anchor lookup, so a plan citation opens `/plans/$planPath`
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
    // Alt+click belongs to the node view's edit popover (M20 nvc5wy2p), not the chip.
    if (e.altKey) return;
    if (!section && !plan) return;
    e.preventDefault();
    e.stopPropagation();
    if (section) {
      editorBridge.openSection(section.pagePath, anchor);
      return;
    }
    // A plan anchor is not a page section, so it is not a bridge target: the
    // plan route is the only place it can open.
    if (plan) {
      void navigate({
        to: '/plans/$planPath',
        params: { planPath: plan.planPath },
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
