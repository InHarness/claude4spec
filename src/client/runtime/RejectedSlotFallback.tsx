/**
 * 0.2.88 — the host's stand-in for a plugin slot that failed `chipSmokeTest`.
 *
 * A slot that throws while rendering is skipped with a warning instead of
 * blocking the plugin's registration (M13 / M33): the module keeps its routes,
 * editor extensions and tag, and every place that would have rendered the
 * rejected slot renders this instead. Styled as the M19 broken state — one
 * look for "there is no chip to show here" — so a reader sees a labelled gap,
 * not a crash and not a silent hole.
 */

import type { ComponentType } from 'react';

export type RejectedSlotName = 'renderChip' | 'renderCard' | 'renderRow';

export function rejectedSlotFallback(
  type: string,
  slot: RejectedSlotName,
  reason: string,
): ComponentType<{ slug: string }> {
  const label = `[broken: ${type}]`;
  const title = `${type}: ${slot} was rejected by the plugin host — ${reason}`;
  const Fallback = ({ slug }: { slug: string }) => (
    <span className="c4s-chip c4s-chip--broken" data-rejected-slot={slot} data-slug={slug} title={title}>
      {label}
    </span>
  );
  Fallback.displayName = `RejectedSlotFallback(${type}.${slot})`;
  return Fallback;
}
