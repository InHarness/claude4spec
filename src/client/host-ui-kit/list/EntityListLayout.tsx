import type { ReactNode } from 'react';
import { withStability } from '../stability.js';

/**
 * `EntityListLayout` (List, `experimental`) — the full-height column scaffold of
 * an entity list page: a fixed header region over a scrollable body. Mirrors the
 * host's `ListPageLayout` + scroll area split. The `header` stands OUTSIDE the
 * scroll region; only the body under it scrolls (record `entity-list-layout`,
 * 2.1.33). The header region is also where `TagFilterBar` goes, under
 * `EntityListHeader`, as its sibling (M19 `thm8a14c`).
 *
 * Pure-presentational. Experimental: props may change without a major bump.
 */
export interface EntityListLayoutProps {
  /**
   * Fixed header, outside the scroll region (e.g. an `EntityListHeader`, with a
   * `TagFilterBar` under it as its sibling).
   */
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
