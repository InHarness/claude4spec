import type { ReactNode } from 'react';
import { withStability } from '../stability.js';

/**
 * `EntityListLayout` (List, `experimental`) — the full-height column scaffold of
 * an entity list page: a fixed header region over a scrollable body. Mirrors the
 * host's `ListPageLayout` + scroll area split.
 *
 * Pure-presentational. Experimental: props may change without a major bump.
 */
export interface EntityListLayoutProps {
  /** Fixed header (e.g. an `EntityListHeader`). */
  header?: ReactNode;
  /** Scrollable list body. */
  children: ReactNode;
}

function EntityListLayoutImpl({ header, children }: EntityListLayoutProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {header}
      <div className="flex-1 overflow-auto nice-scroll">
        <div className="mx-auto" style={{ maxWidth: 1000, padding: '16px 32px 48px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export const EntityListLayout = withStability(EntityListLayoutImpl, 'experimental');
