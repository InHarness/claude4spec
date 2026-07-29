import { useState } from 'react';
import { Braces } from 'lucide-react';
import { useDtos } from './hooks.js';
import { toast } from '../../../frontend-kit/host-events.js';
import { DtoCreateDialog } from './create-dialog.js';
import { ListPageLayout } from '../../../frontend-kit/ListPageLayout.js';
import { ListPageHeader } from '../../../frontend-kit/ListPageHeader.js';
import { TagFilterBar } from '../../../frontend-kit/TagFilterBar.js';
import { ListScrollArea } from '../../../frontend-kit/ListScrollArea.js';
import { EntityListRow, CountBadge } from '../../../frontend-kit/EntityListRow.js';
import { useEntityListQuery } from '../../../frontend-kit/useEntityListQuery.js';

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
  function handleCreated(dto: { slug: string; name: string }) {
    setCreateOpen(false);
    onSelect(dto.slug);
    toast.success(`DTO ${dto.name} created`);
  }

  return (
    <ListPageLayout>
      <ListPageHeader
        icon={Braces}
        title="DTOs"
        count={dtos.length}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search name, slug, description…"
        createLabel="New DTO"
        onCreate={handleCreate}
      />
      <TagFilterBar {...tagBar} />
      <ListScrollArea
        loading={isLoading}
        empty={dtos.length === 0}
        emptyTitle="No DTOs match your filters."
        createLabel="Create your first DTO"
        onCreate={handleCreate}
      >
        {dtos.map((d) => (
          <EntityListRow
            key={d.slug}
            icon={Braces}
            onClick={() => onSelect(d.slug)}
            tags={d.tags}
            tagLookup={tagLookup}
            trailing={<CountBadge>{d.fields.length}f</CountBadge>}
          >
            <div className="flex items-center gap-2">
              <span className="text-[14px]" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
                {d.name}
              </span>
            </div>
            {d.description && (
              <div className="text-[12.5px] truncate mt-0.5" style={{ color: 'var(--c-muted)' }}>
                {d.description}
              </div>
            )}
          </EntityListRow>
        ))}
      </ListScrollArea>
      {createOpen && <DtoCreateDialog onClose={() => setCreateOpen(false)} onCreated={handleCreated} />}
    </ListPageLayout>
  );
}
