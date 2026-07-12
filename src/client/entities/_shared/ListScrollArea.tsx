import { Plus } from 'lucide-react';
import { EntityListLayout } from '../../host-ui-kit/list/EntityListLayout.js';
import { LoadingState } from '../../host-ui-kit/actions/LoadingState.js';
import { EmptyState } from '../../host-ui-kit/list/EmptyState.js';

interface Props {
  loading: boolean;
  empty: boolean;
  emptyTitle: string;
  emptyHint?: React.ReactNode;
  createLabel: string;
  onCreate: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}

export function ListScrollArea({
  loading,
  empty,
  emptyTitle,
  emptyHint,
  createLabel,
  onCreate,
  children,
}: Props) {
  return (
    <EntityListLayout>
      {loading && <LoadingState lines={5} height={40} />}
      {!loading && empty && (
        <EmptyState
          title={emptyTitle}
          hint={emptyHint}
          action={
            <button
              onClick={onCreate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium mt-2"
              style={{ background: 'var(--c-accent)', color: '#fff' }}
            >
              <Plus size={13} /> {createLabel}
            </button>
          }
        />
      )}
      {!loading && !empty && children}
    </EntityListLayout>
  );
}
