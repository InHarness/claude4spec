import type { ReactNode } from 'react';
import { withStability } from '../stability.js';

/**
 * `EmptyState` (List, `experimental`) — the dashed card shown when a list has no
 * rows: a title, an optional hint, and an optional action slot. Mirrors the
 * host's empty block in `ListScrollArea`.
 *
 * One component for both empty-list cases (M19 `m19l12sc`, 2.1.19): a list with
 * no entities at all and a list whose search / tag filter matched nothing. The
 * component has no `variant` and no error state — the entity type tells the two
 * cases apart by the text it passes (`title`, `hint`, `action`), e.g.
 * "No endpoints yet" vs "No endpoints match the filter".
 *
 * Pure-presentational. Experimental: props may change without a major bump.
 */
export interface EmptyStateProps {
  title: string;
  hint?: ReactNode;
  /** Action slot (e.g. a create button). */
  action?: ReactNode;
}

function EmptyStateImpl({ title, hint, action }: EmptyStateProps) {
  return (
    <div
      className="text-center py-20 rounded-lg"
      style={{
        background: 'var(--c-card)',
        border: '1px dashed var(--c-hair-strong)',
        color: 'var(--c-subtle)',
      }}
    >
      <div className="text-[14px] mb-2">{title}</div>
      {hint && <div className="text-[12px] mb-4">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export const EmptyState = withStability(EmptyStateImpl, 'experimental');
