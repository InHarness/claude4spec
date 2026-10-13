import { useState } from 'react';
import { Braces, Plus } from 'lucide-react';
import {
  ActionButton,
  Badge,
  EmptyState,
  EntityListHeader,
  EntityListLayout,
  EntityListRow,
  LoadingState,
  TagFilterBar,
} from '@c4s/plugin-runtime/ui';
import { useDtos } from './hooks.js';
import { toast } from '@c4s/plugin-runtime';
import { DtoCreateDialog } from './create-dialog.js';
import { ListPageLayout } from '../../../frontend-kit/ListPageLayout.js';
import { useEntityListQuery } from '../../../frontend-kit/useEntityListQuery.js';

/** The type's own empty text — one `EmptyState` for "none" and "none matching" alike. */
export const DTO_LIST_EMPTY_TITLE = 'No DTOs.';

interface Props {
  search: string;
  tagFilter: string[];
  onSearchChange: (q: string) => void;
  onTagToggle: (tag: string) => void;
  onSelect: (slug: string) => void;
}

export function DtosList({
  search,
  tagFilter,
  onSearchChange,
  onTagToggle,
  onSelect,
}: Props) {
  const { query, tagLookup, tagBar } = useEntityListQuery('dto', { search, tagFilter, onTagToggle });
  const { data: dtos = [], isLoading } = useDtos(query);

  // 0.2.2: the list's CREATE affordance is the kit `Dialog`, mirroring the
  // endpoint list. It used to open the host's `create-dto` popover through the
  // host-owned popover registry, which a package outside the host cannot reach.
  // The popover survives, but as the SLASH-create surface (`slash-create.tsx`),
  // which is what it was always for.
  const [createOpen, setCreateOpen] = useState(false);
  function handleCreate() {
    setCreateOpen(true);
  }
  function handleCreated(dto: { slug: string; title: string }) {
    setCreateOpen(false);
    onSelect(dto.slug);
    toast.success(`DTO ${dto.title} created`);
  }

  /**
   * 2.1.16 (`dto-list`) — `EntityListHeader` (icon, title, count = length of
   * the fetched list, search, "New DTO"); the whole screen is an
   * `EntityListLayout`. Two alternative states: `loading` (`LoadingState`) and
   * `empty` (one `EmptyState` with the type's text, no filter reset — the tag
   * filter clears in its own bar). No pagination, no error state.
   */
  const header = (
    <>
      <EntityListHeader
        icon={Braces}
        title="DTOs"
        count={dtos.length}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search title, slug, description…"
        actions={
          <ActionButton
            variant="primary"
            icon={<Plus size={13} />}
            label="New DTO"
            onClick={handleCreate}
          />
        }
      />
      <TagFilterBar {...tagBar} />
    </>
  );

  return (
    <ListPageLayout>
      <EntityListLayout header={header}>
        {isLoading ? (
          <LoadingState lines={5} height={40} />
        ) : dtos.length === 0 ? (
          <EmptyState title={DTO_LIST_EMPTY_TITLE} />
        ) : (
          dtos.map((d) => (
            <EntityListRow
              key={d.slug}
              icon={Braces}
              onClick={() => onSelect(d.slug)}
              tags={d.tags}
              tagLookup={tagLookup}
              trailing={<Badge label={`${d.fields.length}f`} mono small dot={false} />}
            >
              <div className="flex items-center gap-2">
                <span className="text-[14px]" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
                  {d.title}
                </span>
              </div>
              {d.description && (
                <div className="text-[12.5px] truncate mt-0.5" style={{ color: 'var(--c-muted)' }}>
                  {d.description}
                </div>
              )}
            </EntityListRow>
          ))
        )}
      </EntityListLayout>
      {createOpen && <DtoCreateDialog onClose={() => setCreateOpen(false)} onCreated={handleCreated} />}
    </ListPageLayout>
  );
}
