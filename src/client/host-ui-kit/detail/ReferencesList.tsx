import { FileText } from 'lucide-react';
import { withStability } from '../stability.js';
import { EmptyState } from '../list/EmptyState.js';
import { LoadingState } from '../actions/LoadingState.js';

/**
 * `ReferencesList` (Panel detalu, `experimental`) — referrer list rendered
 * from props, driven by the host's `useReferences` hook. No self-fetch.
 */
export interface ReferencesListItem {
  pagePath: string;
  label: string;
  anchor?: string;
}

export interface ReferencesListProps {
  references: ReferencesListItem[];
  onOpen?(ref: ReferencesListItem): void;
  loading?: boolean;
}

function ReferencesListImpl({ references, onOpen, loading }: ReferencesListProps) {
  if (loading) {
    return <LoadingState lines={3} height={28} />;
  }
  if (references.length === 0) {
    return <EmptyState title="No references" hint="Pages mentioning this entity will appear here." />;
  }

  return (
    <ul className="flex flex-col gap-1">
      {references.map((ref, i) => (
        <li key={`${ref.pagePath}#${ref.anchor ?? ''}-${i}`}>
          <button
            type="button"
            onClick={() => onOpen?.(ref)}
            className="w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left"
            style={{ cursor: onOpen ? 'pointer' : 'default' }}
          >
            <FileText size={13} style={{ color: 'var(--c-muted)', flexShrink: 0 }} />
            <span className="text-[12.5px] truncate" style={{ color: 'var(--c-ink)' }}>
              {ref.label}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export const ReferencesList = withStability(ReferencesListImpl, 'experimental');
