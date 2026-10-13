/**
 * Not host-local (2.1.20, Host UI Kit slices of `ui-view` and `design-system`):
 * a local composition of catalog components only — `EntityListLayout`,
 * `LoadingState`, `EmptyState`, and an `ActionButton` for the create action —
 * with no anatomy of its own. The 2.1.19 debt entry for it was struck.
 *
 * The composition, not the pieces.
 *
 * Every visual piece here comes from the catalog: `EntityListLayout`,
 * `LoadingState`, `EmptyState`. What stays local is the three-way choice between
 * them plus this envelope's "create" affordance in the empty state — a
 * composition the catalog publishes no slot for. Nothing below re-implements a
 * catalog component; if the kit ever publishes this arrangement, this file
 * becomes a re-export.
 */

import { Plus } from 'lucide-react';
import { ActionButton, EmptyState, EntityListLayout, LoadingState } from '@c4s/plugin-runtime/ui';

interface Props {
  loading: boolean;
  empty: boolean;
  emptyTitle: string;
  emptyHint?: React.ReactNode;
  createLabel: string;
  onCreate: () => void;
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
            <ActionButton
              variant="primary"
              icon={<Plus size={13} />}
              label={createLabel}
              onClick={onCreate}
            />
          }
        />
      )}
      {!loading && !empty && children}
    </EntityListLayout>
  );
}
