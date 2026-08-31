import { useState } from 'react';
import { Palette } from 'lucide-react';
import { useDesignSystems } from './hooks.js';
import { countsOf } from './api.js';
import { DesignSystemCreateDialog } from './create-dialog.js';
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

export function DesignSystemsList({
  search,
  tagFilter,
  onSearchChange,
  onTagToggle,
  onSelect,
}: Props) {
  const { query, tagLookup, tagBar } = useEntityListQuery('design-system', {
    search,
    tagFilter,
    onTagToggle,
  });
  const { data: systems = [], isLoading } = useDesignSystems(query);
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleCreate() {
    setDialogOpen(true);
  }

  // Alphabetical by name (list endpoint already orders by name; keep stable).
  const sorted = [...systems].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <ListPageLayout>
      <ListPageHeader
        icon={Palette}
        title="Design Systems"
        count={systems.length}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search title, slug, description…"
        createLabel="New Design System"
        onCreate={handleCreate}
      />
      <TagFilterBar {...tagBar} />
      <ListScrollArea
        loading={isLoading}
        empty={systems.length === 0}
        emptyTitle="No design systems yet. Create one with /design-system in the editor."
        createLabel="Create your first design system"
        onCreate={handleCreate}
      >
        {sorted.map((ds) => {
          const counts = countsOf(ds);
          return (
            <EntityListRow
              key={ds.slug}
              icon={Palette}
              onClick={() => onSelect(ds.slug)}
              tags={ds.tags}
              tagLookup={tagLookup}
              trailing={
                <CountBadge>
                  {counts.groups} groups
                  {counts.tokens !== null && ` / ${counts.tokens} tokens`}
                </CountBadge>
              }
            >
              <div className="flex items-center gap-2">
                <span className="text-[13.5px]" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
                  {ds.title}
                </span>
              </div>
              {ds.description && (
                <div className="text-[12.5px] truncate mt-0.5" style={{ color: 'var(--c-muted)' }}>
                  {ds.description}
                </div>
              )}
            </EntityListRow>
          );
        })}
      </ListScrollArea>

      {dialogOpen && (
        <DesignSystemCreateDialog
          onClose={() => setDialogOpen(false)}
          onCreated={(slug) => {
            setDialogOpen(false);
            onSelect(slug);
          }}
        />
      )}
    </ListPageLayout>
  );
}
