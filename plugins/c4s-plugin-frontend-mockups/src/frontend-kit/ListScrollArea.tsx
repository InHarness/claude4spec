/**
 * HOST-LOCAL — the composition, not the pieces.
 *
 * Every visual piece here comes from the catalog: `EntityListLayout`,
 * `LoadingState`, `EmptyState`. What stays local is the three-way choice between
 * them plus this envelope's "create" affordance in the empty state — a
 * composition the catalog publishes no slot for. Nothing below re-implements a
 * catalog component; if the kit ever publishes this arrangement, this file
 * becomes a re-export.
 */

import { Plus } from 'lucide-react';
import { EntityListLayout } from '@c4s/plugin-runtime/ui';
import { LoadingState } from '@c4s/plugin-runtime/ui';
import { EmptyState } from '@c4s/plugin-runtime/ui';

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
