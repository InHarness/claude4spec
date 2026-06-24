import type { ReactNode } from 'react';
import { withStability } from '../stability.js';

/**
 * `EmptyState` (List, `experimental`) — the dashed card shown when a list has no
 * rows: a title, an optional hint, and an optional action slot. Mirrors the
 * host's empty block in `ListScrollArea`.
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
