import type { ReactNode } from 'react';
import { withStability } from '../stability.js';

/**
 * `FieldRow` (Core, `stable`; contributed by M13) — a single key/value pair in
 * a detail view. The label sits in a fixed-width column, the value fills the
 * rest. Compose many inside a {@link FieldGrid}.
 *
 * Pure-presentational: label and value are props (value is arbitrary content).
 */
export interface FieldRowProps {
  label: ReactNode;
  children: ReactNode;
  /** Align the label to the top (for multi-line values). Defaults to center. */
  align?: 'center' | 'start';
}

function FieldRowImpl({ label, children, align = 'center' }: FieldRowProps) {
  return (
    <div className="flex gap-3" style={{ alignItems: align === 'start' ? 'flex-start' : 'center' }}>
      <div
        className="font-mono text-[11px] uppercase tracking-wider shrink-0"
        style={{ color: 'var(--c-subtle)', width: 140, paddingTop: align === 'start' ? 2 : 0 }}
      >
        {label}
      </div>
      <div className="flex-1 min-w-0 text-[13.5px]" style={{ color: 'var(--c-ink)' }}>
        {children}
      </div>
    </div>
  );
}

export const FieldRow = withStability(FieldRowImpl, 'stable');
