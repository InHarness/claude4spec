import { ChevronLeft, ChevronRight } from 'lucide-react';
import { withStability } from '../stability.js';

/**
 * `Pagination` (List, `experimental`) — previous/next page controls with a
 * "page N of M" label. The host itself does not paginate entity lists yet; this
 * is offered for plugins whose datasets do.
 *
 * Pure-presentational: page state and handlers are props.
 */
export interface PaginationProps {
  /** 1-based current page. */
  page: number;
  /** Total page count. */
  pageCount: number;
  onPageChange: (page: number) => void;
}

const btnClass =
  'inline-flex items-center justify-center rounded-md px-2 py-1.5 text-[12.5px] font-medium';

function PaginationImpl({ page, pageCount, onPageChange }: PaginationProps) {
  const atStart = page <= 1;
  const atEnd = page >= pageCount;
  return (
    <div className="flex items-center justify-center gap-3 py-4">
      <button
        type="button"
        disabled={atStart}
        onClick={() => onPageChange(page - 1)}
        className={btnClass}
        style={{
          background: 'var(--c-panel)',
          color: 'var(--c-ink)',
          border: '1px solid var(--c-hair)',
          opacity: atStart ? 0.4 : 1,
          cursor: atStart ? 'not-allowed' : 'pointer',
        }}
        aria-label="previous page"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="font-mono text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
        {page} / {pageCount}
      </span>
      <button
        type="button"
        disabled={atEnd}
        onClick={() => onPageChange(page + 1)}
        className={btnClass}
        style={{
          background: 'var(--c-panel)',
          color: 'var(--c-ink)',
          border: '1px solid var(--c-hair)',
          opacity: atEnd ? 0.4 : 1,
          cursor: atEnd ? 'not-allowed' : 'pointer',
        }}
        aria-label="next page"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

export const Pagination = withStability(PaginationImpl, 'experimental');
