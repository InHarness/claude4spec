import { Braces } from 'lucide-react';
import { useDtos, useCreateDto } from '../../hooks/useDtos.js';
import { openPopover, toast } from '../../ui/events.js';
import { ListPageLayout } from '../_shared/ListPageLayout.js';
import { ListPageHeader } from '../_shared/ListPageHeader.js';
import { TagFilterBar } from '../_shared/TagFilterBar.js';
import { ListScrollArea } from '../_shared/ListScrollArea.js';
import { EntityListRow, CountBadge } from '../_shared/EntityListRow.js';
import { useEntityListQuery } from '../_shared/useEntityListQuery.js';

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
  const createDto = useCreateDto();
  const { query, tagLookup, tagBar } = useEntityListQuery('dto', { search, tagFilter, onTagToggle });
  const { data: dtos = [], isLoading } = useDtos(query);

  async function handleCreate(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const result = await openPopover('create-dto', { x: rect.left, y: rect.bottom + 6 }, {});
    if (!result) return;
    try {
      const dto = await createDto.mutateAsync(result);
      onSelect(dto.slug);
      toast.success(`DTO ${dto.name} created`);
    } catch (err) {
      toast.error((err as Error).message);
    }
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
            leading={<Braces size={16} style={{ color: 'var(--c-accent)' }} />}
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
    </ListPageLayout>
  );
}
