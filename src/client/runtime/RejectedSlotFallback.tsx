/**
 * 0.2.88 — the host's stand-in for a plugin slot that failed `chipSmokeTest`.
 *
 * A slot that throws while rendering is skipped with a warning instead of
 * blocking the plugin's registration (M13 / M33): the module keeps its routes,
 * editor extensions and tag, and every place that would have rendered the
 * rejected slot renders this instead. It IS the M19 broken chip (one look for
 * "there is no chip to show here"), in its `rejected-slot` category — so a
 * reader sees a labelled gap, not a crash and not a silent hole.
 */

import type { ComponentType } from 'react';
import { InlineBrokenChip } from '../tiptap/extensions/views/BrokenChip.js';

export type RejectedSlotName = 'renderChip';

export function rejectedSlotFallback(
  type: string,
  slot: RejectedSlotName,
  reason: string,
): ComponentType<{ slug: string }> {
  const hint = `${type}: ${slot} was rejected by the plugin host — ${reason}`;
  const Fallback = ({ slug }: { slug: string }) => (
    <span data-rejected-slot={slot} data-slug={slug}>
      <InlineBrokenChip category="rejected-slot" type={type} slug={slug} hint={hint} />
    </span>
  );
  Fallback.displayName = `RejectedSlotFallback(${type}.${slot})`;
  return Fallback;
}
