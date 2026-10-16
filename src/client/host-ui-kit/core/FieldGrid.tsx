import type { ReactNode } from 'react';
import { withStability } from '../stability.js';

/**
 * `FieldGrid` (Core, `stable`; contributed by M13) — layout container: a
 * column of `children` into which the consumer puts its {@link FieldRow}s
 * (2.1.26 — `FieldGrid` renders no rows itself). Provides consistent vertical
 * rhythm and an optional max width matching the host's detail body.
 *
 * Pure-presentational: children only.
 */
export interface FieldGridProps {
  children: ReactNode;
  /** Max content width in px. Defaults to the host's 1000px detail body. */
  maxWidth?: number;
}

function FieldGridImpl({ children, maxWidth = 1000 }: FieldGridProps) {
  return (
    <div className="mx-auto flex flex-col gap-3" style={{ maxWidth, padding: '16px 32px 48px' }}>
      {children}
    </div>
  );
}

export const FieldGrid = withStability(FieldGridImpl, 'stable');
